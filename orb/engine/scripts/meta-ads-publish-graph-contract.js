'use strict';

const CODE_NODE_TYPE = 'n8n-nodes-base.code';
const VIDEO_STAGING_ROOT = '/tmp/meta-ads-publish';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ifParameters(expression, id) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id,
        leftValue: expression,
        rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  };
}

const MANAGED_NODES = Object.freeze([
  {
    id: 'meta-publish-runner-health',
    name: 'Check Task Runner Health',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [3104, 568],
    parameters: {
      url: 'http://127.0.0.1:5681/health',
      options: { timeout: 5000, response: { response: { responseFormat: 'text' } } },
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    id: 'meta-publish-runner-health-attach',
    name: 'Attach Task Runner Health',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [3328, 568],
    parameters: { jsCode: '' },
  },
  {
    id: 'meta-publish-media-upload-plan',
    name: 'Prepare Media Upload Plan',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [3776, 496],
    parameters: { jsCode: '' },
  },
  {
    id: 'meta-publish-has-image-uploads',
    name: 'Has Images?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [6912, 496],
    parameters: ifParameters('={{ Number($json.media_upload_plan?.expected?.images || 0) > 0 }}', 'meta-publish-has-images'),
  },
  {
    id: 'meta-publish-no-image-upload',
    name: 'Emit No Image Upload',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [7360, 672],
    parameters: { jsCode: '' },
  },
  {
    id: 'meta-publish-has-video-uploads',
    name: 'Has Videos?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [3776, 304],
    parameters: ifParameters('={{ Number($json.media_upload_plan?.expected?.videos || 0) > 0 }}', 'meta-publish-has-videos'),
  },
  {
    id: 'meta-publish-no-video-upload',
    name: 'Emit No Video Upload',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [7808, 368],
    parameters: { jsCode: '' },
  },
  {
    id: 'meta-publish-aggregate-media-uploads',
    name: 'Aggregate Media Upload Results',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [8224, 496],
    parameters: { jsCode: '' },
  },
  {
    id: 'meta-publish-assemble-job-inputs',
    name: 'Assemble Job Inputs',
    type: CODE_NODE_TYPE,
    typeVersion: 2,
    position: [8656, 496],
    parameters: { jsCode: '' },
  },
]);

const REQUIRED_EDGES = Object.freeze([
  ['Build Payload', 0, 'Prepare Publish Run', 0],
  ['Prepare Publish Run', 0, 'Check Task Runner Health', 0],
  ['Check Task Runner Health', 0, 'Attach Task Runner Health', 0],
  ['Attach Task Runner Health', 0, 'Acquire Publish Run', 0],
  ['Acquire Publish Run', 0, 'Restore Publish Groups', 0],
  ['Restore Publish Groups', 0, 'Resume Drive Only?', 0],
  ['Resume Drive Only?', 0, 'Build Drive Finalization', 0],
  ['Resume Drive Only?', 1, 'Prepare Media Upload Plan', 0],
  ['Prepare Media Upload Plan', 0, 'Has Images?', 0],
  ['Prepare Media Upload Plan', 0, 'Has Videos?', 0],
  ['Prepare Media Upload Plan', 0, 'Livia', 0],
  ['Has Images?', 0, 'Prepare Gateway Uploads', 0],
  ['Has Images?', 1, 'Emit No Image Upload', 0],
  ['Normalize Gateway Upload', 0, 'Merge Media Upload Results', 0],
  ['Emit No Image Upload', 0, 'Merge Media Upload Results', 0],
  ['Has Videos?', 0, 'Prepare Video Upload Starts', 0],
  ['Has Videos?', 1, 'Emit No Video Upload', 0],
  ['Video Ready?', 0, 'Merge Media Upload Results', 1],
  ['Emit No Video Upload', 0, 'Merge Media Upload Results', 1],
  ['Merge Media Upload Results', 0, 'Aggregate Media Upload Results', 0],
  ['Livia', 0, 'Merge (2)', 0],
  ['Aggregate Media Upload Results', 0, 'Merge (2)', 1],
  ['Merge (2)', 0, 'Assemble Job Inputs', 0],
  ['Assemble Job Inputs', 0, 'Build Jobs', 0],
  ['Build Jobs', 0, 'Validate Meta Creative Payload', 0],
]);

function nodeByName(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function ensureNode(workflow, template, changes) {
  let node = nodeByName(workflow, template.name);
  if (!node) {
    node = clone(template);
    workflow.nodes.push(node);
    changes.push(`node_added:${template.name}`);
    return node;
  }
  for (const property of ['id', 'type', 'typeVersion']) {
    if (node[property] !== template[property]) {
      node[property] = template[property];
      changes.push(`node_${property}:${template.name}`);
    }
  }
  if (template.type !== CODE_NODE_TYPE && JSON.stringify(node.parameters || {}) !== JSON.stringify(template.parameters || {})) {
    node.parameters = clone(template.parameters);
    changes.push(`node_parameters:${template.name}`);
  }
  if (template.retryOnFail !== undefined) node.retryOnFail = template.retryOnFail;
  if (template.maxTries !== undefined) node.maxTries = template.maxTries;
  if (template.waitBetweenTries !== undefined) node.waitBetweenTries = template.waitBetweenTries;
  return node;
}

function setMainConnections(workflow, source, outputs, changes) {
  const current = workflow.connections[source] || {};
  const expectedMain = outputs.map((edges) => edges.map(([node, index]) => ({ node, type: 'main', index })));
  if (JSON.stringify(current.main || []) !== JSON.stringify(expectedMain)) {
    workflow.connections[source] = { ...current, main: expectedMain };
    changes.push(`connections:${source}`);
  }
}

function ensureVideoStagingPath(workflow, changes) {
  const classifier = nodeByName(workflow, 'Classify Media');
  if (!classifier || classifier.type !== CODE_NODE_TYPE) {
    throw new Error('Classify Media obrigatorio ausente ou nao e Code node.');
  }
  const source = String(classifier.parameters?.jsCode || '');
  const legacy = '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/${executionId}/${sourceId}';
  const target = VIDEO_STAGING_ROOT + '/${executionId}/${sourceId}';
  const next = source.replace(legacy, target);
  if (!next.includes(target)) {
    throw new Error('Classify Media nao contem o contrato de staging de video esperado.');
  }
  if (next !== source) {
    classifier.parameters.jsCode = next;
    changes.push('video_staging_root:Classify Media');
  }
}

function applyGraphContract(workflow) {
  const changes = [];
  workflow.nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  workflow.connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
  for (const template of MANAGED_NODES) ensureNode(workflow, template, changes);
  ensureVideoStagingPath(workflow, changes);

  const mergeUploads = nodeByName(workflow, 'Merge Media Upload Results');
  const mergeAi = nodeByName(workflow, 'Merge (2)');
  for (const merge of [mergeUploads, mergeAi]) {
    if (!merge) throw new Error('Merge obrigatorio ausente no workflow.');
    const expected = { mode: 'append', numberInputs: 2 };
    if (JSON.stringify(merge.parameters || {}) !== JSON.stringify(expected)) {
      merge.parameters = expected;
      changes.push(`merge_explicit:${merge.name}`);
    }
  }

  const buildJobs = nodeByName(workflow, 'Build Jobs');
  if (!buildJobs) throw new Error('Build Jobs ausente no workflow.');
  if (buildJobs.retryOnFail !== true || Number(buildJobs.maxTries) !== 3 || Number(buildJobs.waitBetweenTries) !== 5000) {
    buildJobs.retryOnFail = true;
    buildJobs.maxTries = 3;
    buildJobs.waitBetweenTries = 5000;
    changes.push('retry:Build Jobs');
  }

  setMainConnections(workflow, 'Prepare Publish Run', [[['Check Task Runner Health', 0]]], changes);
  setMainConnections(workflow, 'Check Task Runner Health', [[['Attach Task Runner Health', 0]]], changes);
  setMainConnections(workflow, 'Attach Task Runner Health', [[['Acquire Publish Run', 0]]], changes);
  setMainConnections(workflow, 'Resume Drive Only?', [
    [['Build Drive Finalization', 0]],
    [['Prepare Media Upload Plan', 0]],
  ], changes);
  setMainConnections(workflow, 'Prepare Media Upload Plan', [[
    ['Has Images?', 0],
    ['Has Videos?', 0],
    ['Livia', 0],
  ]], changes);
  setMainConnections(workflow, 'Has Images?', [
    [['Prepare Gateway Uploads', 0]],
    [['Emit No Image Upload', 0]],
  ], changes);
  setMainConnections(workflow, 'Emit No Image Upload', [[['Merge Media Upload Results', 0]]], changes);
  setMainConnections(workflow, 'Has Videos?', [
    [['Prepare Video Upload Starts', 0]],
    [['Emit No Video Upload', 0]],
  ], changes);
  setMainConnections(workflow, 'Emit No Video Upload', [[['Merge Media Upload Results', 1]]], changes);
  setMainConnections(workflow, 'Normalize Gateway Upload', [[['Merge Media Upload Results', 0]]], changes);
  setMainConnections(workflow, 'Video Ready?', [
    [['Merge Media Upload Results', 1]],
    [['Wait Video Processing', 0]],
  ], changes);
  setMainConnections(workflow, 'Merge Media Upload Results', [[['Aggregate Media Upload Results', 0]]], changes);
  setMainConnections(workflow, 'Aggregate Media Upload Results', [[['Merge (2)', 1]]], changes);
  setMainConnections(workflow, 'Livia', [[['Merge (2)', 0]]], changes);
  setMainConnections(workflow, 'Merge (2)', [[['Assemble Job Inputs', 0]]], changes);
  setMainConnections(workflow, 'Assemble Job Inputs', [[['Build Jobs', 0]]], changes);

  return changes;
}

function hasEdge(connections, source, output, target, input) {
  return Boolean((connections[source]?.main?.[output] || []).some((edge) => edge.node === target && Number(edge.index || 0) === input));
}

function validateGraphContract(workflow) {
  const failures = [];
  for (const template of MANAGED_NODES) {
    if (!nodeByName(workflow, template.name)) failures.push(`missing_node:${template.name}`);
  }
  for (const [source, output, target, input] of REQUIRED_EDGES) {
    if (!hasEdge(workflow.connections || {}, source, output, target, input)) {
      failures.push(`missing_edge:${source}[${output}]->${target}[${input}]`);
    }
  }
  for (const name of ['Merge Media Upload Results', 'Merge (2)']) {
    const node = nodeByName(workflow, name);
    if (node?.parameters?.mode !== 'append' || Number(node?.parameters?.numberInputs) !== 2) {
      failures.push(`merge_not_explicit:${name}`);
    }
  }
  const buildJobs = nodeByName(workflow, 'Build Jobs');
  if (buildJobs?.retryOnFail !== true || Number(buildJobs?.maxTries) !== 3) failures.push('build_jobs_retry_missing');
  const runnerHealth = nodeByName(workflow, 'Check Task Runner Health');
  if (runnerHealth?.parameters?.url !== 'http://127.0.0.1:5681/health') failures.push('runner_health_endpoint_invalid');
  const classifier = nodeByName(workflow, 'Classify Media');
  const classifierCode = String(classifier?.parameters?.jsCode || '');
  if (!classifierCode.includes(VIDEO_STAGING_ROOT + '/${executionId}/${sourceId}')) {
    failures.push('video_staging_path_not_runner_allowed');
  }
  return failures;
}

module.exports = {
  MANAGED_NODES,
  REQUIRED_EDGES,
  applyGraphContract,
  validateGraphContract,
};
