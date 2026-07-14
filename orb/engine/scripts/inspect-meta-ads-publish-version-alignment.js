#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('./lib/meta-ads-publish-execution-semantics');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const MODEL_NODE = 'OpenAI Chat Model (Agent)';
const LEGACY_PARSER_NODE = 'Meta Publish Structured Output';
const STRICT = process.argv.includes('--strict');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function findObjectSchemaViolations(schema, path = '$', violations = []) {
  if (!schema || typeof schema !== 'object') return violations;
  if (schema.type === 'object' && schema.additionalProperties !== false) violations.push(path);
  for (const [key, child] of Object.entries(schema.properties || {})) {
    findObjectSchemaViolations(child, `${path}.properties.${key}`, violations);
  }
  if (schema.items) findObjectSchemaViolations(schema.items, `${path}.items`, violations);
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    for (const [index, child] of (schema[keyword] || []).entries()) {
      findObjectSchemaViolations(child, `${path}.${keyword}[${index}]`, violations);
    }
  }
  for (const [key, child] of Object.entries(schema.$defs || schema.definitions || {})) {
    findObjectSchemaViolations(child, `${path}.$defs.${key}`, violations);
  }
  return violations;
}

function hasLegacyParserConnection(connections) {
  if (!connections || typeof connections !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(connections, LEGACY_PARSER_NODE)) return true;
  for (const channels of Object.values(connections)) {
    if (!channels || typeof channels !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(channels, 'ai_outputParser')) return true;
    for (const outputs of Object.values(channels)) {
      for (const edges of outputs || []) {
        if ((edges || []).some((edge) => edge?.node === LEGACY_PARSER_NODE)) return true;
      }
    }
  }
  return false;
}

function schemaSummary(kind, versionId, nodes, connections) {
  const list = parseJson(nodes, []);
  const graph = parseJson(connections, {});
  const model = list.find((node) => node.name === MODEL_NODE);
  const responsesApiStored = model?.parameters?.responsesApiEnabled;
  const responsesApiEffective = effectiveResponsesApiEnabled(model);
  const textOptions = model?.parameters?.options?.textFormat?.textOptions || {};
  const schemaText = String(textOptions.schema || '');
  let schema = null;
  let schemaParseError = null;
  try { schema = JSON.parse(schemaText); }
  catch (error) { schemaParseError = error.message; }
  const objectSchemaViolations = findObjectSchemaViolations(schema);
  return {
    kind,
    version_id: versionId,
    schema_hash: hash(schemaText),
    schema_name: textOptions.name || null,
    schema_parse_error: schemaParseError,
    object_schema_violations: objectSchemaViolations,
    strict_all_objects: Boolean(schema) && objectSchemaViolations.length === 0,
    model_type_version: Number(model?.typeVersion || 0),
    responses_api_stored: responsesApiStored ?? null,
    responses_api_enabled: responsesApiEffective,
    legacy_parser_present: list.some((node) => node.name === LEGACY_PARSER_NODE),
    legacy_parser_connection_present: hasLegacyParserConnection(graph),
  };
}

function strictFailures(report) {
  const failures = [];
  if (report.workflow_active) failures.push('workflow must remain inactive');
  const target = report.execution;
  if (!target.responses_api_enabled) failures.push('Responses API is not enabled for the execution version');
  if (target.schema_name !== 'meta_ads_publish') failures.push('structured schema name is not meta_ads_publish');
  if (target.schema_parse_error) failures.push(`structured schema is invalid JSON: ${target.schema_parse_error}`);
  if (!target.strict_all_objects) {
    failures.push(`additionalProperties=false is missing at: ${target.object_schema_violations.join(', ') || 'unknown object'}`);
  }
  if (target.legacy_parser_present) failures.push('legacy structured output parser node is present');
  if (target.legacy_parser_connection_present) failures.push('legacy ai_outputParser connection is present');
  return failures;
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
    const current = await client.query(
      `SELECT active, settings, "versionId", "activeVersionId", "versionCounter", nodes, connections
         FROM n8n_runtime.workflow_entity WHERE id = $1`,
      [WORKFLOW_ID],
    );
    const row = current.rows[0];
    if (!row) throw new Error('Workflow not found.');
    const history = await client.query(
      `SELECT "versionId", nodes, connections FROM n8n_runtime.workflow_history
        WHERE "workflowId" = $1 AND "versionId" = ANY($2::text[])`,
      [WORKFLOW_ID, [...new Set([row.versionId, row.activeVersionId].filter(Boolean))]],
    );
    const currentSummary = schemaSummary('current', row.versionId, row.nodes, row.connections);
    const historySummaries = history.rows.map((item) => schemaSummary('history', item.versionId, item.nodes, item.connections));
    const executionSummary = executionSummaryForWorkflow(row, currentSummary, historySummaries);
    const report = {
      workflow_id: WORKFLOW_ID,
      workflow_active: row.active === true,
      version_counter: Number(row.versionCounter),
      current_version_id: row.versionId,
      active_version_id: row.activeVersionId,
      version_aligned: row.versionId === row.activeVersionId,
      manual_execution_audit: manualExecutionAuditState(parseJson(row.settings, {})),
      execution_version_id: executionSummary.version_id,
      execution: executionSummary,
      current: currentSummary,
      history: historySummaries,
    };
    const failures = strictFailures(report);
    console.log(JSON.stringify({ ...report, strict_validation: { ok: failures.length === 0, failures } }, null, 2));
    if (STRICT && failures.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
