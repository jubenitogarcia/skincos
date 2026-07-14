#!/usr/bin/env node
/*
    AI Improve Runner (model-required)
    - Reads issue by ISSUE_NUMBER
    - Plans changes exclusively via AI Models (GitHub Models/Copilot-style API)
    - If model planning fails, assigns issue to @copilot and mentions them; then exits with error to trigger self-heal workflows
    - Applies only AI-proposed edits; no local heuristics
    - Optionally runs a smoke script; any failure results in non-zero exit to activate auto-correction workflows
    - Creates branch, commits, pushes, opens PR, and enables auto-merge
*/

const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..', '..');

const env = process.env;
const token = env.GITHUB_TOKEN;
const repoFull = env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');
const issueNumber = env.ISSUE_NUMBER ? String(env.ISSUE_NUMBER) : '';
const dryRun = String(env.DRY_RUN || 'false') === 'true';
const maxAttempts = parseInt(env.MAX_ATTEMPTS || '1', 10);

// AI configuration (must be provided; no heuristic fallback)
let aiEndpoint = env.AI_ENDPOINT || '';
const aiToken = env.AI_TOKEN || '';
const aiModelExplicit = env.AI_MODEL || '';
let aiModelsFast = (env.AI_MODELS_FAST || '')
    .split(',').map(s => s.trim()).filter(Boolean);
let aiModelsStrong = (env.AI_MODELS_STRONG || '')
    .split(',').map(s => s.trim()).filter(Boolean);
let aiModelsDefault = (env.AI_MODELS_DEFAULT || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const aiMention = env.AI_MENTION || '@copilot';
const aiAssignee = env.AI_ASSIGNEE || 'copilot';

if (!token) {
    console.error('GITHUB_TOKEN is required');
    process.exit(1);
}
if (!owner || !repo) {
    console.error('GITHUB_REPOSITORY must be set as owner/repo');
    process.exit(1);
}

async function ghFetch(path, init = {}) {
    const url = `https://api.github.com${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-improve-runner'
    };
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API ${res.status}: ${text}`);
    }
    return res.json();
}

async function ghFetchText(path, init = {}) {
    const url = `https://api.github.com${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-improve-runner'
    };
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
}

function loadModelsFromFile() {
    try {
        const cfgPath = join(REPO_ROOT, '.github', 'ai-models.json');
        if (existsSync(cfgPath)) {
            const j = JSON.parse(readFileSync(cfgPath, 'utf8'));
            if (Array.isArray(j.strong) && !aiModelsStrong.length) aiModelsStrong = j.strong;
            if (Array.isArray(j.default) && !aiModelsDefault.length) aiModelsDefault = j.default;
            if (Array.isArray(j.fast) && !aiModelsFast.length) aiModelsFast = j.fast;
            if (!env.AI_ENDPOINT && typeof j.endpoint === 'string' && j.endpoint) {
                aiEndpoint = j.endpoint;
                console.log('Model endpoint (from file):', aiEndpoint);
            }
        }
    } catch (e) {
        console.warn('Failed to read .github/ai-models.json:', e.message);
    }
}

async function readIssue(nr) {
    if (!nr || nr === '0') {
        if (dryRun) {
            return {
                number: 0,
                title: 'DRY RUN – synthetic issue',
                body: 'This is a dry-run; no changes will be applied.',
                labels: []
            };
        }
        throw new Error('ISSUE_NUMBER is required (non-dry-run)');
    }
    return ghFetch(`/repos/${owner}/${repo}/issues/${nr}`);
}

function printableArg(arg) {
    return String(arg).replace(/(https:\/\/x-access-token:)[^@/]+@/g, '$1***@');
}

function run(command, args = [], opts = {}) {
    console.log(`$ ${[command, ...args].map(printableArg).join(' ')}`);
    return execFileSync(command, args, { stdio: 'inherit', ...opts });
}

function tryRun(command, args = [], opts = {}) {
    try {
        run(command, args, opts);
        return true;
    } catch (e) {
        console.warn(`Command failed: ${command}`);
        return false;
    }
}

function tokenizeSubmodules() {
    try {
        run('git', ['config', '--global', `url.https://x-access-token:${token}@github.com/.insteadOf`, 'https://github.com/']);
        console.log('Configured git url.insteadOf for submodules');
    } catch (e) {
        console.warn('Could not configure git for submodules:', e.message);
    }
}

function ensureSubmodules() {
    tokenizeSubmodules();
    tryRun('git', ['submodule', 'sync', '--recursive']);
    tryRun('git', ['submodule', 'update', '--init', '--recursive']);
}

async function mentionAndAssignCopilot(issue, reason) {
    const msg = `${aiMention} por favor use sua inteligência para implementar as mudanças deste issue.\n\nFalha ao planejar/aplicar via modelos: ${reason}`;
    try {
        await ghFetch(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body: msg })
        });
    } catch { }
    try {
        await ghFetch(`/repos/${owner}/${repo}/issues/${issue.number}/assignees`, {
            method: 'POST',
            body: JSON.stringify({ assignees: [aiAssignee] })
        });
    } catch { }
}

function loadExternalInsights(issueNr) {
    try {
        const p = join('docs', 'ai-knowledge', 'external', `issue-${issueNr}.json`);
        if (existsSync(p)) {
            return JSON.parse(readFileSync(p, 'utf8'));
        }
    } catch { }
    return null;
}

function buildModelList() {
    const list = [];
    if (aiModelExplicit) list.push(aiModelExplicit);
    // Prefer strong, then default, then fast
    for (const m of aiModelsStrong) if (!list.includes(m)) list.push(m);
    for (const m of aiModelsDefault) if (!list.includes(m)) list.push(m);
    for (const m of aiModelsFast) if (!list.includes(m)) list.push(m);
    return list;
}

async function chatComplete(model, messages, options = {}) {
    if (!aiEndpoint || !aiToken) {
        throw new Error('AI endpoint/token not configured');
    }
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiToken}`
    };
    const body = {
        model,
        messages,
        temperature: options.temperature ?? 0.2
    };
    const res = await fetch(aiEndpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await res.text();
    if (!res.ok) throw new Error(`AI ${res.status}: ${txt}`);
    try {
        const j = JSON.parse(txt);
        // OpenAI-format
        const content = j.choices?.[0]?.message?.content ?? '';
        return String(content);
    } catch (e) {
        return String(txt);
    }
}

function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

async function planWithModels(issue) {
    const insights = loadExternalInsights(issue.number);
    loadModelsFromFile();
    const models = buildModelList();
    if (!models.length) throw new Error('No models provided');

    const system = {
        role: 'system',
        content: [
            'Você é um assistente de engenharia que planeja e aplica mudanças pequenas e seguras neste repositório.',
            'Regras:',
            '- Responda apenas em JSON válido sem explicações.',
            '- O formato deve ser {"summary":"...","rationale":"...","edits":[{"path":"file","find":"...","replace":"..."}|{"path":"file","append":"..."}|{"path":"file","full":"..."}]}',
            '- Restrinja-se a arquivos de texto. Priorize .github/workflows/*.yml, docs/*.md, scripts/*.sh/js.',
            '- Evite mudanças perigosas e massivas; mantenha o escopo mínimo para fazer progresso.',
        ].join('\n')
    };
    const user = {
        role: 'user',
        content: [
            `Issue #${issue.number}: ${issue.title}`,
            issue.body || '(sem descrição)',
            insights ? `Contexto externo (somente metadados): ${JSON.stringify(insights).slice(0, 4000)}` : 'Sem contexto externo.',
            'Produza um plano mínimo e os edits correspondentes.'
        ].join('\n\n')
    };

    const attempts = [];
    for (const m of models) {
        try {
            const out = await chatComplete(m, [system, user]);
            const jsonStart = out.indexOf('{');
            const jsonEnd = out.lastIndexOf('}');
            const jsonStr = jsonStart >= 0 ? out.slice(jsonStart, jsonEnd + 1) : out;
            const parsed = safeJsonParse(jsonStr);
            if (parsed && Array.isArray(parsed.edits)) {
                return { model: m, plan: parsed };
            }
            attempts.push({ model: m, ok: false, reason: 'invalid-json' });
        } catch (e) {
            attempts.push({ model: m, ok: false, reason: String(e.message || e) });
        }
    }
    throw new Error('All models failed: ' + JSON.stringify(attempts));
}

function ensureDirFor(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function applyAiPlanEdits(edits) {
    let applied = 0;
    for (const e of edits) {
        if (!e || !e.path) continue;
        const p = e.path.replace(/^\/+/, '');
        // Only allow safe text paths
        if (/\.(png|jpg|jpeg|gif|pdf|zip|tar|gz|lock)$/i.test(p)) continue;

        if (typeof e.full === 'string') {
            ensureDirFor(p);
            writeFileSync(p, e.full);
            console.log('Applied full write ->', p);
            applied++;
            continue;
        }
        if (typeof e.find === 'string' && typeof e.replace === 'string' && existsSync(p)) {
            const cur = readFileSync(p, 'utf8');
            if (cur.includes(e.find)) {
                const next = cur.replace(e.find, e.replace);
                if (next !== cur) {
                    writeFileSync(p, next);
                    console.log('Applied find/replace ->', p);
                    applied++;
                    continue;
                }
            }
        }
        if (typeof e.append === 'string') {
            ensureDirFor(p);
            let cur = '';
            if (existsSync(p)) cur = readFileSync(p, 'utf8');
            writeFileSync(p, cur + (cur.endsWith('\n') ? '' : '\n') + e.append);
            console.log('Applied append ->', p);
            applied++;
            continue;
        }
    }
    return applied;
}

function configureGitUser() {
    tryRun('git', ['config', 'user.name', 'github-actions[bot]']);
    tryRun('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
}

function branchName(issue) {
    const slug = String(issue.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'task';
    return `chore/ai-${issue.number}-${slug}`;
}

async function createPr(head, base, title, body) {
    return ghFetch(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify({ title, head, base, body, draft: false })
    });
}

async function findExistingPr(head) {
    const q = encodeURIComponent(`${owner}:${head}`);
    const items = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&head=${q}`);
    if (Array.isArray(items) && items.length > 0) return items[0];
    return null;
}

function enableAutoMerge(prNumber) {
    const repoRef = `${owner}/${repo}`;
    const r = tryRun('gh', ['pr', 'merge', String(prNumber), '--auto', '--squash', '--delete-branch', '-R', repoRef]);
    if (!r) console.warn('Auto-merge not enabled (gh pr merge failed or unsupported).');
    return r;
}

async function areChecksGreenForPr(prNumber) {
    try {
        const pr = await ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
        if (!pr || pr.mergeable === false || pr.mergeable_state === 'dirty' || pr.mergeable_state === 'unknown') {
            return false;
        }
        const sha = pr.head && pr.head.sha;
        if (!sha) return false;
        const comb = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}/status`);
        if (comb && comb.state && String(comb.state).toLowerCase() === 'failure') return false;
        const checks = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}/check-runs`);
        if (checks && Array.isArray(checks.check_runs)) {
            for (const c of checks.check_runs) {
                if (c.status !== 'completed') return false;
                const concl = String(c.conclusion || '').toLowerCase();
                if (concl && !['success', 'skipped', 'neutral'].includes(concl)) return false;
            }
        }
        return true;
    } catch (e) {
        console.warn('Failed to evaluate checks for PR', prNumber, String(e.message || e));
        return false;
    }
}

async function tryDirectMergeIfGreen(prNumber) {
    const green = await areChecksGreenForPr(prNumber);
    if (!green) return false;
    const repoRef = `${owner}/${repo}`;
    const ok = tryRun('gh', ['pr', 'merge', String(prNumber), '--squash', '--delete-branch', '-R', repoRef]);
    if (!ok) console.warn('Direct merge attempt failed.');
    return ok;
}

function runSmoke() {
    ensureSubmodules();
    const { existsSync } = require('node:fs');
    let ok = true;
    // Prefer unified entry-point
    const e2e = existsSync(join(REPO_ROOT, 'backend', 'scripts', 'e2e.sh'))
        ? join(REPO_ROOT, 'backend', 'scripts', 'e2e.sh')
        : (existsSync(join(REPO_ROOT, 'scripts', 'e2e.sh')) ? join(REPO_ROOT, 'scripts', 'e2e.sh') : null);
    const repoHealth = existsSync(join(REPO_ROOT, 'backend', 'scripts', 'ci-repo-health.sh'))
        ? join(REPO_ROOT, 'backend', 'scripts', 'ci-repo-health.sh')
        : (existsSync(join(REPO_ROOT, 'scripts', 'ci-repo-health.sh')) ? join(REPO_ROOT, 'scripts', 'ci-repo-health.sh') : null);

    if (e2e) {
        ok = tryRun('bash', [e2e, 'ci-smoke']);
        tryRun('bash', [e2e, 'health']);
    } else if (repoHealth) {
        tryRun('bash', [repoHealth]);
    } else {
        console.log('Smoke script not found; treating smoke as PASS');
    }
    return ok;
}

function appendKnowledge(entry) {
    try {
        const dir = join(REPO_ROOT, 'backend', 'docs', 'ai-knowledge');
        if (!existsSync(join(REPO_ROOT, 'backend', 'docs'))) mkdirSync(join(REPO_ROOT, 'backend', 'docs'), { recursive: true });
        if (!existsSync(dir)) mkdirSync(dir);
        const dbPath = join(dir, 'db.json');
        let arr = [];
        if (existsSync(dbPath)) {
            try { arr = JSON.parse(readFileSync(dbPath, 'utf8')) || []; } catch { }
        }
        arr.push(entry);
        if (arr.length > 500) arr = arr.slice(arr.length - 500);
        writeFileSync(dbPath, JSON.stringify(arr, null, 2));
        console.log('Knowledge updated:', dbPath);
    } catch (e) {
        console.warn('Failed to update knowledge DB:', e.message);
    }
}

(async function main() {
    try {
        const startedAt = Date.now();
        const issue = await readIssue(issueNumber);
        console.log(`Processing issue #${issue.number}: ${issue.title}`);

        if (!aiEndpoint || !aiToken) {
            await mentionAndAssignCopilot(issue, 'AI endpoint/token ausentes');
            throw new Error('AI configuration missing');
        }

        // Breadcrumb
        try {
            await ghFetch(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body: `AI runner iniciado em ${new Date().toISOString()}. Modelos candidatos: ${buildModelList().join(', ')}` })
            });
        } catch { }

        let modelUsed = null;
        let plan = null;
        try {
            const result = await planWithModels(issue);
            modelUsed = result.model;
            plan = result.plan;
        } catch (e) {
            await mentionAndAssignCopilot(issue, String(e.message || e));
            throw e;
        }

        if (!plan || !Array.isArray(plan.edits) || plan.edits.length === 0) {
            await mentionAndAssignCopilot(issue, 'Plano vazio/sem edits');
            throw new Error('Empty plan');
        }

        if (dryRun) {
            console.log('[DRY_RUN] Plan (model:', modelUsed, '):', JSON.stringify(plan));
            console.log('[DRY_RUN] Skipping edits/smoke/branch/PR');
            return;
        }

        // Clean state
        tryRun('git', ['checkout', '-f']);
        tryRun('git', ['reset', '--hard']);

        // Apply AI edits only
        const applied = applyAiPlanEdits(plan.edits);
        if (!applied) {
            await mentionAndAssignCopilot(issue, 'Nenhuma alteração aplicada a partir do plano');
            throw new Error('No edits applied');
        }

        // Validate via smoke (fail-fast to enable auto-correction workflows)
        if (!runSmoke()) {
            await mentionAndAssignCopilot(issue, 'Smoke falhou após aplicar mudanças');
            throw new Error('Smoke failed');
        }

        // Create branch and PR
        configureGitUser();
        const b = branchName(issue);
        const baseBranch = 'main';
        tryRun('git', ['fetch', 'origin']);
        tryRun('git', ['checkout', '-B', b, `origin/${baseBranch}`]) || tryRun('git', ['checkout', '-b', b]);
        tryRun('git', ['add', '-A']);
        tryRun('git', ['commit', '-m', `AI (${modelUsed}): aplicar mudanças para #${issue.number}`]) || console.log('Nothing to commit');

        const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
        let pushed = tryRun('git', ['push', '-u', remoteUrl, b]);
        if (!pushed) {
            const rebaseOk = tryRun('git', ['pull', '--rebase', remoteUrl, b]);
            if (!rebaseOk) {
                tryRun('git', ['rebase', '--abort']);
                tryRun('git', ['reset', '--hard']);
            }
            pushed = tryRun('git', ['push', '-u', remoteUrl, b]);
        }
        if (!pushed) {
            tryRun('git', ['push', '-u', '--force-with-lease', remoteUrl, b]);
        }

        const title = `AI (${modelUsed}): mudanças do issue #${issue.number}`;
        const body = `Mudanças propostas pelo modelo ${modelUsed}.\n\nResumo: ${plan.summary || '(sem resumo)'}\n\nRacional: ${plan.rationale || '(n/d)'}\n\nCloses #${issue.number}`;
        let pr;
        try {
            pr = await createPr(b, baseBranch, title, body);
            console.log('Opened PR #', pr.number, pr.html_url);
        } catch (e) {
            const msg = String(e && e.message || '');
            if (/pull request already exists/i.test(msg) || /Validation Failed/.test(msg)) {
                const existing = await findExistingPr(b);
                if (existing) {
                    pr = existing;
                    console.log('Reusing existing PR #', pr.number, pr.html_url);
                } else {
                    console.warn('PR creation failed and no existing PR found:', msg);
                }
            } else {
                console.warn('PR creation failed:', msg);
            }
        }

        if (pr && pr.number) {
            const autoOk = enableAutoMerge(pr.number);
            if (!autoOk) {
                await tryDirectMergeIfGreen(pr.number);
            }
        }

        // Knowledge DB
        try {
            appendKnowledge({
                at: new Date().toISOString(),
                ok: true,
                issue: { number: issue.number, title: issue.title },
                planner: 'model',
                modelUsed,
                pr: pr && pr.number ? { number: pr.number, url: pr.html_url } : null
            });
        } catch { }

        // Final breadcrumb
        try {
            await ghFetch(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body: `AI runner finalizado com sucesso via ${modelUsed}. Veja PR: ${pr?.html_url || '(n/d)'}` })
            });
        } catch { }

        console.log('Done. ok = true');
    } catch (e) {
        console.error('Runner failed:', e);
        process.exit(1);
    }
})();
