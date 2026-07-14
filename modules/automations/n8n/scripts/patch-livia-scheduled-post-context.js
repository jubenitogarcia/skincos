#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const WORKFLOW_EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

function sqlite(sql) {
  return childProcess.execFileSync('sqlite3', [DB_PATH, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80,
  });
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function getWorkflow() {
  return JSON.parse(sqlite(
    `SELECT json_object(
      'id', id,
      'name', name,
      'active', active,
      'nodes', json(nodes),
      'connections', json(connections),
      'settings', json(settings),
      'staticData', json(staticData),
      'pinData', json(pinData),
      'meta', json(meta),
      'versionId', versionId
    ) FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`,
  ));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

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

  consideredFiles += 1;
  seen.add(hhmm);

  scheduledPosts.push({
    targetDate,
    time: hhmm,
    hour: hh,
    minute: mm,
    waitUntil: waitAt.toISO(),
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

const searchFileQuery = `=name contains '{{ $json.postPrefix }}' and not properties has {key = 'published' and value = 'true'} and trashed = false`;

function patchWorkflow(workflow) {
  const extractTimes = findNode(workflow, 'Extract Times');
  const splitOut = findNode(workflow, 'Split Out');
  const triggerSchedule = findNode(workflow, 'Trigger Schedule');
  const searchFile = findNode(workflow, 'Search File');

  extractTimes.parameters = {
    ...(extractTimes.parameters || {}),
    jsCode: extractTimesCode,
  };

  splitOut.parameters = {
    fieldToSplitOut: 'scheduledPosts',
    options: {},
  };

  triggerSchedule.parameters = {
    ...(triggerSchedule.parameters || {}),
    resume: 'specificTime',
    dateTime: '={{ $json.waitUntil }}',
  };

  searchFile.parameters = {
    ...(searchFile.parameters || {}),
    resource: 'fileFolder',
    searchMethod: 'query',
    queryString: searchFileQuery,
    returnAll: true,
    filter: {
      ...(searchFile.parameters?.filter || {}),
      includeTrashed: false,
    },
  };

  return workflow;
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function main() {
  const current = getWorkflow();
  if (!current?.id) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-scheduled-post-context.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const patched = patchWorkflow({
    ...current,
    nodes: JSON.parse(JSON.stringify(current.nodes || [])),
    connections: JSON.parse(JSON.stringify(current.connections || {})),
    settings: JSON.parse(JSON.stringify(current.settings || {})),
    staticData: current.staticData || null,
    pinData: current.pinData || null,
    meta: {
      ...(current.meta || {}),
      codexPatch: {
        ...(current.meta?.codexPatch || {}),
        name: 'livia-scheduled-post-context',
        appliedAt: new Date().toISOString(),
      },
    },
  });

  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const versionId = crypto.randomUUID();
  const versionCounter = Number(sqlite(`SELECT versionCounter FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`).trim() || '0') + 1;

  sqlite([
    'UPDATE workflow_entity SET',
    `nodes=${sqlString(JSON.stringify(patched.nodes))},`,
    `connections=${sqlString(JSON.stringify(patched.connections))},`,
    `settings=${sqlString(JSON.stringify(patched.settings || {}))},`,
    `staticData=${sqlString(JSON.stringify(patched.staticData || {}))},`,
    `pinData=${sqlString(JSON.stringify(patched.pinData || {}))},`,
    `meta=${sqlString(JSON.stringify(patched.meta || {}))},`,
    `versionId=${sqlString(versionId)},`,
    `activeVersionId=${sqlString(versionId)},`,
    `versionCounter=${versionCounter},`,
    `updatedAt=${sqlString(updatedAt)}`,
    `WHERE id=${sqlString(WORKFLOW_ID)};`,
  ].join(' '));

  const exported = {
    ...patched,
    versionId,
  };

  for (const exportPath of WORKFLOW_EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

  console.log(`Patched workflow ${WORKFLOW_ID}`);
  console.log(`Backup: ${backupPath}`);
  for (const exportPath of WORKFLOW_EXPORT_PATHS) {
    console.log(`Export: ${exportPath}`);
  }
}

main();
