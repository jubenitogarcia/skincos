#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');

const HOST = process.env.ORB_TASK_RUNNER_HEALTH_HOST || '127.0.0.1';
const PORT = Number(process.env.ORB_TASK_RUNNER_HEALTH_PORT || 5681);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function processInfo(pid) {
  const cmdline = readText(`/proc/${pid}/cmdline`).replaceAll('\0', ' ').trim();
  const stat = readText(`/proc/${pid}/stat`);
  const end = stat.lastIndexOf(')');
  const fields = end >= 0 ? stat.slice(end + 1).trim().split(/\s+/) : [];
  return { pid: Number(pid), ppid: Number(fields[1] || 0), cmdline };
}

function inspectInternalRunner() {
  const processes = fs.readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .map(processInfo)
    .filter((entry) => entry.cmdline);
  const mains = new Set(processes
    .filter((entry) => /(?:^|\s)node\s+\/usr\/local\/bin\/n8n\s+start(?:\s|$)/.test(entry.cmdline))
    .map((entry) => entry.pid));
  const runners = processes.filter((entry) => entry.cmdline.includes('@n8n/task-runner/dist/start.js'));
  const connected = runners.some((runner) => mains.has(runner.ppid));
  return {
    ok: mains.size === 1 && runners.length === 1 && connected,
    mode: 'internal',
    n8n_processes: mains.size,
    runner_processes: runners.length,
    parent_child_link: connected,
  };
}

function handler(request, response) {
  if (request.method !== 'GET' || request.url !== '/health') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not_found' }));
    return;
  }
  let health;
  try {
    health = inspectInternalRunner();
  } catch (error) {
    health = { ok: false, mode: 'internal', reason: 'probe_failed', error_type: error?.name || 'Error' };
  }
  response.writeHead(health.ok ? 200 : 503, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify({ status: health.ok ? 'ok' : 'unavailable', ...health }));
}

if (require.main === module) {
  const server = http.createServer(handler);
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  server.listen(PORT, HOST);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { inspectInternalRunner, processInfo };
