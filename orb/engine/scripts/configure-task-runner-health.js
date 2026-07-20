#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ENV_FILE = process.env.N8N_ENV_FILE || '/etc/skincos/orb.env';
const CHECKPOINT_ROOT = process.env.N8N_RUNTIME_HOME
  ? path.join(process.env.N8N_RUNTIME_HOME, 'exports', 'runtime-checkpoints')
  : '/var/lib/skincos-runtime/orb/exports/runtime-checkpoints';
const DESIRED = Object.freeze({
  N8N_RUNNERS_HEALTH_CHECK_SERVER_ENABLED: 'true',
  N8N_RUNNERS_HEALTH_CHECK_SERVER_HOST: '127.0.0.1',
  N8N_RUNNERS_HEALTH_CHECK_SERVER_PORT: '5681',
});

function parseAssignments(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function render(content) {
  const seen = new Set();
  const lines = content.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !Object.prototype.hasOwnProperty.call(DESIRED, match[1])) return line;
    if (seen.has(match[1])) return null;
    seen.add(match[1]);
    return `${match[1]}=${DESIRED[match[1]]}`;
  }).filter((line) => line !== null);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(DESIRED)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function summary(content) {
  const values = parseAssignments(content);
  const mismatches = Object.entries(DESIRED)
    .filter(([key, value]) => values.get(key) !== value)
    .map(([key]) => key);
  return { ok: mismatches.length === 0, mismatches };
}

function main() {
  const apply = process.argv.includes('--apply');
  const before = fs.readFileSync(ENV_FILE, 'utf8');
  const beforeSummary = summary(before);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'check', env_file: ENV_FILE, ...beforeSummary }, null, 2));
    if (!beforeSummary.ok) process.exitCode = 1;
    return;
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('configure-task-runner-health --apply exige root.');
  }
  const after = render(before);
  if (after === before) {
    console.log(JSON.stringify({ mode: 'apply', changed: false, env_file: ENV_FILE, ...summary(after) }, null, 2));
    return;
  }

  const stat = fs.statSync(ENV_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const checkpointDir = path.join(CHECKPOINT_ROOT, `task-runner-health-${stamp}`);
  fs.mkdirSync(checkpointDir, { recursive: true, mode: 0o750 });
  fs.copyFileSync(ENV_FILE, path.join(checkpointDir, 'orb.env'));

  const temporary = `${ENV_FILE}.task-runner-health-${process.pid}.tmp`;
  fs.writeFileSync(temporary, after, { mode: stat.mode & 0o777 });
  fs.chownSync(temporary, stat.uid, stat.gid);
  fs.renameSync(temporary, ENV_FILE);

  console.log(JSON.stringify({
    mode: 'apply',
    changed: true,
    env_file: ENV_FILE,
    checkpoint_dir: checkpointDir,
    ...summary(after),
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  DESIRED,
  parseAssignments,
  render,
  summary,
};
