import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const root = path.resolve(import.meta.dirname, '../..');
const workflowDirectory = path.join(root, '.github/workflows');

function renderGitHubExpressionsForBash(source) {
  return source.replace(/\$\{\{[\s\S]*?\}\}/g, 'codex_safe_github_expression');
}

function bashSyntaxCheck(source, label) {
  const result = spawnSync('bash', ['-n'], {
    input: renderGitHubExpressionsForBash(source),
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, `${label} must invoke Bash for syntax validation`);
  assert.equal(result.status, 0, `${label} must be valid Bash after GitHub expression rendering: ${result.stderr}`);
}

function workflowRunSteps(document) {
  const steps = [];
  for (const [jobName, job] of Object.entries(document.jobs || {})) {
    for (const [index, step] of (job.steps || []).entries()) {
      if (typeof step?.run === 'string') {
        steps.push({ jobName, index, name: step.name || `step ${index + 1}`, run: step.run });
      }
    }
  }
  return steps;
}

for (const name of fs.readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/i.test(entry)).sort()) {
  test(`GitHub workflow YAML parses: ${name}`, () => {
    const source = fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
    const document = yaml.load(source, { json: false });
    assert.ok(document && typeof document === 'object', `${name} must contain a YAML mapping`);
  });
}

test('Identity CRM delivery run blocks remain Bash-parseable after safe GitHub expression rendering', () => {
  const source = readWorkflow('identity-crm-delivery.yml');
  const document = yaml.load(source, { json: false });
  const steps = workflowRunSteps(document);
  assert.ok(steps.length > 0, 'Identity CRM delivery workflow must contain Bash run blocks');
  for (const step of steps) {
    bashSyntaxCheck(step.run, `identity-crm-delivery.yml ${step.jobName}/${step.name}`);
  }
});

test('Identity CRM bootstrap generates the caller HMAC in memory with executable Bash and Node heredocs', () => {
  const document = yaml.load(readWorkflow('identity-crm-delivery.yml'), { json: false });
  const provision = workflowRunSteps(document).find((step) => step.name === 'Provision one generated HMAC into both caller-disabled staging runtimes');
  assert.ok(provision, 'missing caller HMAC bootstrap provision step');
  const start = provision.run.indexOf('caller_hmac="$(');
  const end = provision.run.indexOf('issuer_written=false', start);
  assert.ok(start >= 0 && end > start, 'caller HMAC generator must precede any remote secret writer');
  const probe = `${renderGitHubExpressionsForBash(provision.run.slice(start, end))}\n[[ "${'$'}{caller_hmac}" =~ ^[A-Za-z0-9_-]{64}$ ]]\nunset caller_hmac\n`;
  const result = spawnSync('bash', ['-e', '-u', '-o', 'pipefail'], { input: probe, encoding: 'utf8' });
  assert.equal(result.error, undefined, 'caller HMAC generator must invoke Bash');
  assert.equal(result.status, 0, 'caller HMAC generator must execute without printing or persisting its value');
});

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
}
