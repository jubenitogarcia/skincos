'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('../scripts/lib/meta-ads-publish-execution-semantics');
const { CRM_TOOL_NAME, CRM_URL, transform } = require('../scripts/prepare-meta-ads-publish-crm-catalog');
const { transform: patchCrmToolAuth, validate: validateCrmToolAuth } = require('../scripts/patch-meta-ads-crm-tool-auth');
const {
  PREPARE_NODE: CRM_PREPARE_NODE,
  FETCH_NODE: CRM_FETCH_NODE,
  ATTACH_NODE: CRM_ATTACH_NODE,
  transform: patchCrmContextPrefetch,
  validate: validateCrmContextPrefetch,
} = require('../scripts/patch-meta-ads-crm-context-prefetch');
const { transform: patchVideoUploadReplay } = require('../scripts/patch-meta-ads-video-transfer-replay');

test('Responses API uses the n8n 1.3 default when the stored parameter is absent', () => {
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: {} }), true);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: { responsesApiEnabled: false } }), false);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.2, parameters: {} }), false);
});

test('execution version follows current for inactive workflows and published version for active workflows', () => {
  const current = { version_id: 'current' };
  const history = [{ version_id: 'published' }];
  assert.equal(executionSummaryForWorkflow({ active: false, activeVersionId: 'published' }, current, history), current);
  assert.deepEqual(executionSummaryForWorkflow({ active: true, activeVersionId: 'published' }, current, history), history[0]);
});

test('manual execution retention is reported without assuming execution data exists', () => {
  assert.equal(manualExecutionAuditState({ saveManualExecutions: true }), 'persisted');
  assert.equal(manualExecutionAuditState({ saveManualExecutions: false }), 'not_persisted');
  assert.equal(manualExecutionAuditState({}), 'not_persisted');
});

test('replaces the legacy Sheets tool with the authenticated CRM offer-context tool', () => {
  const schema = {
    properties: {
      analysis: {
        required: ['spreadsheetPricing'],
        properties: { spreadsheetPricing: { properties: { source: { enum: ['spreadsheet', 'none'] } } } },
      },
    },
  };
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [
      { id: 'legacy', name: 'Knowledge', type: 'n8n-nodes-base.googleSheetsTool', parameters: {} },
      {
        name: 'Livia',
        type: '@n8n/n8n-nodes-langchain.agent',
        parameters: {
          text: 'Em `spreadsheetPricing`, use dados da planilha apenas se forem realmente consultados.\ndestination_group: $json.destination_group,',
          options: { systemMessage: '- Se preço não estiver claro na mídia, consulte "Knowledge" no máximo 1 vez.\n- Se faltar contexto de marca, consulte "Documents" no máximo 1 vez.\n- Use a planilha apenas quando necessário e apenas para complementar informação ausente da mídia.\n- `spreadsheetPricing` deve refletir apenas o que vier da planilha, quando ela for consultada.' },
        },
      },
      { name: 'OpenAI Chat Model (Agent)', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: { options: { textFormat: { textOptions: { schema: JSON.stringify(schema) } } } } },
    ],
    connections: { Knowledge: { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] } },
  };
  const candidate = transform(workflow, { credentialId: 'credential-id', credentialName: 'CRM Meta Ads Offer Context' });
  assert.equal(candidate.nodes.some((node) => node.type === 'n8n-nodes-base.googleSheetsTool'), false);
  const crm = candidate.nodes.find((node) => node.name === CRM_TOOL_NAME);
  assert.equal(crm.parameters.url, CRM_URL);
  assert.equal(crm.parameters.sendQuery, true);
  assert.deepEqual(crm.parameters.parametersQuery.values, [{ name: 'unit', valueProvider: 'modelRequired' }]);
  assert.equal(crm.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(crm.credentials.httpHeaderAuth.id, 'credential-id');
  assert.deepEqual(candidate.connections[CRM_TOOL_NAME].ai_tool[0][0], { node: 'Livia', type: 'ai_tool', index: 0 });
  const updatedSchema = JSON.parse(candidate.nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)').parameters.options.textFormat.textOptions.schema);
  assert.equal(updatedSchema.properties.analysis.properties.spreadsheetPricing, undefined);
  assert.deepEqual(updatedSchema.properties.analysis.properties.crmPricing.properties.source.enum, ['crm', 'none']);
});

test('preflight loads workflow connections before validating the CRM tool edge', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'validate-meta-ads-publish-preflight.js'),
    'utf8',
  );
  assert.match(source, /SELECT active, nodes, connections, settings,/);
});

test('preflight rejects creative-contract drift between Build Jobs and the quality gate', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'validate-meta-ads-publish-preflight.js'),
    'utf8',
  );
  assert.match(source, /workflow_contract_revision_mismatch/);
  assert.match(source, /book_now_contract_mismatch/);
  assert.match(source, /objective_aware_cta_contract_mismatch/);
  assert.match(source, /current_build_payload_precedence_missing/);
  assert.match(source, /source_url_contract_mismatch/);
  assert.match(source, /video_feature_gateway_mismatch/);
  assert.match(source, /const sourceUrl\\s\*=\\s\*safeString/);
  assert.match(source, /creative_payload_contract_synchronized/);
});

test('CRM Offer Context patches unsupported bearer auth to the supported header auth type', () => {
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [{
      name: 'CRM Offer Context',
      type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
      parameters: {
        url: `${CRM_URL}?unit={unit}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
      },
      credentials: { httpBearerAuth: { id: 'old', name: 'old bearer' } },
    }],
    connections: { 'CRM Offer Context': { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] } },
  };
  const candidate = patchCrmToolAuth(workflow, { credentialId: 'header-id', credentialName: 'CRM header' });
  const crm = candidate.nodes[0];
  assert.equal(crm.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(crm.parameters.url, CRM_URL);
  assert.deepEqual(crm.parameters.parametersQuery.values, [{ name: 'unit', valueProvider: 'modelRequired' }]);
  assert.deepEqual(crm.credentials, { httpHeaderAuth: { id: 'header-id', name: 'CRM header' } });
  assert.doesNotThrow(() => validateCrmToolAuth(candidate));
  assert.throws(() => validateCrmToolAuth(workflow), /httpHeaderAuth/);
});

test('CRM offer context is prefetched before Livia instead of using an AI HTTP sub-node', () => {
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [
      { name: 'Prepare Media Upload Plan', type: 'n8n-nodes-base.code', parameters: {} },
      { name: 'Livia', type: '@n8n/n8n-nodes-langchain.agent', parameters: { text: 'destinations: $json.destinations || [],', options: { systemMessage: '- Consulte `CRM Offer Context` exatamente uma vez por item, usando a unidade de destino.\n- O CRM é a única fonte externa autorizada para preço, oferta, parcelamento, condição e vigência.\n- Se a oferta não for retornada pelo CRM, não use preço ou condição que não esteja inequívoca na mídia.\n`crmPricing` deve refletir apenas o que vier do CRM, quando ele for consultado.' } } },
      { name: 'CRM Offer Context', type: '@n8n/n8n-nodes-langchain.toolHttpRequest', parameters: {}, credentials: {} },
    ],
    connections: {
      'Prepare Media Upload Plan': { main: [[{ node: 'Livia', type: 'main', index: 0 }]] },
      'CRM Offer Context': { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] },
    },
  };
  const candidate = patchCrmContextPrefetch(workflow, { credentialId: 'bearer-id', credentialName: 'CRM Bearer' });
  assert.equal(candidate.nodes.some((node) => node.name === 'CRM Offer Context'), false);
  assert.equal(candidate.nodes.find((node) => node.name === CRM_FETCH_NODE).credentials.httpBearerAuth.id, 'bearer-id');
  assert.ok(candidate.connections['Prepare Media Upload Plan'].main[0].some((edge) => edge.node === CRM_PREPARE_NODE));
  assert.deepEqual(candidate.connections[CRM_PREPARE_NODE].main[0][0], { node: CRM_FETCH_NODE, type: 'main', index: 0 });
  assert.deepEqual(candidate.connections[CRM_FETCH_NODE].main[0][0], { node: CRM_ATTACH_NODE, type: 'main', index: 0 });
  assert.doesNotThrow(() => validateCrmContextPrefetch(candidate));
});

test('video upload replay key includes normalized bytes and rejects the legacy v4 key', () => {
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [{
      name: 'Prepare Video Upload Starts',
      type: 'n8n-nodes-base.code',
      parameters: {
        jsCode: [
          "const normalizedFile = text(processing.normalized_file || video.normalized_file);",
          "    if (!runId || !fileSize || !normalizedFile) throw new Error(`Video ${video.id} sem run_id, tamanho ou caminho normalizado.`);",
          "checksum_sha256: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
          "operation_key: `video-start:v4:${stableHash([runId, accountId, tokenId, apiVersion, video.id, sourceFingerprint, VIDEO_NORMALIZATION_CONTRACT_REVISION].map(text).join('|'))}`",
          "file_checksum: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
        ].join('\n'),
      },
    }],
  };
  const candidate = patchVideoUploadReplay(workflow);
  const code = candidate.nodes[0].parameters.jsCode;
  assert.match(code, /video-start:v5:/);
  assert.match(code, /checksumSha256, fileSize/);
  assert.match(code, /checksum SHA-256 valido/);
  assert.doesNotMatch(code, /video-start:v4:/);
});
