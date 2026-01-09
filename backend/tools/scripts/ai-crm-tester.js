#!/usr/bin/env node
/*
AI CRM Tester – generates issues from automated checks
- Runs minimal tests on CRM submodule: install, lint, typecheck, basic build
- Starts dev server (best-effort) and probes health endpoints for runtime issues
- Scans for TODO/FIXME markers to file docs/refactor issues
- Parses outputs to find glitches/bugs/incomplete items and opens/updates issues labeled ai, ai:crm, triage
- Attaches logs to the issue body for context
- Idempotent: updates existing "AI: CRM – <title>" issues if already present
*/

const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');
if (!token || !owner || !repo) {
    console.error('Missing env: GITHUB_TOKEN/GITHUB_REPOSITORY');
    process.exit(1);
}

function run(cmd, cwd) {
    console.log(`$ ${cmd}`);
    try {
        return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', env: { ...process.env } });
    } catch (e) {
        return e.stdout?.toString?.() || e.message || '';
    }
}

async function gh(path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'ai-crm-tester',
            ...(init.headers || {})
        }
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub API ${res.status}: ${t}`);
    }
    return res.json();
}

function parseFindings(text) {
    const findings = [];
    const lines = text.split('\n');
    for (const ln of lines) {
        if (/error/i.test(ln) && !/warning/i.test(ln)) findings.push({ severity: 'error', line: ln.trim() });
        else if (/failed|not found|cannot|undefined|exception|traceback/i.test(ln)) findings.push({ severity: 'error', line: ln.trim() });
    }
    return findings.slice(0, 50);
}

async function ensureLabels() {
    const want = [
        { name: 'ai', description: 'AI improvement trigger' },
        { name: 'ai:crm', description: 'CRM module' },
        { name: 'ai:docs', description: 'Documentation improvements' },
        { name: 'ai:refactor-small', description: 'Small refactors' },
        { name: 'triage', description: 'Needs triage/prioritization' }
    ];
    for (const l of want) {
        try { await gh(`/repos/${owner}/${repo}/labels`, { method: 'POST', body: JSON.stringify(l) }); } catch { }
    }
}

async function probeHealth(cwd) {
    let pid = '';
    try {
        const out = run("bash -lc 'nohup npm run dev --if-present >/dev/null 2>&1 & echo $!'", cwd);
        pid = (out || '').trim();
    } catch { }
    await new Promise(r => setTimeout(r, 3000));
    const endpoints = [
        'http://localhost:5173/health',
        'http://localhost:3000/api/health',
        'http://localhost:3000/health',
        'http://localhost:5173'
    ];
    const results = [];
    for (const url of endpoints) {
        try {
            const res = await fetch(url);
            results.push({ url, status: res.status, ok: res.ok });
        } catch (e) {
            results.push({ url, status: 0, ok: false, error: e.message });
        }
    }
    if (pid) {
        try { run(`bash -lc 'kill ${pid}'`); } catch { }
    }
    return results;
}

function parseTodos(cwd) {
    let grepOut = '';
    try {
        grepOut = run("bash -lc 'grep -R -n -E " + '"TODO|FIXME"' + ` -- ${cwd}` + "'", process.cwd());
    } catch (e) {
        grepOut = e.stdout || '';
    }
    const lines = (grepOut || '').split('\n').filter(Boolean).slice(0, 200);
    const todos = lines.filter(l => /TODO/.test(l)).slice(0, 50);
    const fixmes = lines.filter(l => /FIXME/.test(l)).slice(0, 50);
    return { todos, fixmes };
}

async function findExisting(title) {
    const q = encodeURIComponent(`${title} repo:${owner}/${repo} in:title state:open`);
    const res = await gh(`/search/issues?q=${q}`);
    const item = (res.items || []).find(i => i.title === title);
    return item || null;
}

async function createOrUpdateIssue(title, body) {
    await ensureLabels();
    const existing = await findExisting(title);
    if (existing) {
        await gh(`/repos/${owner}/${repo}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
        return existing.number;
    }
    const created = await gh(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['ai', 'ai:crm', 'triage'] }) });
    return created.number;
}

(async function main() {
    try {
        const cwd = 'frontend';
        if (!existsSync(cwd)) {
            console.log('CRM module not present; nothing to test.');
            return;
        }
        let out = '';
        out += run('npm ci', cwd) + '\n';
        out += run('npx eslint . --ext .ts,.tsx || true', cwd) + '\n';
        out += run('npx tsc --noEmit || true', cwd) + '\n';
        out += run('npm run build --if-present || true', cwd) + '\n';

        const findings = parseFindings(out);
        // Runtime probe
        const health = await probeHealth(cwd);
        const badHealth = health.filter(h => !h.ok && String(h.status)[0] !== '2');
        if (badHealth.length) {
            const title = `AI: CRM – runtime health probe failures (${badHealth.length})`;
            const body = [
                'Automated CRM tester found runtime health probe failures.',
                '',
                ...badHealth.map(h => `- ${h.url} -> status=${h.status}${h.error ? ' (' + h.error + ')' : ''}`),
                '',
                '<details><summary>Build & lint logs</summary>\n\n',
                '```',
                out.slice(0, 4000),
                '```',
                '\n\n</details>'
            ].join('\n');
            const nr = await createOrUpdateIssue(title, body);
            console.log('Runtime issue created/updated #', nr);
        }

        // TODO/FIXME detectors
        const { todos, fixmes } = parseTodos(cwd);
        if (todos.length) {
            await ensureLabels();
            const title = `AI: CRM TODOs discovered (${todos.length})`;
            const body = [
                'AI detected TODO markers in CRM codebase. Consider converting into docs/tasks.',
                '',
                ...todos.slice(0, 20).map(l => `- ${l}`)
            ].join('\n');
            const existing = await findExisting(title);
            const issueBody = body;
            if (existing) await gh(`/repos/${owner}/${repo}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ body: issueBody, labels: ['ai', 'ai:crm', 'ai:docs', 'triage'] }) });
            else await gh(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body: issueBody, labels: ['ai', 'ai:crm', 'ai:docs', 'triage'] }) });
        }
        if (fixmes.length) {
            await ensureLabels();
            const title = `AI: CRM FIXMEs discovered (${fixmes.length})`;
            const body = [
                'AI detected FIXME markers in CRM codebase. Small refactors or fixes may be needed.',
                '',
                ...fixmes.slice(0, 20).map(l => `- ${l}`)
            ].join('\n');
            const existing = await findExisting(title);
            const issueBody = body;
            if (existing) await gh(`/repos/${owner}/${repo}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ body: issueBody, labels: ['ai', 'ai:crm', 'ai:refactor-small', 'triage'] }) });
            else await gh(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body: issueBody, labels: ['ai', 'ai:crm', 'ai:refactor-small', 'triage'] }) });
        }
        if (findings.length === 0) {
            console.log('No actionable CRM findings.');
            return; // we might still have created runtime/TODO/FIXME issues above
        }
        const title = `AI: CRM – ${Math.min(5, findings.length)} finding(s) detected`;
        const body = [
            'Automated CRM tester found potential issues. This issue was generated by the AI tester.',
            '',
            'Findings (top):',
            ...findings.slice(0, 5).map(f => `- [${f.severity}] ${f.line}`),
            '',
            '<details><summary>Raw logs</summary>\n\n',
            '```',
            out.slice(0, 4000),
            '```',
            '\n\n</details>'
        ].join('\n');
        const nr = await createOrUpdateIssue(title, body);
        console.log('Issue created/updated #', nr);
    } catch (e) {
        console.error('CRM tester failed:', e);
    }
})();
