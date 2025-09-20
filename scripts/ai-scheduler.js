#!/usr/bin/env node
/*
AI Improvement Scheduler
- Lists recent open issues with labels: ai
- Weighs by severity keywords and recency; prefers required checks and CRM issues first
- Dispatches the ai-improve-runner workflow for the top issue
*/

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');

if (!token || !owner || !repo) {
    console.error('Missing env: GITHUB_TOKEN/GITHUB_REPOSITORY');
    process.exit(1);
}

async function gh(path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'ai-improve-scheduler',
            ...(init.headers || {})
        }
    });
    if (res.status === 204) {
        // No Content (e.g., workflow dispatch), return empty object
        return {};
    }
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub API ${res.status}: ${t}`);
    }
    return res.json();
}

function loadLocalJson(path, fallback = null) {
    try {
        const fs = require('node:fs');
        if (!fs.existsSync(path)) return fallback;
        return JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function lastProcessedAt(knowledgeArr, issueNumber) {
    if (!Array.isArray(knowledgeArr)) return 0;
    let latest = 0;
    for (const e of knowledgeArr) {
        if (e && e.issue && Number(e.issue.number) === Number(issueNumber)) {
            const t = Date.parse(e.at || 0) || 0;
            if (t > latest) latest = t;
        }
    }
    return latest;
}

function withinHours(tsMs, hours) {
    if (!tsMs) return false;
    const diffH = (Date.now() - tsMs) / (1000 * 60 * 60);
    return diffH < hours;
}

async function hasRunnerInFlight() {
    // Check if AI Improve Runner has a run queued or in progress
    // By workflow file name
    const base = `/repos/${owner}/${repo}/actions/workflows/ai-improve-runner.yml/runs`;
    const queued = await gh(`${base}?status=queued&per_page=1`).catch(() => ({ workflow_runs: [] }));
    const inprog = await gh(`${base}?status=in_progress&per_page=1`).catch(() => ({ workflow_runs: [] }));
    const any = (queued.workflow_runs?.length || 0) + (inprog.workflow_runs?.length || 0);
    return any > 0;
}

async function getOpenPrHeads() {
    // Return a Set of head ref names for open PRs
    const prs = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`).catch(() => []);
    const set = new Set();
    for (const pr of prs) set.add(pr.head?.ref || '');
    return set;
}

function branchForIssue(issue) {
    // Must match runner's branchName()
    const slug = String(issue.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'task';
    return `chore/ai-${issue.number}-${slug}`;
}

function weight(issue) {
    const title = (issue.title || '').toLowerCase();
    const body = (issue.body || '').toLowerCase();
    const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);
    let w = 0;
    if (labels.includes('ai:crm')) w += 30;
    if (/error|failed|exception|crash|unreadable/.test(title + ' ' + body)) w += 20;
    if (/typecheck|lint|build|e2e|contract/.test(title + ' ' + body)) w += 15;
    // recency
    const updated = new Date(issue.updated_at).getTime();
    const freshness = Math.max(0, (Date.now() - updated) / (1000 * 60 * 60));
    w += Math.max(0, 24 - freshness); // prefer fresh issues in last 24h
    return w;
}

async function main() {
    // Avoid overlap/backlog
    if (await hasRunnerInFlight()) {
        console.log('Runner is already queued or in progress; skipping dispatch.');
        return;
    }

    // fetch open ai issues
    const issues = await gh(`/repos/${owner}/${repo}/issues?state=open&labels=ai&per_page=50`);
    if (!issues.length) { console.log('No AI issues to schedule'); return; }

    // Skip issues that already have an open PR for their expected branch
    const openHeads = await getOpenPrHeads();
    let candidates = issues.filter(iss => !openHeads.has(branchForIssue(iss)));

    // Load config and knowledge DB
    const cfg = loadLocalJson('.github/ai-runner-config.json', {}) || {};
    const knowledge = loadLocalJson('docs/ai-knowledge/db.json', []) || [];
    let minHours = Number(cfg.minHoursBetweenIssueRuns || 6);
    const envOverride = Number(process.env.MIN_HOURS_BETWEEN_ISSUE_RUNS || NaN);
    if (!Number.isNaN(envOverride) && envOverride > 0) minHours = envOverride;

    // Filter out issues processed too recently
    candidates = candidates.filter(iss => !withinHours(lastProcessedAt(knowledge, iss.number), minHours));
    if (!candidates.length) { console.log('All AI issues already have open PRs; nothing to schedule'); return; }
    const sorted = candidates.sort((a, b) => weight(b) - weight(a));
    const top = sorted[0];
    console.log('Top issue to run:', { number: top.number, title: top.title });

    // dispatch runner
    const inputs = { 'issue-number': String(top.number), 'dry-run': 'false' };
    // Forward AI_* if configured as environment variables (Actions can set these in env)
    const fwd = ['AI_ENDPOINT', 'AI_TOKEN', 'AI_MODEL', 'AI_MODELS_FAST', 'AI_MODELS_STRONG', 'AI_MODELS_DEFAULT'];
    for (const k of fwd) {
        const v = process.env[k];
        if (typeof v === 'string' && v.length) {
            inputs[k.toLowerCase().replace(/_/g, '-')] = v;
        }
    }
    const body = { ref: 'main', inputs };
    const res = await gh(`/repos/${owner}/${repo}/actions/workflows/ai-improve-runner.yml/dispatches`, { method: 'POST', body: JSON.stringify(body) });
    console.log('Dispatched runner for issue', top.number);
}

main().catch(e => { console.error('Scheduler failed:', e); process.exit(1); });
