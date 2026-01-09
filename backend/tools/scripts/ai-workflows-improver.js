#!/usr/bin/env node
/*
  AI Workflows Improver
  - Scans .github/workflows/*.yml
  - Asks AI model to propose robustifying changes (timeouts, retries, setup caching, non-blocking scans when appropriate)
  - Applies proposed edits and opens a PR
*/

const { execSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const env = process.env;
const token = env.GITHUB_TOKEN;
const repoFull = env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');
const dryRun = String(env.DRY_RUN || 'false') === 'true';
const aiEndpoint = env.AI_ENDPOINT || '';
const aiToken = env.AI_TOKEN || '';
const aiModel = env.AI_MODEL || 'gpt-4o-mini';

if (!token) { console.error('GITHUB_TOKEN is required'); process.exit(1); }
if (!owner || !repo) { console.error('GITHUB_REPOSITORY must be set as owner/repo'); process.exit(1); }
if (!aiEndpoint || !aiToken) { console.error('AI endpoint/token required'); process.exit(1); }

async function ghFetch(path, init = {}) {
    const url = `https://api.github.com${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-workflows-improver'
    };
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
}

function tryRun(cmd) {
    try { execSync(cmd, { stdio: 'inherit' }); return true; } catch { return false; }
}

function listWorkflowFiles() {
    try { return readdirSync('.github/workflows').filter(f => f.endsWith('.yml')).map(f => `.github/workflows/${f}`); } catch { return []; }
}

async function chatComplete(messages) {
    const res = await fetch(aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiToken}` },
        body: JSON.stringify({ model: aiModel, messages, temperature: 0.2 })
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`AI ${res.status}: ${txt}`);
    try {
        const j = JSON.parse(txt);
        return String(j.choices?.[0]?.message?.content ?? '');
    } catch { return txt; }
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function proposeImprovements(files) {
    const system = {
        role: 'system', content: [
            'Você é um especialista em GitHub Actions.',
            'Responda apenas JSON válido com o formato:',
            '{"summary":"...","edits":[{"path":".github/workflows/xxx.yml","find":"...","replace":"..."}|{"path":"...","append":"..."}|{"path":"...","full":"..."}]}',
            'Foque em: timeouts, retries com backoff, cache de dependências, setup de pnpm quando necessário, continue-on-error onde apropriado (ex.: gitleaks), triggers úteis (workflow_dispatch), e evitar submodules:true.'
        ].join('\n')
    };
    const user = { role: 'user', content: files.map(p => `# ${p}\n\n${readFileSync(p, 'utf8')}`).join('\n\n-----\n\n') };
    const out = await chatComplete([system, user]);
    const jsonStart = out.indexOf('{');
    const jsonEnd = out.lastIndexOf('}');
    const jsonStr = jsonStart >= 0 ? out.slice(jsonStart, jsonEnd + 1) : out;
    const parsed = safeJsonParse(jsonStr);
    if (!parsed || !Array.isArray(parsed.edits)) throw new Error('Invalid AI response');
    return parsed;
}

function applyEdits(edits) {
    let count = 0;
    for (const e of edits) {
        if (!e || !e.path) continue;
        const p = e.path;
        if (typeof e.full === 'string') {
            writeFileSync(p, e.full);
            console.log('full ->', p); count++; continue;
        }
        if (typeof e.find === 'string' && typeof e.replace === 'string' && existsSync(p)) {
            const cur = readFileSync(p, 'utf8');
            if (cur.includes(e.find)) {
                const next = cur.replace(e.find, e.replace);
                if (next !== cur) { writeFileSync(p, next); console.log('replace ->', p); count++; continue; }
            }
        }
        if (typeof e.append === 'string') {
            const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
            writeFileSync(p, cur + (cur.endsWith('\n') ? '' : '\n') + e.append);
            console.log('append ->', p); count++; continue;
        }
    }
    return count;
}

async function createPr(branch, base, title, body) {
    return ghFetch(`/repos/${owner}/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title, head: branch, base, body, draft: false }) });
}

(async function main() {
    const files = listWorkflowFiles();
    if (!files.length) { console.log('No workflow files'); return; }

    const plan = await proposeImprovements(files);
    if (dryRun) { console.log('DRY_RUN plan:', JSON.stringify(plan)); return; }

    tryRun('git fetch origin');
    tryRun('git checkout -B chore/ai-workflows-improve origin/main') || tryRun('git checkout -b chore/ai-workflows-improve');
    const applied = applyEdits(plan.edits);
    if (!applied) { console.error('No edits applied'); process.exit(1); }
    tryRun('git add .github/workflows');
    tryRun('git commit -m "AI(workflows): melhorias de robustez"');
    const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    tryRun(`git push -u ${remoteUrl} chore/ai-workflows-improve`);
    const pr = await createPr('chore/ai-workflows-improve', 'main', 'AI: melhorias e robustez nos workflows', `Alterações propostas pelo modelo ${aiModel}.`);
    console.log('Opened PR #', pr.number, pr.html_url);
})();
