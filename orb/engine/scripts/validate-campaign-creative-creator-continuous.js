#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  ALL_FIXTURE_NAMES,
  BUILDER_VERSION,
  ERROR_HANDLER_NODE_NAMES,
  ERROR_WORKFLOW_ID,
  INTERMEDIATE_FIXTURES,
  MODULES,
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
    if (argv[index] === '--error-input') result.errorInput = argv[++index];
    if (argv[index] === '--fixtures-input') result.fixturesInput = argv[++index];
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

function assertUniqueNames(nodes) {
  const names = new Set();
  for (const node of nodes) {
    if (!node.name || names.has(node.name)) throw new Error('Duplicate or missing node name: ' + node.name);
    names.add(node.name);
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

function assertModuleContinuity(workflow) {
  for (const moduleName of MODULES.slice(0, 9)) {
    const node = workflow.nodes.find((candidate) => candidate.name === `${moduleName} Return Module Result`);
    if (!node) continue;
    const code = node.parameters?.jsCode || '';
    if (!code.includes('...data') || !code.includes('module_trace') || !code.includes('ledger_events') || !code.includes('binary:')) {
      throw new Error(`${moduleName} return does not preserve the continuous data, binary, trace, and ledger contract`);
    }
  }
  const finalReturn = workflow.nodes.find((candidate) => candidate.name === 'CCG-90 Return Content Package');
  const finalCode = finalReturn?.parameters?.jsCode || '';
  if (!finalCode.includes("output_type: 'CONTENT_PACKAGE'")) {
    throw new Error('CCG-90 return does not expose CONTENT_PACKAGE');
  }
}

function validateWorkflow(workflow) {
  if (!workflow || workflow.id !== WORKFLOW_ID || workflow.name !== WORKFLOW_NAME) {
    throw new Error('Candidate identity does not match Campaign Creative Creator');
  }
  if (workflow.active === true) throw new Error('Candidate must remain inactive');
  const names = nodesByName(workflow);
  assertUniqueIds(workflow.nodes);
  assertUniqueNames(workflow.nodes);
  assertGraphTargetsExist(workflow);
  for (const name of REQUIRED_MODULE_NODES) {
    if (!names.has(name)) throw new Error('Candidate is missing node: ' + name);
  }
  for (const name of INTERMEDIATE_FIXTURES) {
    if (names.has(name)) throw new Error('Intermediate fixture remains: ' + name);
  }
  if (names.has('Build CCG-00 dry-run fixture') === false) throw new Error('Manual CCG-00 dry-run fixture was removed');
  for (const name of ERROR_HANDLER_NODE_NAMES) {
    if (names.has(name)) throw new Error('Error workflow node remains in main workflow: ' + name);
  }
  if (!names.has('Operational Production Request')) {
    throw new Error('Operational subworkflow trigger is missing');
  }
  if (workflow.nodes.filter((node) => node.name === 'Operational Production Request').length !== 1) {
    throw new Error('Expected exactly one operational trigger');
  }
  if (names.has('CCG-80 Production Executor')) throw new Error('Production executor must remain outside the first continuous route');
  if (workflow.settings?.errorWorkflow !== ERROR_WORKFLOW_ID) {
    throw new Error('Main workflow is not configured with the separate CCG-99 error workflow');
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
    ['CCG-80 Return Module Result', 'CCG-90 Validate CCG-80 Input'],
    ['Manual safe dry-run smoke', 'Build CCG-00 dry-run fixture'],
    ['Build CCG-00 dry-run fixture', 'CCG-00 Parse & Normalize'],
    ['CCG-60 Prepare Audio Planning Brief', 'CCG-60 Optional Applicability Gate'],
    ['CCG-60 Optional Applicability Gate', 'CCG-60 Optional Skip Result'],
    ['CCG-60 Optional Applicability Gate', 'CCG-60 Switch Audio Direction Mode'],
    ['CCG-60 Optional Skip Result', 'CCG-60 Return Module Result'],
    ['CCG-70 Prepare Timeline Planning Brief', 'CCG-70 Optional Applicability Gate'],
    ['CCG-70 Optional Applicability Gate', 'CCG-70 Optional Skip Result'],
    ['CCG-70 Optional Applicability Gate', 'CCG-70 Switch Timeline Mode'],
    ['CCG-70 Optional Skip Result', 'CCG-70 Return Module Result'],
  ];
  for (const [source, target] of requiredEdges) {
    if (!hasEdge(workflow, source, target)) throw new Error('Missing required edge: ' + source + ' -> ' + target);
  }
  for (const source of INTERMEDIATE_FIXTURES) {
    if (workflow.connections && workflow.connections[source]) throw new Error('Fixture connection remains: ' + source);
  }
  for (const fixture of ALL_FIXTURE_NAMES.slice(1)) {
    if (Object.values(workflow.connections || {}).some((output) => Object.values(output || {}).some((branches) =>
      Array.isArray(branches) && branches.some((branch) => Array.isArray(branch) && branch.some((edge) => edge?.node === fixture))))) {
      throw new Error('Post-CCG-00 fixture is connected to the main graph: ' + fixture);
    }
  }
  assertRuntimeSafety(workflow);
  assertModuleContinuity(workflow);
  if (!workflow.meta || workflow.meta.codex_builder_version !== BUILDER_VERSION) {
    throw new Error('Candidate builder metadata is missing or stale');
  }
  if (workflow.meta.no_publication !== true) throw new Error('Candidate publication guard metadata is missing');
  return { nodeCount: workflow.nodes.length, edgeCount: countEdges(workflow) };
}

function validateErrorWorkflow(workflow) {
  if (!workflow || workflow.id !== ERROR_WORKFLOW_ID || workflow.name !== 'Campaign Creative Creator - Error Handler') {
    throw new Error('Error workflow identity does not match Campaign Creative Creator - Error Handler');
  }
  if (workflow.active === true) throw new Error('Error workflow must remain inactive');
  const names = nodesByName(workflow);
  assertUniqueIds(workflow.nodes);
  assertUniqueNames(workflow.nodes);
  assertGraphTargetsExist(workflow);
  for (const name of ['Error Trigger', 'CCG-99 Normalize & Redact Error Event', 'CCG-99 Classify & Decide Recovery', 'CCG-99 Switch Recovery Action', 'CCG-99 Finalize Incident & Ledger', 'CCG-99 Return Error Handler Result']) {
    if (!names.has(name)) throw new Error('Error workflow is missing node: ' + name);
  }
  if (names.has('Build CCG-99 retryable fixture')) throw new Error('CCG-99 fixture was copied into the error workflow');
  if (workflow.settings?.errorWorkflow) throw new Error('Error workflow must not point to itself');
  assertRuntimeSafety(workflow);
  const code = workflow.nodes.map((node) => node.parameters?.jsCode || '').join('\n');
  if (/publish_allowed\s*:\s*true|publish_requested\s*:\s*true/.test(code)) {
    throw new Error('Error workflow contains an enabling publication flag');
  }
  if (!hasEdge(workflow, 'Error Trigger', 'CCG-99 Normalize & Redact Error Event')) {
    throw new Error('Error Trigger is not connected to CCG-99 normalization');
  }
  return { nodeCount: workflow.nodes.length, edgeCount: countEdges(workflow) };
}

function validateFixturesWorkflow(workflow) {
  if (!workflow || workflow.name !== 'Campaign Creative Creator - Module Fixtures') {
    throw new Error('Fixture catalog identity does not match Campaign Creative Creator');
  }
  if (workflow.active === true) throw new Error('Fixture catalog must remain inactive');
  assertUniqueIds(workflow.nodes);
  assertUniqueNames(workflow.nodes);
  if (Object.keys(workflow.connections || {}).length) throw new Error('Fixture catalog must not be an operational route');
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const fixture of ALL_FIXTURE_NAMES) {
    if (!names.has(fixture)) throw new Error('Fixture catalog is missing: ' + fixture);
  }
  assertRuntimeSafety(workflow);
  return { nodeCount: workflow.nodes.length, edgeCount: countEdges(workflow) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input || process.env.CCG_OUTPUT_FILE;
  if (!inputPath) throw new Error('Usage: validate... --input <candidate.json>');
  const workflow = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, ''));
  const errorInputPath = args.errorInput || process.env.CCG_ERROR_OUTPUT_FILE;
  const fixturesInputPath = args.fixturesInput || process.env.CCG_FIXTURES_OUTPUT_FILE;
  const result = validateWorkflow(workflow);
  const errorResult = errorInputPath
    ? validateErrorWorkflow(JSON.parse(fs.readFileSync(path.resolve(errorInputPath), 'utf8').replace(/^\uFEFF/, '')))
    : null;
  const fixturesResult = fixturesInputPath
    ? validateFixturesWorkflow(JSON.parse(fs.readFileSync(path.resolve(fixturesInputPath), 'utf8').replace(/^\uFEFF/, '')))
    : null;
  process.stdout.write('Campaign Creative Creator continuous validation: OK (' + result.nodeCount + ' nodes, ' + result.edgeCount + ' edges' +
    (errorResult ? '; error ' + errorResult.nodeCount + ' nodes' : '') +
    (fixturesResult ? '; fixtures ' + fixturesResult.nodeCount + ' nodes' : '') + ')\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write((error && error.stack ? error.stack : error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  UNSAFE_RUNTIME_PATTERNS,
  countEdges,
  hasEdge,
  validateErrorWorkflow,
  validateFixturesWorkflow,
  validateWorkflow,
};
