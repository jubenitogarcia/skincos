#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

const extractTimesCode = `const items = $input.all();

function str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function getTargetDate() {
  try {
    if (typeof $now !== "undefined" && $now && typeof $now.toFormat === "function") {
      return $now.toFormat("ddMMyy");
    }
  } catch {}

  return "";
}

const targetDate = getTargetDate();
const seen = new Set();

let ignoredWithoutPattern = 0;
let ignoredWrongDate = 0;
let ignoredInvalidTime = 0;
let ignoredPastTime = 0;
let consideredFiles = 0;

const scheduledPosts = [];

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

  if (seen.has(hhmm)) {
    continue;
  }

  const hh = Number.parseInt(hhmm.slice(0, 2), 10);
  const mm = Number.parseInt(hhmm.slice(2, 4), 10);

  if (
    Number.isNaN(hh) ||
    Number.isNaN(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    ignoredInvalidTime += 1;
    continue;
  }

  const waitAt = $now.set({
    hour: hh,
    minute: mm,
    second: 0,
    millisecond: 0,
  });

  if (waitAt <= $now) {
    ignoredPastTime += 1;
    continue;
  }

  const waitUntil = waitAt.toISO();
  if (!waitUntil) {
    ignoredInvalidTime += 1;
    continue;
  }

  consideredFiles += 1;
  seen.add(hhmm);

  scheduledPosts.push({
    targetDate,
    time: hhmm,
    hour: hh,
    minute: mm,
    waitUntil,
    postPrefix: \`\${fileDate}\${hhmm}\`,
  });
}

scheduledPosts.sort((a, b) => a.time.localeCompare(b.time));

const times = scheduledPosts.map((post) => post.time);
const waitUntilList = scheduledPosts.map((post) => post.waitUntil);

return [
  {
    json: {
      targetDate,
      hasPostsToPublish: scheduledPosts.length > 0,
      postCount: scheduledPosts.length,
      times,
      waitUntilList,
      scheduledPosts,
      nextPostTime: times[0] || null,
      nextWaitUntil: waitUntilList[0] || null,
      consideredFiles,
      ignored: {
        withoutPattern: ignoredWithoutPattern,
        wrongDate: ignoredWrongDate,
        invalidTime: ignoredInvalidTime,
        pastTime: ignoredPastTime,
      },
    },
  },
];`;

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function getWorkflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    versionCounter: row.versionCounter,
    updatedAt: row.updatedAt,
  };
}

function setMainConnection(connections, source, groups) {
  connections[source] = { ...(connections[source] || {}), main: groups };
}

function removeConnection(connections, source, target) {
  const main = connections[source]?.main;
  if (!Array.isArray(main)) return;
  connections[source].main = main.map((group) => (
    Array.isArray(group)
      ? group.filter((edge) => edge?.node !== target)
      : group
  ));
}

function upsertScheduleGuard(workflow) {
  const extractTimes = findNode(workflow, 'Extract Times');
  const splitOut = findNode(workflow, 'Split Out');
  const triggerSchedule = findNode(workflow, 'Trigger Schedule');

  extractTimes.parameters = {
    ...(extractTimes.parameters || {}),
    jsCode: extractTimesCode,
  };

  splitOut.parameters = {
    ...(splitOut.parameters || {}),
    fieldToSplitOut: 'scheduledPosts',
    options: splitOut.parameters?.options || {},
  };

  triggerSchedule.parameters = {
    ...(triggerSchedule.parameters || {}),
    resume: 'specificTime',
    dateTime: '={{ $json.waitUntil }}',
  };

  let guard = workflow.nodes.find((node) => node.name === 'Has Scheduled Posts');
  if (!guard) {
    guard = {
      parameters: {},
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [
        Math.round((extractTimes.position[0] + splitOut.position[0]) / 2),
        extractTimes.position[1],
      ],
      id: crypto.randomUUID(),
      name: 'Has Scheduled Posts',
    };
    workflow.nodes.push(guard);
  }

  guard.type = 'n8n-nodes-base.if';
  guard.typeVersion = 2.2;
  guard.parameters = {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [
        {
          id: 'a65d574b-00fa-4c40-9f75-0cb4bf58edc2',
          leftValue: '={{ $json.hasPostsToPublish === true && Array.isArray($json.scheduledPosts) && $json.scheduledPosts.length > 0 }}',
          rightValue: '',
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    options: {},
  };

  const connections = workflow.connections || {};
  removeConnection(connections, 'Extract Times', 'Split Out');
  setMainConnection(connections, 'Extract Times', [[{ node: 'Has Scheduled Posts', type: 'main', index: 0 }]]);
  setMainConnection(connections, 'Has Scheduled Posts', [
    [{ node: 'Split Out', type: 'main', index: 0 }],
    [],
  ]);
  setMainConnection(connections, 'Split Out', [[{ node: 'Trigger Schedule', type: 'main', index: 0 }]]);
  workflow.connections = connections;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = getWorkflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-schedule-guard.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const patched = {
    ...current,
    nodes: JSON.parse(JSON.stringify(current.nodes || [])),
    connections: JSON.parse(JSON.stringify(current.connections || {})),
    settings: JSON.parse(JSON.stringify(current.settings || {})),
    staticData: current.staticData || {},
    pinData: current.pinData || {},
    meta: {
      ...(current.meta || {}),
      codexPatch: {
        ...(current.meta?.codexPatch || {}),
        name: 'livia-schedule-guard',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  upsertScheduleGuard(patched);

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodes = JSON.stringify(patched.nodes);
  const connections = JSON.stringify(patched.connections);
  const settings = JSON.stringify(patched.settings || {});
  const staticData = JSON.stringify(patched.staticData || {});
  const pinData = JSON.stringify(patched.pinData || {});
  const meta = JSON.stringify(patched.meta || {});
  const description = row.description || null;

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      WORKFLOW_ID,
      'Codex',
      updatedAt,
      updatedAt,
      nodes,
      connections,
      patched.name,
      0,
      description,
    );

    db.prepare(`
      UPDATE workflow_entity
      SET
        nodes = ?,
        connections = ?,
        settings = ?,
        staticData = ?,
        pinData = ?,
        meta = ?,
        versionId = ?,
        activeVersionId = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nodes,
      connections,
      settings,
      staticData,
      pinData,
      meta,
      versionId,
      versionId,
      updatedAt,
      WORKFLOW_ID,
    );
  });

  save();

  const exported = {
    ...patched,
    versionId,
    activeVersionId: versionId,
    updatedAt,
  };
  for (const exportPath of EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

  const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  if (fkIssues.length) {
    throw new Error(`foreign_key_check failed: ${JSON.stringify(fkIssues)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    workflowId: WORKFLOW_ID,
    previousVersionId: current.versionId,
    previousActiveVersionId: current.activeVersionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
    nodes: exported.nodes.length,
    connectionSources: Object.keys(exported.connections || {}).length,
  }, null, 2));
}

main();
