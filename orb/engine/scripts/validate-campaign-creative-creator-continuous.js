#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  BUILDER_VERSION,
  INTERMEDIATE_FIXTURES,
  REQUIRED_MODULE_NODES,
  WORKFLOW_ID,
  WORKFLOW_NAME,
} = require('./build-campaign-creative-creator-continuous');

const UNSAFE_RUNTIME_PATTERNS = [
  /\brequire\s*\(/,
  /\bchild_process\b/,
  /\b(?:execFile|spawn|fork)\s*\(/,
  /\/tmp\//,
  /\bpython3\b/,
  /\bPyPDF(?:2)?\b/,
  /\b(?:fs|path)\.(?:read|write|append|unlink|join|resolve|dirname|basename)\s*\(/,
  /Buffer\.from\([^\n]*base64/i,
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') result.input = argv[++index];
  }
  return result;
}

function nodesByName(workflow) {
  return new Map(workflow.nodes.map((node) => [node.name, node]));
}

function hasEdge(workflow, source, target) {
  const output = workflow.connections && workflow.connections[source];
  const branches = output && output.main;
  return Array.isArray(branches) && branches.some((branch) => Array.isArray(branch)
    && branch.some((edge) => edge && edge.node === target && edge.type === 'main'));
}

function countEdges(workflow) {
  return Object.values(workflow.connections || {}).reduce((total, output) => total + Object.values(output || {}).reduce(
    (connectionTotal, branches) => connectionTotal + (Array.isArray(branches)
      ? branches.reduce((branchTotal, branch) => branchTotal + (Array.isArray(branch) ? branch.length : 0), 0)
      : 0),
    0,
  ), 0);
}

function assertUniqueIds(nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) throw new Error('Duplicate or missing node id: ' + node.id);
    ids.add(node.id);
  }
}

function assertRuntimeSafety(workflow) {
  for (const node of workflow.nodes) {
    if (!node.parameters || typeof node.parameters.jsCode !== 'string') continue;
    for (const pattern of UNSAFE_RUNTIME_PATTERNS) {
      if (pattern.test(node.parameters.jsCode)) {
        throw new Error('Unsupported runtime usage remains in ' + node.name + ': ' + pattern);
      }
    }
  }
}

function assertExecutorContract(node) {
  if (!node || node.type !== 'n8n-nodes-base.code') throw new Error('CCG-80 executor must be a Code node');
  const code = node.parameters && node.parameters.jsCode;
  if (typeof code !== 'string' || code.length < 1000) throw new Error('CCG-80 executor code is missing');
  for (const required of [
    'run_id',
    'production_id',
    'content_id',
    'campaign_id',
    'request_hash',
    'idempotency_key',
    'production_execution_results',
    'POLICY_BLOCKED',
    'DRY_RUN',
    'EXECUTOR_ADAPTER_NOT_CONFIGURED',
    'publish_allowed: false',
    'publish_requested: false',
  ]) {
    if (!code.includes(required)) throw new Error('CCG-80 executor contract missing: ' + required);
  }
  if (/publish_allowed\s*:\s*true|publish_requested\s*:\s*true/.test(code)) {
    throw new Error('CCG-80 executor contains an enabling publication flag');
  }
}

function assertGraphTargetsExist(workflow) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const [source, output] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) throw new Error('Connection source is not a node: ' + source);
    for (const branches of Object.values(output || {})) {
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        for (const edge of Array.isArray(branch) ? branch : []) {
          if (edge && !names.has(edge.node)) throw new Error('Connection target is not a node: ' + edge.node);
        }
      }
    }
  }
}

function validateWorkflow(workflow) {
  if (!workflow || workflow.id !== WORKFLOW_ID || workflow.name !== WORKFLOW_NAME) {
    throw new Error('Candidate identity does not match Campaign Creative Creator');
  }
  if (workflow.active === true) throw new Error('Candidate must remain inactive');
  const names = nodesByName(workflow);
  assertUniqueIds(workflow.nodes);
  assertGraphTargetsExist(workflow);
  for (const name of REQUIRED_MODULE_NODES) {
    if (!names.has(name)) throw new Error('Candidate is missing node: ' + name);
  }
  for (const name of INTERMEDIATE_FIXTURES) {
    if (names.has(name)) throw new Error('Intermediate fixture remains: ' + name);
  }
  if (names.has('Build CCG-00 dry-run fixture') === false) throw new Error('Manual CCG-00 dry-run fixture was removed');
  if (names.has('Build CCG-99 retryable fixture') === false) throw new Error('CCG-99 retryable fixture was removed');
  if (!names.has('Operational Production Request') || !names.has('CCG-80 Production Executor')) {
    throw new Error('Operational trigger or executor is missing');
  }
  if (workflow.nodes.filter((node) => node.name === 'Operational Production Request').length !== 1) {
    throw new Error('Expected exactly one operational trigger');
  }
  const requiredEdges = [
    ['Operational Production Request', 'CCG-00 Parse & Normalize'],
    ['CCG-00 Return Module Result', 'CCG-10 Validate CCG-00 Input'],
    ['CCG-10 Return Module Result', 'CCG-20 Validate CCG-10 Input'],
    ['CCG-20 Return Module Result', 'CCG-30 Validate CCG-20 Input'],
    ['CCG-30 Return Module Result', 'CCG-40 Validate CCG-30 Input'],
    ['CCG-40 Return Module Result', 'CCG-50 Validate CCG-40 Input'],
    ['CCG-50 Return Module Result', 'CCG-60 Validate CCG-50 Input'],
    ['CCG-60 Return Module Result', 'CCG-70 Validate CCG-60 Input'],
    ['CCG-70 Return Module Result', 'CCG-80 Validate CCG-70 Input'],
    ['CCG-80 Return Module Result', 'CCG-80 Production Executor'],
    ['CCG-80 Production Executor', 'CCG-90 Validate CCG-80 Input'],
  ];
  for (const [source, target] of requiredEdges) {
    if (!hasEdge(workflow, source, target)) throw new Error('Missing required edge: ' + source + ' -> ' + target);
  }
  for (const source of INTERMEDIATE_FIXTURES) {
    if (workflow.connections && workflow.connections[source]) throw new Error('Fixture connection remains: ' + source);
  }
  assertRuntimeSafety(workflow);
  assertExecutorContract(names.get('CCG-80 Production Executor'));
  if (!workflow.meta || workflow.meta.codex_builder_version !== BUILDER_VERSION) {
    throw new Error('Candidate builder metadata is missing or stale');
  }
  if (workflow.meta.no_publication !== true) throw new Error('Candidate publication guard metadata is missing');
  return { nodeCount: workflow.nodes.length, edgeCount: countEdges(workflow) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input || process.env.CCG_OUTPUT_FILE;
  if (!inputPath) throw new Error('Usage: validate... --input <candidate.json>');
  const workflow = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const result = validateWorkflow(workflow);
  process.stdout.write('Campaign Creative Creator continuous validation: OK (' + result.nodeCount + ' nodes, ' + result.edgeCount + ' edges)\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write((error && error.stack ? error.stack : error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { UNSAFE_RUNTIME_PATTERNS, countEdges, hasEdge, validateWorkflow };
