#!/usr/bin/env node
/*
  AI External Insights Collector
  - Reads ISSUE_NUMBER and repo context
  - Searches GitHub public repositories related to the issue title/body
  - Saves compact JSON at docs/ai-knowledge/external/issue-<n>.json
*/

const fs = require('node:fs');
const path = require('node:path');

const token = process.env.GITHUB_TOKEN || '';
const repoFull = process.env.GITHUB_REPOSITORY || '';
const issueNumber = Number(process.env.ISSUE_NUMBER || 0);

if (!repoFull || !token || !issueNumber) {
    console.error('Missing env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER');
    process.exit(0); // best-effort, don’t fail pipeline
}

async function gh(url, init = {}) {
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'ai-external-insights',
            ...(init.headers || {})
        }
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub API ${res.status}: ${t}`);
    }
    return res.json();
}

async function readIssue(owner, repo, nr) {
    return gh(`https://api.github.com/repos/${owner}/${repo}/issues/${nr}`);
}

function norm(s) { return String(s || '').replace(/[\r\n]+/g, ' ').slice(0, 240); }

async function searchRepos(q) {
    const enc = encodeURIComponent(q);
    const data = await gh(`https://api.github.com/search/repositories?q=${enc}&sort=stars&order=desc&per_page=10`);
    return Array.isArray(data.items) ? data.items : [];
}

async function main() {
    const [owner, repo] = repoFull.split('/');
    const issue = await readIssue(owner, repo, issueNumber);
    const title = issue.title || '';
    const body = issue.body || '';
    // Build a concise query based on title + key labels
    const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);
    const hint = labels.filter(l => /^ai:/.test(l)).join(' ');
    const terms = [title, hint].filter(Boolean).join(' ');
    const repos = await searchRepos(terms || title);
    const results = repos.map(r => ({
        full_name: r.full_name,
        html_url: r.html_url,
        description: norm(r.description),
        stargazers_count: r.stargazers_count,
        language: r.language,
        license: r.license ? { key: r.license.key, name: r.license.name, spdx_id: r.license.spdx_id } : null
    }));
    const outDir = path.join('docs', 'ai-knowledge', 'external');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `issue-${issueNumber}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ issue: { number: issue.number, title }, results }, null, 2));
    console.log('External insights saved:', outPath);
}

main().catch(e => { console.warn('Insights collection failed:', e.message); process.exit(0); });
