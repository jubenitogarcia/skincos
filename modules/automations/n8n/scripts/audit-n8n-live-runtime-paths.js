#!/usr/bin/env node

'use strict';

const runtimePaths = require('./lib/runtime-paths');

const LEGACY_PATHS = [
  '/home/julia/Automation/n8n',
  '/Users/jubenitogarcia/Automation/n8n',
];

function loadPgClient() {
  try {
    return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client;
  } catch {
    try {
      return require('pg').Client;
    } catch {
      throw new Error(
        'Nao foi possivel carregar o cliente pg. Rode dentro do runtime WSL com o n8n global instalado.',
      );
    }
  }
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function isInsideSharedRuntimeTmp(value) {
  const sharedTmpDir = normalizePath(runtimePaths.tmpDir);
  const normalized = normalizePath(value);
  return normalized === sharedTmpDir || normalized.startsWith(`${sharedTmpDir}/`);
}

async function main() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });

  await client.connect();

  try {
    const findings = [];

    const legacyVariableResult = await client.query(
      `SELECT key, value
         FROM n8n_runtime.variables
        WHERE value LIKE '%/home/julia/Automation/n8n%'
           OR value LIKE '%/Users/jubenitogarcia/Automation/n8n%'
        ORDER BY key`,
    );
    for (const row of legacyVariableResult.rows) {
      findings.push({
        area: 'variables',
        item: row.key,
        reason: 'legacy user-home path',
        value: row.value,
      });
    }

    const liviaTmpResult = await client.query(
      `SELECT key, value
         FROM n8n_runtime.variables
        WHERE key = 'LIVIA_TMP_DIR'`,
    );
    for (const row of liviaTmpResult.rows) {
      if (!isInsideSharedRuntimeTmp(row.value)) {
        findings.push({
          area: 'variables',
          item: row.key,
          reason: 'LIVIA_TMP_DIR must stay inside shared runtime tmp',
          value: row.value,
        });
      }
    }

    const legacyWorkflowResult = await client.query(
      `SELECT id, name, active
         FROM n8n_runtime.workflow_entity
        WHERE nodes::text LIKE '%/home/julia/Automation/n8n%'
           OR nodes::text LIKE '%/Users/jubenitogarcia/Automation/n8n%'
        ORDER BY active DESC, name, id`,
    );
    for (const row of legacyWorkflowResult.rows) {
      findings.push({
        area: 'workflow_entity',
        item: `${row.id}:${row.name}`,
        reason: row.active ? 'active workflow has legacy path' : 'inactive executable workflow has legacy path',
        value: row.active ? 'active' : 'inactive',
      });
    }

    if (findings.length) {
      console.error('Live n8n runtime path audit failed:');
      for (const finding of findings) {
        console.error(
          `- ${finding.area} ${finding.item}: ${finding.reason} (${finding.value})`,
        );
      }
      process.exit(1);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sharedTmpDir: normalizePath(runtimePaths.tmpDir),
          checked: ['variables', 'workflow_entity'],
          ignoredHistoryTables: ['workflow_history', 'execution_data'],
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
