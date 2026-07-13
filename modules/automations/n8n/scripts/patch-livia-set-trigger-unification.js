#!/usr/bin/env node

const fs = require('fs');

const inputPath = process.argv[2] || 'workflows/livia.json';
const outputPath = process.argv[3] || inputPath;

const PUBLISH_TRIGGER_ID = '3b8729cd-3fab-47be-aa3c-d8d2c2dbb359';
const PLANNER_TRIGGER_ID = '9babc2dc-f64c-49c0-9876-a5c3fb253051';
const MERGE_TRIGGER_INPUTS_ID = 'a37c3e3c-8f94-4cb7-9270-25f1c4dd4f4c';
const MERGE_TRIGGER_INPUTS_NAME = 'Merge Trigger Update Inputs';
const GET_WORKFLOW_ID = 'eac57993-409d-4c55-bfc2-79095af9a881';
const BUILD_UPDATE_ID = '5097154f-a299-41d9-9d51-6fd7db7efceb';
const UPDATE_WORKFLOW_ID = 'f20388ed-b497-48c0-9f29-f52d9214cc3a';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeWorkflow(filePath, workflow) {
  fs.writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function getNodeById(workflow, id) {
  return workflow.nodes.find((entry) => entry.id === id);
}

function ensureUniqueName(workflow, desiredName, currentId) {
  const owner = workflow.nodes.find((entry) => entry.name === desiredName);
  if (!owner || owner.id === currentId) return desiredName;

  let suffix = 1;
  while (workflow.nodes.some((entry) => entry.name === `${desiredName} ${suffix}` && entry.id !== currentId)) {
    suffix += 1;
  }
  return `${desiredName} ${suffix}`;
}

function upsertNodeById(workflow, id, factory) {
  let node = getNodeById(workflow, id);
  if (!node) {
    node = factory();
    node.id = id;
    workflow.nodes.push(node);
    return node;
  }

  const next = factory(node);
  Object.assign(node, next, { id });
  return node;
}

function ensureMainConnection(workflow, source, target, targetIndex = 0, outputIndex = 0) {
  workflow.connections[source] = workflow.connections[source] || {};
  workflow.connections[source].main = workflow.connections[source].main || [];
  while (workflow.connections[source].main.length <= outputIndex) {
    workflow.connections[source].main.push([]);
  }
  const group = workflow.connections[source].main[outputIndex];
  if (!group.some((entry) => entry.node === target && entry.type === 'main' && entry.index === targetIndex)) {
    group.push({ node: target, type: 'main', index: targetIndex });
  }
}

function removeMainConnection(workflow, source, target) {
  const groups = workflow.connections[source]?.main;
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (let index = group.length - 1; index >= 0; index -= 1) {
      if (group[index]?.node === target) group.splice(index, 1);
    }
  }
}

function upsertMergeTriggerInputs(workflow) {
  let node = getNodeById(workflow, MERGE_TRIGGER_INPUTS_ID) || workflow.nodes.find((entry) => entry.name === MERGE_TRIGGER_INPUTS_NAME);
  if (!node) {
    node = {
      parameters: {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
      },
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [-7408, -1360],
      id: MERGE_TRIGGER_INPUTS_ID,
      name: MERGE_TRIGGER_INPUTS_NAME,
    };
    workflow.nodes.push(node);
  }

  node.id = MERGE_TRIGGER_INPUTS_ID;
  node.name = ensureUniqueName(workflow, MERGE_TRIGGER_INPUTS_NAME, MERGE_TRIGGER_INPUTS_ID);
  node.parameters = {
    ...(node.parameters || {}),
    mode: 'combine',
    combineBy: 'combineByPosition',
    options: node.parameters?.options || {},
  };
  node.type = 'n8n-nodes-base.merge';
  node.typeVersion = 3.2;
}

const EXTRACT_TIMES_CODE = `const items = $input.all();

function str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function getTargetDate() {
  try {
    if (typeof $now !== "undefined" && $now && typeof $now.plus === "function") {
      return $now.plus({ days: 1 }).toFormat("ddMMyy");
    }
  } catch {}
  return "";
}

const targetDate = getTargetDate();
const seen = new Set();
let ignoredWithoutPattern = 0;
let ignoredWrongDate = 0;
let ignoredInvalidTime = 0;
let consideredFiles = 0;

for (const item of items) {
  const name = str(item.json?.name);
  if (!name) {
    ignoredWithoutPattern += 1;
    continue;
  }

  const match = name.match(/^(\\d{6})(\\d{4})(?:\\D|$)/);
  if (!match) {
    ignoredWithoutPattern += 1;
    continue;
  }

  const fileDate = match[1];
  if (targetDate && fileDate !== targetDate) {
    ignoredWrongDate += 1;
    continue;
  }

  const hhmm = match[2];
  const hh = Number.parseInt(hhmm.slice(0, 2), 10);
  const mm = Number.parseInt(hhmm.slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    ignoredInvalidTime += 1;
    continue;
  }

  consideredFiles += 1;
  seen.add(hhmm);
}

const times = Array.from(seen).sort();
const cronExpressions = times.map((time) => {
  const hh = Number.parseInt(time.slice(0, 2), 10);
  const mm = Number.parseInt(time.slice(2, 4), 10);
  return \`0 \${mm} \${hh} * * *\`;
});

return [{
  json: {
    targetDate,
    times,
    cronExpressions,
    consideredFiles,
    ignored: {
      withoutPattern: ignoredWithoutPattern,
      wrongDate: ignoredWrongDate,
      invalidTime: ignoredInvalidTime,
    },
  },
}];`;

const BUILD_UPDATE_CODE = `const PUBLISH_TRIGGER_ID = "${PUBLISH_TRIGGER_ID}";
const PLANNER_TRIGGER_ID = "${PLANNER_TRIGGER_ID}";

function str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeTime(value) {
  const raw = str(value).trim();
  const compact = /^\\d{4}$/.test(raw) ? raw : /^\\d{2}:\\d{2}$/.test(raw) ? raw.replace(":", "") : "";
  if (!compact) return "";

  const hh = Number.parseInt(compact.slice(0, 2), 10);
  const mm = Number.parseInt(compact.slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return compact;
}

function sanitizeStaticData(staticData) {
  if (!staticData || typeof staticData !== "object") return staticData ?? null;
  const cloned = JSON.parse(JSON.stringify(staticData));
  if (cloned.global && typeof cloned.global === "object") {
    delete cloned.global.__pr;
  }
  return cloned;
}

const merged = $input.all().map((item) => item.json || {});
const wf = merged.find((item) => Array.isArray(item.nodes)) || {};
const schedulePlan = merged.find((item) => Array.isArray(item.times) || Array.isArray(item.cronExpressions)) || {};
const times = [...new Set((schedulePlan.times || []).map(normalizeTime).filter(Boolean))].sort();

if (!Array.isArray(wf.nodes)) {
  throw new Error("Workflow invalido: nodes nao encontrado no input combinado de Get Workflow.");
}

if (!times.length) {
  throw new Error("Build Update recebeu lista vazia de horarios; Has Times? deveria ter interrompido antes.");
}

const toInterval = (hhmm) => ({
  field: "cronExpression",
  expression: \`0 \${Number.parseInt(hhmm.slice(2, 4), 10)} \${Number.parseInt(hhmm.slice(0, 2), 10)} * * *\`,
});

let updatedPublishTrigger = false;
let preservedPlannerTrigger = false;

const nodes = wf.nodes.map((node) => {
  if (node.id === PLANNER_TRIGGER_ID) {
    preservedPlannerTrigger = true;
    return node;
  }

  if (node.id !== PUBLISH_TRIGGER_ID) return node;
  updatedPublishTrigger = true;

  return {
    ...node,
    parameters: {
      ...(node.parameters || {}),
      rule: {
        interval: times.map(toInterval),
      },
    },
  };
});

if (!updatedPublishTrigger) {
  throw new Error(\`Schedule Trigger de publicacao nao encontrado (id=\${PUBLISH_TRIGGER_ID}).\`);
}

if (!preservedPlannerTrigger) {
  throw new Error(\`Schedule Trigger planejador nao encontrado (id=\${PLANNER_TRIGGER_ID}).\`);
}

const currentSettings = wf.settings || {};
const settings = {};
if (typeof currentSettings.executionOrder === "string") settings.executionOrder = currentSettings.executionOrder;
settings.timezone = "America/Sao_Paulo";

const workflowObject = {
  name: wf.name,
  nodes,
  connections: wf.connections || {},
  settings,
  staticData: sanitizeStaticData(wf.staticData),
};

return [{
  json: {
    workflowObject: JSON.stringify(workflowObject),
    times,
    cronExpressions: times.map((time) => toInterval(time).expression),
    targetDate: schedulePlan.targetDate || "",
    updatedTriggerId: PUBLISH_TRIGGER_ID,
    preservedTriggerId: PLANNER_TRIGGER_ID,
    timezone: settings.timezone,
  },
}];`;

function main() {
  const workflow = readWorkflow(inputPath);
  workflow.connections = workflow.connections || {};

  const plannerTrigger = upsertNodeById(workflow, PLANNER_TRIGGER_ID, (existing = {}) => ({
    ...existing,
    parameters: {
      ...(existing.parameters || {}),
      rule: {
        interval: [{ triggerAtHour: 20 }],
      },
    },
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: existing.position || [-8528, -1776],
    name: existing.name || 'Schedule Trigger',
  }));

  plannerTrigger.name = ensureUniqueName(workflow, 'Schedule Trigger', PLANNER_TRIGGER_ID);

  const publishTrigger = upsertNodeById(workflow, PUBLISH_TRIGGER_ID, (existing = {}) => ({
    ...existing,
    parameters: {
      ...(existing.parameters || {}),
      rule: {
        interval: existing.parameters?.rule?.interval?.length
          ? existing.parameters.rule.interval
          : [{ field: 'cronExpression', expression: '0 0 10 * * *' }],
      },
    },
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: existing.position || [-7856, -1968],
    name: existing.name || 'Schedule Publish Trigger',
  }));

  publishTrigger.name = ensureUniqueName(workflow, 'Schedule Publish Trigger', PUBLISH_TRIGGER_ID);

  const listFiles = getNode(workflow, 'List Files');
  listFiles.position = [-8304, -1776];
  listFiles.parameters.limit = 200;

  const extractTimes = getNode(workflow, 'Extract Times');
  extractTimes.position = [-8080, -1776];
  extractTimes.parameters.jsCode = EXTRACT_TIMES_CODE;

  const hasTimes = getNode(workflow, 'Has Times?');
  hasTimes.position = [-7856, -1776];

  const getWorkflow = upsertNodeById(workflow, GET_WORKFLOW_ID, (existing = {}) => ({
    ...existing,
    parameters: {
      operation: 'get',
      workflowId: {
        __rl: true,
        value: WORKFLOW_ID,
        mode: 'id',
      },
      requestOptions: {},
    },
    type: 'n8n-nodes-base.n8n',
    typeVersion: 1,
    position: existing.position || [-7632, -1480],
    name: existing.name || 'Get Workflow',
    credentials: existing.credentials || {
      n8nApi: {
        id: 'x68Qrx6CbL0sHATP',
        name: 'n8n account',
      },
    },
  }));
  getWorkflow.name = ensureUniqueName(workflow, 'Get Workflow', GET_WORKFLOW_ID);

  const buildUpdate = upsertNodeById(workflow, BUILD_UPDATE_ID, (existing = {}) => ({
    ...existing,
    parameters: existing.parameters || {},
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: existing.position || [-7184, -1480],
    name: existing.name || 'Build Update',
  }));
  buildUpdate.name = ensureUniqueName(workflow, 'Build Update', BUILD_UPDATE_ID);
  buildUpdate.parameters.jsCode = BUILD_UPDATE_CODE;

  const updateWorkflow = upsertNodeById(workflow, UPDATE_WORKFLOW_ID, (existing = {}) => ({
    ...existing,
    parameters: {
      operation: 'update',
      workflowId: {
        __rl: true,
        value: WORKFLOW_ID,
        mode: 'id',
      },
      workflowObject: '={{ $json.workflowObject }}',
      requestOptions: {},
    },
    type: 'n8n-nodes-base.n8n',
    typeVersion: 1,
    position: existing.position || [-6960, -1480],
    name: existing.name || 'Update Workflow',
    credentials: existing.credentials || {
      n8nApi: {
        id: 'x68Qrx6CbL0sHATP',
        name: 'n8n account',
      },
    },
  }));
  updateWorkflow.name = ensureUniqueName(workflow, 'Update Workflow', UPDATE_WORKFLOW_ID);

  const searchFile = getNode(workflow, 'Search File');
  searchFile.parameters.queryString = `=name contains '{{(() => {
  const tzRaw = "America/Sao_Paulo" || "UTC";
  const tz = tzRaw.split(" ")[0];

  return DateTime
    .fromISO($json.timestamp)
    .setZone(tz)
    .set({ second: 0, millisecond: 0 })
    .toFormat("ddMMyyHHmm");
})()}}' and not properties has {key = 'published' and value = 'true'} and trashed = false`;

  upsertMergeTriggerInputs(workflow);
  const mergeTriggerInputs = getNodeById(workflow, MERGE_TRIGGER_INPUTS_ID);
  mergeTriggerInputs.position = [-7408, -1480];

  removeMainConnection(workflow, hasTimes.name, 'Search File');
  removeMainConnection(workflow, hasTimes.name, 'Credential');
  removeMainConnection(workflow, getWorkflow.name, buildUpdate.name);
  removeMainConnection(workflow, plannerTrigger.name, 'Search File');
  removeMainConnection(workflow, plannerTrigger.name, 'Credential');
  removeMainConnection(workflow, publishTrigger.name, 'List Files');

  workflow.connections[publishTrigger.name] = {
    main: [[
      { node: 'Search File', type: 'main', index: 0 },
      { node: 'Credential', type: 'main', index: 0 },
    ]],
  };
  workflow.connections[plannerTrigger.name] = {
    main: [[{ node: 'List Files', type: 'main', index: 0 }]],
  };

  ensureMainConnection(workflow, hasTimes.name, getWorkflow.name, 0, 0);
  ensureMainConnection(workflow, hasTimes.name, mergeTriggerInputs.name, 0, 0);
  ensureMainConnection(workflow, getWorkflow.name, mergeTriggerInputs.name, 1, 0);
  workflow.connections[mergeTriggerInputs.name] = {
    main: [[{ node: buildUpdate.name, type: 'main', index: 0 }]],
  };
  workflow.connections[buildUpdate.name] = {
    main: [[{ node: updateWorkflow.name, type: 'main', index: 0 }]],
  };
  workflow.connections[updateWorkflow.name] = {
    main: [[]],
  };

  if (workflow.staticData?.global?.__pr) {
    delete workflow.staticData.global.__pr;
  }

  writeWorkflow(outputPath, workflow);
  console.log(JSON.stringify({
    inputPath,
    outputPath,
    nodes: workflow.nodes.length,
    patched: [
      'List Files',
      'Extract Times',
      'Search File',
      'Build Update',
      MERGE_TRIGGER_INPUTS_NAME,
      publishTrigger.name,
      plannerTrigger.name,
    ],
  }, null, 2));
}

main();
