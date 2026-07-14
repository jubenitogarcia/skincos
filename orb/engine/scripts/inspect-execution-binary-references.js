#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');

const executionId = Number(process.argv[2]);
if (!Number.isInteger(executionId) || executionId < 1) {
  console.error('Usage: inspect-execution-binary-references.js <execution-id>');
  process.exit(2);
}

async function main() {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT data FROM n8n_runtime.execution_data WHERE "executionId"=$1',
      [executionId],
    );
    if (!result.rows[0]) throw new Error(`Execution ${executionId} not found.`);
    const root = parse(result.rows[0].data);
    const visited = new WeakSet();
    const references = new Map();
    const objects = [];
    function walk(value) {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      objects.push(value);
      if (typeof value.id === 'string' && value.id.startsWith('filesystem-v2:')) {
        const reference = value.id.slice('filesystem-v2:'.length);
        references.set(reference, {
          reference,
          fileName: value.fileName || null,
          directory: value.directory || null,
          mimeType: value.mimeType || null,
          fileExtension: value.fileExtension || null,
          fileSize: value.fileSize || null,
        });
      }
      for (const entry of Object.values(value)) walk(entry);
    }
    walk(root);
    const fileNames = new Set([...references.values()].map((item) => item.fileName).filter(Boolean));
    const sourceCandidates = objects
      .filter((value) => fileNames.has(value.name || value.fileName))
      .filter((value) => typeof value.id === 'string' && !value.id.startsWith('filesystem-v2:'))
      .map((value) => ({
        id: value.id,
        name: value.name || value.fileName,
        mimeType: value.mimeType || null,
        modifiedTime: value.modifiedTime || null,
        size: value.size || null,
      }))
      .filter((value, index, array) => array.findIndex((item) => item.id === value.id) === index);
    console.log(JSON.stringify({ executionId, references: [...references.values()], sourceCandidates }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
