#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const AUTHORS = 'Codex';
const BASELINE_PATH = path.join(runtimePaths.workflowsDir, 'livia.active.json');
const CHECKPOINT_DIR = path.join(runtimePaths.workflowsDir, 'checkpoints');
const LEGACY_TMP_PATHS = [
  '/home/julia/Automation/n8n/tmp',
  '/Users/jubenitogarcia/Automation/n8n/tmp',
];
const LEGACY_ROOT_PATHS = [
  '/home/julia/Automation/n8n',
  '/Users/jubenitogarcia/Automation/n8n',
];
const LEGACY_PYTHON_PATH = '/Users/jubenitogarcia/.pyenv/versions/3.12.4/bin/python3';

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

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findNode(workflow, name) {
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === name);
  if (!node) {
    throw new Error(`Node "${name}" nao encontrado no workflow ${workflow.id || WORKFLOW_ID}.`);
  }
  return node;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function replaceAllLiteral(text, search, replacement) {
  return String(text || '').split(search).join(replacement);
}

function buildTmpDirGuardSource(indent = '  ') {
  const sharedTmpDir = runtimePaths.tmpDir.replace(/\\/g, '/').replace(/\/+$/g, '');
  return [
    `const defaultTmpDir = ${JSON.stringify(sharedTmpDir)};`,
    'function resolveRuntimeTmpDir(value) {',
    '  const normalized = String(value || "").trim().replace(/\\\\/g, "/").replace(/\\/+$/g, "");',
    '  if (normalized === defaultTmpDir || normalized.startsWith(`${defaultTmpDir}/`)) return normalized;',
    '  return defaultTmpDir;',
    '}',
    'const tmpDir = resolveRuntimeTmpDir($vars.LIVIA_TMP_DIR);',
  ].join(`\n${indent}`);
}

function hardenTmpDirOverride(text) {
  const sharedTmpDir = runtimePaths.tmpDir.replace(/\\/g, '/').replace(/\/+$/g, '');
  const guardSource = buildTmpDirGuardSource('  ');
  let next = String(text || '');
  next = replaceAllLiteral(
    next,
    `const tmpDir = String($vars.LIVIA_TMP_DIR || "${sharedTmpDir}");`,
    guardSource,
  );
  next = replaceAllLiteral(
    next,
    `const defaultTmpDir = "${sharedTmpDir}";
  const configuredTmpDir = String($vars.LIVIA_TMP_DIR || defaultTmpDir).trim();
  const tmpDir = (configuredTmpDir || defaultTmpDir).replace(/\\/+$/g, "");`,
    guardSource,
  );
  return next;
}

function replaceLegacyPaths(text) {
  let next = String(text || '');
  for (const legacyPath of LEGACY_TMP_PATHS) {
    next = replaceAllLiteral(next, legacyPath, runtimePaths.tmpDir);
  }
  for (const legacyPath of LEGACY_ROOT_PATHS) {
    next = replaceAllLiteral(next, legacyPath, runtimePaths.repoRoot);
  }
  next = replaceAllLiteral(
    next,
    `PYTHON_BIN="${LEGACY_PYTHON_PATH}"`,
    'PYTHON_BIN="${LIVIA_PYTHON_BIN:-python3}"',
  );
  return hardenTmpDirOverride(next);
}

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) {
    throw new Error(`Funcao ${functionName} nao encontrada no baseline da Livia.`);
  }

  let depth = 0;
  let seenBrace = false;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') {
      depth += 1;
      seenBrace = true;
    } else if (char === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Nao foi possivel extrair ${functionName} do baseline da Livia.`);
}

function buildInlineBqCode(buildPublishJobsSource) {
  return `const inputItems = (() => {
  try {
    if ($input && typeof $input.all === "function") return $input.all() || [];
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

function __bqAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __bqAsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function __bqRemoveNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => __bqRemoveNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = __bqRemoveNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

const payload = ($json && typeof $json === "object") ? $json : {};
const bootstrapItems = __bqAsArray(payload.bootstrapItems)
  .map((item) => {
    const source = __bqAsObject(item);
    const json = Object.prototype.hasOwnProperty.call(source, "json")
      ? __bqAsObject(source.json)
      : source;
    return { json };
  })
  .filter((item) => Object.keys(item.json).length);

if (!bootstrapItems.length) {
  throw new Error("BQ - Build Platform Job Graph: bootstrapItems vazio.");
}

${buildPublishJobsSource}

const builtJobs = __bqAsArray(buildPublishJobsFromLiviaInput(bootstrapItems))
  .map((item) => __bqAsObject(item && item.json))
  .filter((job) => Object.keys(job).length);

if (!builtJobs.length) {
  throw new Error("BQ - Build Platform Job Graph: buildPublishJobsFromLiviaInput nao produziu jobs.");
}

const jobKinds = [...new Set(
  builtJobs
    .map((job) => [job.platform, job.phase, job.step].filter(Boolean).join(":"))
    .filter(Boolean)
)];

const platformSummary = builtJobs.reduce((acc, job) => {
  const platform = String(job.platform || "unknown");
  const phase = String(job.phase || "unknown");
  acc[platform] = acc[platform] || { total: 0, phases: {} };
  acc[platform].total += 1;
  acc[platform].phases[phase] = (acc[platform].phases[phase] || 0) + 1;
  return acc;
}, {});

return [{
  json: __bqRemoveNulls({
    ...payload,
    jobs: builtJobs,
    jobCount: builtJobs.length,
    jobKinds,
    platformSummary,
    debug: {
      ...__bqAsObject(payload.debug),
      sourceNode: "BQ - Build Platform Job Graph",
      jobCount: builtJobs.length,
    },
  }),
}];
`;
}

function applyWorkflowPatch(currentWorkflow, baselineWorkflow) {
  const patched = clone(currentWorkflow);
  const baselineProcessMedia = findNode(baselineWorkflow, 'Process Media Asset');
  const baselineBuildPublishQueue = findNode(baselineWorkflow, 'Build Publish Queue');
  const buildPublishJobsSource = extractFunctionSource(
    String(baselineBuildPublishQueue.parameters && baselineBuildPublishQueue.parameters.jsCode),
    'buildPublishJobsFromLiviaInput',
  );

  const writeFile = findNode(patched, 'Write File');
  writeFile.parameters ||= {};
  writeFile.parameters.fileName = replaceLegacyPaths(writeFile.parameters.fileName);

  const cleanupTempFiles = findNode(patched, 'Cleanup Temp Files');
  cleanupTempFiles.parameters ||= {};
  cleanupTempFiles.parameters.command = replaceLegacyPaths(cleanupTempFiles.parameters.command);

  const processMediaAsset = findNode(patched, 'Process Media Asset');
  processMediaAsset.parameters ||= {};
  processMediaAsset.parameters.command = replaceLegacyPaths(
    baselineProcessMedia.parameters && baselineProcessMedia.parameters.command,
  );

  const bqBuildGraph = findNode(patched, 'BQ - Build Platform Job Graph');
  bqBuildGraph.parameters ||= {};
  bqBuildGraph.parameters.jsCode = buildInlineBqCode(buildPublishJobsSource);

  patched.meta = patched.meta && typeof patched.meta === 'object' ? patched.meta : {};
  patched.meta.codexSharedRuntimePatch = {
    name: 'livia-shared-runtime-paths-live',
    appliedAt: new Date().toISOString(),
    notes: [
      'Write File and Cleanup Temp Files now default to the shared runtime tmp dir.',
      'Process Media Asset now uses the inline shared implementation instead of a private julia path.',
      'BQ - Build Platform Job Graph now inlines buildPublishJobsFromLiviaInput instead of reading a private runner file.',
    ],
  };

  const nodesText = JSON.stringify(patched.nodes);
  const legacyMatches = [
    '/home/julia/Automation/n8n',
    '/Users/jubenitogarcia/Automation/n8n',
    LEGACY_PYTHON_PATH,
  ].filter((snippet) => nodesText.includes(snippet));

  if (legacyMatches.length) {
    throw new Error(`Patch incompleto: ainda existem referencias legadas em nodes: ${legacyMatches.join(', ')}`);
  }

  return patched;
}

function hasLegacyExecutablePath(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return [
    '/home/julia/Automation/n8n',
    '/Users/jubenitogarcia/Automation/n8n',
    LEGACY_PYTHON_PATH,
  ].some((snippet) => text.includes(snippet));
}

async function updateLiviaTmpVariable(client) {
  const result = await client.query(
    `UPDATE n8n_runtime.variables
        SET value = $1
      WHERE key = 'LIVIA_TMP_DIR'
        AND COALESCE(value, '') <> $1
      RETURNING key, value`,
    [runtimePaths.tmpDir],
  );

  return result.rowCount;
}

async function patchInactiveLegacyWorkflows(client) {
  const result = await client.query(
    `SELECT
       id,
       name,
       active,
       nodes,
       connections,
       settings,
       "staticData" AS "staticData",
       "pinData" AS "pinData",
       "versionId" AS "versionId",
       "activeVersionId" AS "activeVersionId",
       "versionCounter" AS "versionCounter",
       meta,
       description
     FROM n8n_runtime.workflow_entity
     WHERE id <> $1
       AND active = false
       AND (
         nodes::text LIKE '%/home/julia/Automation/n8n%'
         OR nodes::text LIKE '%/Users/jubenitogarcia/Automation/n8n%'
       )
     ORDER BY name`,
    [WORKFLOW_ID],
  );

  const patched = [];
  for (const row of result.rows) {
    const workflow = workflowFromRow(row);
    const originalNodesText = JSON.stringify(workflow.nodes);
    const patchedNodesText = replaceLegacyPaths(originalNodesText);
    if (patchedNodesText === originalNodesText) continue;

    const patchedNodes = JSON.parse(patchedNodesText);
    if (hasLegacyExecutablePath(patchedNodes)) {
      throw new Error(`Patch incompleto no workflow inativo ${workflow.id}: ainda ha caminho legado.`);
    }

    const versionId = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    const connectionsText = JSON.stringify(workflow.connections || {});
    const meta = workflow.meta && typeof workflow.meta === 'object' ? workflow.meta : {};
    meta.codexSharedRuntimePatch = {
      name: 'livia-shared-runtime-paths-live',
      appliedAt: updatedAt,
      notes: [
        'Inactive workflow migrated away from user-home runtime paths.',
      ],
    };

    await client.query(
      `INSERT INTO n8n_runtime.workflow_history
        ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
       VALUES
        ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
      [
        versionId,
        workflow.id,
        AUTHORS,
        updatedAt,
        JSON.stringify(patchedNodes),
        connectionsText,
        workflow.name,
        workflow.description || '',
      ],
    );

    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET nodes = $1::json,
              meta = $2::json,
              "versionId" = CAST($3 AS character varying),
              "activeVersionId" = CAST($3 AS character varying),
              "updatedAt" = $4,
              "versionCounter" = COALESCE("versionCounter", 0) + 1
        WHERE id = $5`,
      [
        JSON.stringify(patchedNodes),
        JSON.stringify(meta),
        versionId,
        updatedAt,
        workflow.id,
      ],
    );

    patched.push({ id: workflow.id, name: workflow.name, versionId });
  }

  return patched;
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || '',
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    versionCounter: Number(row.versionCounter || 0),
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

async function main() {
  const Client = loadPgClient();

  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`Baseline nao encontrado: ${BASELINE_PATH}`);
  }

  const baselineWorkflow = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });

  await client.connect();

  try {
    const currentResult = await client.query(
      `SELECT
         id,
         name,
         active,
         nodes,
         connections,
         settings,
         "staticData" AS "staticData",
         "pinData" AS "pinData",
         "versionId" AS "versionId",
         "activeVersionId" AS "activeVersionId",
         "versionCounter" AS "versionCounter",
         meta,
         description
       FROM n8n_runtime.workflow_entity
       WHERE id = $1`,
      [WORKFLOW_ID],
    );

    if (!currentResult.rows.length) {
      throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado em n8n_runtime.workflow_entity.`);
    }

    const currentWorkflow = workflowFromRow(currentResult.rows[0]);
    const patchedWorkflow = applyWorkflowPatch(currentWorkflow, baselineWorkflow);
    const nodesChanged = JSON.stringify(currentWorkflow.nodes) !== JSON.stringify(patchedWorkflow.nodes);
    const metaChanged = JSON.stringify(currentWorkflow.meta) !== JSON.stringify(patchedWorkflow.meta);

    const timestamp = nowStamp();
    const beforePath = path.join(
      CHECKPOINT_DIR,
      `livia.before-shared-runtime-path-fix.${timestamp}.json`,
    );
    const afterPath = path.join(
      CHECKPOINT_DIR,
      `livia.after-shared-runtime-path-fix.${timestamp}.json`,
    );

    writeJson(beforePath, currentWorkflow);
    writeJson(afterPath, patchedWorkflow);

    if (!nodesChanged && !metaChanged) {
      console.log(
        JSON.stringify(
          {
            workflowId: WORKFLOW_ID,
            changed: false,
            beforePath,
            afterPath,
            message: 'Nenhuma diferenca detectada apos aplicar o patch.',
          },
          null,
          2,
        ),
      );
      return;
    }

    const versionId = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    const nodesText = JSON.stringify(patchedWorkflow.nodes);
    const connectionsText = JSON.stringify(patchedWorkflow.connections);
    const settingsText = JSON.stringify(patchedWorkflow.settings || {});
    const staticDataText = JSON.stringify(patchedWorkflow.staticData || {});
    const metaText = JSON.stringify(patchedWorkflow.meta || {});
    let liviaTmpVariableUpdates = 0;
    let inactiveLegacyWorkflowPatches = [];

    await client.query('BEGIN');
    try {
      liviaTmpVariableUpdates = await updateLiviaTmpVariable(client);
      inactiveLegacyWorkflowPatches = await patchInactiveLegacyWorkflows(client);

      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
         VALUES
          ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
        [
          versionId,
          WORKFLOW_ID,
          AUTHORS,
          updatedAt,
          nodesText,
          connectionsText,
          patchedWorkflow.name,
          patchedWorkflow.description || '',
        ],
      );

      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes = $1::json,
                connections = $2::json,
                settings = $3::json,
                "staticData" = $4::json,
                meta = $5::json,
                "versionId" = CAST($6 AS character varying),
                "activeVersionId" = CAST($6 AS character varying),
                "updatedAt" = $7,
                "versionCounter" = COALESCE("versionCounter", 0) + 1,
                name = $8,
                description = $9
          WHERE id = $10`,
        [
          nodesText,
          connectionsText,
          settingsText,
          staticDataText,
          metaText,
          versionId,
          updatedAt,
          patchedWorkflow.name,
          patchedWorkflow.description || '',
          WORKFLOW_ID,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(
      JSON.stringify(
        {
          workflowId: WORKFLOW_ID,
          changed: true,
          previousVersionId: currentWorkflow.versionId,
          versionId,
          beforePath,
          afterPath,
          sharedTmpDir: runtimePaths.tmpDir,
          liviaTmpVariableUpdates,
          inactiveLegacyWorkflowPatches,
          patchedNodes: [
            'Write File',
            'Cleanup Temp Files',
            'Process Media Asset',
            'BQ - Build Platform Job Graph',
          ],
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
