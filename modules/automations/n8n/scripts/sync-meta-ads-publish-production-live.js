#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const MAIN_WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const ERROR_WORKFLOW_ID = 'metaAdsPublishErrorV1';
const EXPECTED_BASE_VERSION_ID = 'ca4bc723-d69b-4ce5-8947-69cdeaea999d';
const GATEWAY_CREDENTIAL_ID = 'metaPublishGatewayBearer';
const GATEWAY_CREDENTIAL_NAME = 'Meta Ads Publish - Gateway Bearer';
const APPLY = process.argv.includes('--apply');
const AUTHORS = 'Codex production hardening';

const mainPath = path.join(runtimePaths.workflowsDir, 'meta-ads-publish.current.json');
const errorPath = path.join(runtimePaths.workflowsDir, 'meta-ads-publish-error.current.json');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function workflowFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || '',
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    versionCounter: Number(row.versionCounter || 0),
  };
}

function getKeyAndIv(salt, encryptionKey) {
  const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
  const hash1 = crypto.createHash('md5').update(password).digest();
  const hash2 = crypto.createHash('md5').update(Buffer.concat([hash1, password])).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([hash2, password])).digest();
  return [Buffer.concat([hash1, hash2]), iv];
}

function encryptCredentialData(payload, encryptionKey) {
  const salt = crypto.randomBytes(8);
  const [key, iv] = getKeyAndIv(salt, encryptionKey);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__'), salt, encrypted]).toString('base64');
}

function hashWorkflow(workflow) {
  return crypto.createHash('sha256').update(JSON.stringify({
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  })).digest('hex');
}

async function loadWorkflow(client, id) {
  const result = await client.query(
    `SELECT id, name, active, nodes, connections, settings,
            "staticData" AS "staticData", "pinData" AS "pinData", meta,
            description, "versionId" AS "versionId",
            "activeVersionId" AS "activeVersionId", "versionCounter" AS "versionCounter"
       FROM n8n_runtime.workflow_entity WHERE id = $1`,
    [id],
  );
  return workflowFromRow(result.rows[0]);
}

async function insertHistory(client, workflow, versionId, createdAt) {
  await client.query(
    `INSERT INTO n8n_runtime.workflow_history
      ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
       connections, name, autosaved, description)
     VALUES ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
    [
      versionId,
      workflow.id,
      AUTHORS,
      createdAt,
      JSON.stringify(workflow.nodes),
      JSON.stringify(workflow.connections),
      workflow.name,
      workflow.description || '',
    ],
  );
}

async function updateMain(client, desired, current, projectId) {
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await insertHistory(client, desired, versionId, now);
  await client.query(
    `UPDATE n8n_runtime.workflow_entity
        SET name = $1,
            active = false,
            nodes = $2::json,
            connections = $3::json,
            settings = $4::json,
            "staticData" = NULL,
            "pinData" = NULL,
            meta = $5::json,
            description = $6,
            "versionId" = $7::character(36),
            "activeVersionId" = NULL,
            "versionCounter" = COALESCE("versionCounter", 0) + 1,
            "updatedAt" = $8
      WHERE id = $9`,
    [
      desired.name,
      JSON.stringify(desired.nodes),
      JSON.stringify(desired.connections),
      JSON.stringify(desired.settings || {}),
      JSON.stringify(desired.meta || {}),
      desired.description || '',
      versionId,
      now,
      MAIN_WORKFLOW_ID,
    ],
  );
  await client.query(
    `INSERT INTO n8n_runtime.shared_workflow ("workflowId", "projectId", role)
     VALUES ($1, $2, 'workflow:owner')
     ON CONFLICT ("workflowId", "projectId") DO UPDATE SET role = excluded.role, "updatedAt" = CURRENT_TIMESTAMP`,
    [MAIN_WORKFLOW_ID, projectId],
  );
  return { ...desired, active: false, versionId, activeVersionId: null, versionCounter: current.versionCounter + 1 };
}

async function upsertErrorWorkflow(client, desired, projectId) {
  const current = await loadWorkflow(client, ERROR_WORKFLOW_ID);
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  if (current) {
    await insertHistory(client, desired, versionId, now);
    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET name = $1, active = false, nodes = $2::json, connections = $3::json,
              settings = $4::json, "staticData" = NULL, "pinData" = NULL,
               meta = $5::json, description = $6, "versionId" = $7::character(36),
               "activeVersionId" = NULL, "versionCounter" = COALESCE("versionCounter", 0) + 1,
              "updatedAt" = $8
        WHERE id = $9`,
      [desired.name, JSON.stringify(desired.nodes), JSON.stringify(desired.connections), JSON.stringify(desired.settings || {}), JSON.stringify(desired.meta || {}), desired.description || '', versionId, now, ERROR_WORKFLOW_ID],
    );
  } else {
    await client.query(
      `INSERT INTO n8n_runtime.workflow_entity
        (id, name, active, nodes, connections, settings, "staticData", "pinData", meta,
         description, "versionId", "activeVersionId", "versionCounter", "triggerCount",
         "isArchived", "createdAt", "updatedAt")
       VALUES ($1, $2, false, $3::json, $4::json, $5::json, NULL, NULL, $6::json,
                $7, $8::character(36), NULL, 0, 0, false, $9, $9)`,
      [ERROR_WORKFLOW_ID, desired.name, JSON.stringify(desired.nodes), JSON.stringify(desired.connections), JSON.stringify(desired.settings || {}), JSON.stringify(desired.meta || {}), desired.description || '', versionId, now],
    );
    await insertHistory(client, desired, versionId, now);
  }
  await client.query(
    `INSERT INTO n8n_runtime.shared_workflow ("workflowId", "projectId", role)
     VALUES ($1, $2, 'workflow:owner')
     ON CONFLICT ("workflowId", "projectId") DO UPDATE SET role = excluded.role, "updatedAt" = CURRENT_TIMESTAMP`,
    [ERROR_WORKFLOW_ID, projectId],
  );
  return { ...desired, active: false, versionId, activeVersionId: null, versionCounter: Number(current?.versionCounter || 0) + 1 };
}

async function upsertGatewayCredential(client, projectId, encryptedData) {
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO n8n_runtime.credentials_entity
      (id, name, data, type, "createdAt", "updatedAt", "isManaged", "isGlobal", "isResolvable", "resolvableAllowFallback", "resolverId")
     VALUES ($1, $2, $3, 'httpBearerAuth', $4, $4, false, false, false, false, NULL)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       data = excluded.data,
       type = excluded.type,
       "updatedAt" = excluded."updatedAt"`,
    [GATEWAY_CREDENTIAL_ID, GATEWAY_CREDENTIAL_NAME, encryptedData, now],
  );
  await client.query(
    `INSERT INTO n8n_runtime.shared_credentials ("credentialsId", "projectId", role)
     VALUES ($1, $2, 'credential:owner')
     ON CONFLICT ("credentialsId", "projectId") DO UPDATE SET role = excluded.role, "updatedAt" = CURRENT_TIMESTAMP`,
    [GATEWAY_CREDENTIAL_ID, projectId],
  );
}

async function main() {
  const desiredMain = readJson(mainPath);
  const desiredError = readJson(errorPath);
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const current = await loadWorkflow(client, MAIN_WORKFLOW_ID);
    if (!current) throw new Error(`Workflow ${MAIN_WORKFLOW_ID} not found.`);
    const project = await client.query(
      `SELECT "projectId" FROM n8n_runtime.shared_workflow WHERE "workflowId" = $1 LIMIT 1`,
      [MAIN_WORKFLOW_ID],
    );
    const projectId = project.rows[0]?.projectId;
    if (!projectId) throw new Error('Main workflow project not found.');
    const variable = await client.query(
      `SELECT value FROM n8n_runtime.variables WHERE key = 'TOKEN_VAULT_API_TOKEN'`,
    );
    const gatewayToken = String(variable.rows[0]?.value || '').trim();
    if (!gatewayToken) throw new Error('TOKEN_VAULT_API_TOKEN is missing from n8n variables.');
    const config = readJson(runtimePaths.configPath);
    if (!config.encryptionKey) throw new Error('n8n encryptionKey not found.');

    const desiredHash = hashWorkflow(desiredMain);
    const currentHash = hashWorkflow(current);
    const alreadyApplied = desiredHash === currentHash;
    if (!alreadyApplied && current.versionId !== EXPECTED_BASE_VERSION_ID) {
      throw new Error(`Live workflow drifted after checkpoint: expected ${EXPECTED_BASE_VERSION_ID}, got ${current.versionId}.`);
    }
    const summary = {
      apply: APPLY,
      alreadyApplied,
      currentVersionId: current.versionId,
      currentVersionCounter: current.versionCounter,
      desiredHash,
      currentHash,
      projectId,
      gatewayCredentialPresent: Boolean(gatewayToken),
      gatewayCredentialLength: gatewayToken.length,
    };
    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const checkpointDir = path.join(runtimePaths.runtimeHome, 'exports', 'workflow-patches', `meta-ads-production-live-${timestamp()}`);
    writeJson(path.join(checkpointDir, 'main.before.json'), current);
    const existingError = await loadWorkflow(client, ERROR_WORKFLOW_ID);
    if (existingError) writeJson(path.join(checkpointDir, 'error.before.json'), existingError);

    await client.query('BEGIN');
    let persistedMain;
    let persistedError;
    try {
      const encryptedCredential = encryptCredentialData({ token: gatewayToken }, config.encryptionKey);
      await upsertGatewayCredential(client, projectId, encryptedCredential);
      persistedError = await upsertErrorWorkflow(client, desiredError, projectId);
      if (alreadyApplied) {
        await client.query(
          `UPDATE n8n_runtime.workflow_entity
              SET active = false, "activeVersionId" = NULL
            WHERE id = $1`,
          [MAIN_WORKFLOW_ID],
        );
        persistedMain = { ...current, active: false, activeVersionId: null };
      } else {
        persistedMain = await updateMain(client, desiredMain, current, projectId);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    writeJson(path.join(checkpointDir, 'main.after.json'), persistedMain);
    writeJson(path.join(checkpointDir, 'error.after.json'), persistedError);
    writeJson(mainPath, persistedMain);
    writeJson(errorPath, persistedError);
    console.log(JSON.stringify({
      ...summary,
      checkpointDir,
      newVersionId: persistedMain.versionId,
      newVersionCounter: persistedMain.versionCounter,
      errorWorkflowVersionId: persistedError.versionId,
      gatewayCredentialId: GATEWAY_CREDENTIAL_ID,
      gatewaySecretPrinted: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
