'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CRM_COMMERCIAL_CATALOG_AUTH_TYPE,
  CRM_COMMERCIAL_CATALOG_CREDENTIAL,
} = require('../scripts/lib/crm-commercial-catalog-contract');
const { patchWorkflow, validate } = require('../scripts/patch-livia-commercial-catalog');

const workflowPath = path.join(__dirname, '..', 'workflows', 'livia', 'livia.current.json');

function fixture() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

test('Livia receives one deterministic read-only CRM catalog tool and no legacy commercial source', () => {
  const candidate = patchWorkflow(fixture());
  validate(candidate);
  const nodes = new Map(candidate.nodes.map((node) => [node.name, node]));
  const tool = nodes.get('CRM Commercial Catalog');
  const context = nodes.get('Prepare Livia CRM Catalog Context');
  const livia = nodes.get('Livia');
  const model = nodes.get('OpenAI Chat Model');
  const documents = nodes.get('Supabase Vector Store');
  const schema = JSON.parse(model.parameters.options.textFormat.textOptions.schema);
  const procedure = schema.properties.procedures.items;

  assert.equal(candidate.nodes.some((node) => node.name === 'Knowledge' || node.type === 'n8n-nodes-base.googleSheetsTool'), false);
  assert.equal(tool.type, '@n8n/n8n-nodes-langchain.toolHttpRequest');
  assert.equal(tool.parameters.method, 'GET');
  assert.equal(tool.parameters.sendBody, false);
  assert.match(tool.parameters.url, /\/api\/atendimento\/internal\/commercial\/catalog\?units=/);
  assert.match(tool.parameters.url, /Prepare Livia CRM Catalog Context/);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /\$fromAI|placeholderDefinitions|\{unit\}/i);
  assert.equal(tool.parameters.genericAuthType, CRM_COMMERCIAL_CATALOG_AUTH_TYPE);
  assert.deepEqual(tool.credentials[CRM_COMMERCIAL_CATALOG_AUTH_TYPE], CRM_COMMERCIAL_CATALOG_CREDENTIAL);
  assert.equal(tool.credentials.httpBearerAuth, undefined);
  assert.match(context.parameters.jsCode, /Get Credential Tokens/);
  assert.match(context.parameters.jsCode, /bss.*barra-shopping-sul/s);
  assert.match(context.parameters.jsCode, /nh.*novo-hamburgo/s);
  assert.equal(candidate.connections['Build Livia Group Evidence'].main[0].some((edge) => edge.node === 'Prepare Livia CRM Catalog Context'), true);
  assert.deepEqual(candidate.connections['Prepare Livia CRM Catalog Context'].main[0][0], { node: 'Livia', type: 'main', index: 0 });
  assert.deepEqual(candidate.connections['CRM Commercial Catalog'].ai_tool[0][0], { node: 'Livia', type: 'ai_tool', index: 0 });
  assert.equal(documents.parameters.toolName, 'Documents');
  assert.match(documents.parameters.toolDescription, /editorial|brand knowledge/i);
  assert.match(documents.parameters.toolDescription, /Ignore qualquer dado comercial/i);

  const agentContract = `${livia.parameters.text}\n${livia.parameters.options.systemMessage}\n${JSON.stringify(schema)}`;
  assert.doesNotMatch(agentContract, /\bKnowledge\b|Google Sheets|planilha|spreadsheetPricing/);
  assert.match(agentContract, /CRM Commercial Catalog/);
  assert.match(agentContract, /crmCatalogUnits/);
  assert.deepEqual(procedure.required, ['name', 'evidence', 'adsPricing', 'crmPricing']);
  assert.equal(procedure.properties.spreadsheetPricing, undefined);
  assert.deepEqual(procedure.properties.crmPricing.properties.source.enum, ['crm', 'none']);
  assert.deepEqual(procedure.properties.crmPricing.required, ['value', 'offer', 'source']);
  assert.match(nodes.get('Assert Livia Visual Analysis').parameters.jsCode, /livia_crm_pricing_guard_v1/);
});

test('Livia commercial catalog patch is idempotent', () => {
  const once = patchWorkflow(fixture());
  const twice = patchWorkflow(once);
  assert.deepEqual(twice, once);
});

test('Livia commercial catalog validator rejects the unsupported Bearer auth shape', () => {
  const candidate = patchWorkflow(fixture());
  const tool = candidate.nodes.find((node) => node.name === 'CRM Commercial Catalog');
  tool.parameters.genericAuthType = 'httpBearerAuth';
  tool.credentials = { httpBearerAuth: { id: '4r0IbVgjAaSOQREF', name: 'Bearer Auth account' } };
  assert.throws(() => validate(candidate), /configuration is incomplete/);
});

test('Livia commercial guard preserves the live visual assertion return envelope', () => {
  const liveShape = fixture();
  const visualAssert = liveShape.nodes.find((node) => node.name === 'Assert Livia Visual Analysis');
  visualAssert.parameters.jsCode = visualAssert.parameters.jsCode.replace(
    'return { json: current };',
    'return { json: current, binary: $input.item.binary, pairedItem: $input.item.pairedItem };',
  );

  const candidate = patchWorkflow(liveShape);
  validate(candidate);
  const patchedCode = candidate.nodes.find((node) => node.name === 'Assert Livia Visual Analysis').parameters.jsCode;
  assert.match(patchedCode, /livia_crm_pricing_guard_v1/);
  assert.match(patchedCode, /return \{ json: current, binary: \$input\.item\.binary, pairedItem: \$input\.item\.pairedItem \};/);
});
