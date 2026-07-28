'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('../scripts/lib/meta-ads-publish-execution-semantics');
const { CRM_TOOL_NAME, CRM_URL, transform } = require('../scripts/prepare-meta-ads-publish-crm-catalog');

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
  assert.equal(crm.credentials.httpBearerAuth.id, 'credential-id');
  assert.deepEqual(candidate.connections[CRM_TOOL_NAME].ai_tool[0][0], { node: 'Livia', type: 'ai_tool', index: 0 });
  const updatedSchema = JSON.parse(candidate.nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)').parameters.options.textFormat.textOptions.schema);
  assert.equal(updatedSchema.properties.analysis.properties.spreadsheetPricing, undefined);
  assert.deepEqual(updatedSchema.properties.analysis.properties.crmPricing.properties.source.enum, ['crm', 'none']);
});
