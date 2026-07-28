#!/usr/bin/env node
'use strict';

// Builds a candidate from a freshly exported, inactive workflow. It never
// writes to n8n; the controlled apply script performs the version-checked save.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CRM_TOOL_NAME = 'CRM Offer Context';
const CRM_TOOL_ID = 'meta-publish-crm-offer-context';
const CRM_URL = 'https://crm.skincos.com.br/api/atendimento/internal/meta-ads/offer-context?unit={unit}';

function parseArgs(argv) {
  const values = new Map();
  for (const value of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(value);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function requiredNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Required node not found: ${name}`);
  return node;
}

function replaceExact(text, expected, replacement, label) {
  if (!String(text || '').includes(expected)) throw new Error(`Expected ${label} contract text was not found.`);
  return String(text).replace(expected, replacement);
}

function updateModelSchema(model) {
  const raw = model.parameters?.options?.textFormat?.textOptions?.schema;
  if (!raw) throw new Error('OpenAI Chat Model schema is missing.');
  const schema = JSON.parse(raw);
  const analysis = schema?.properties?.analysis;
  if (!analysis?.properties?.spreadsheetPricing || !Array.isArray(analysis.required)) {
    throw new Error('OpenAI Chat Model schema does not contain spreadsheetPricing.');
  }
  analysis.properties.crmPricing = analysis.properties.spreadsheetPricing;
  delete analysis.properties.spreadsheetPricing;
  analysis.required = analysis.required.map((field) => field === 'spreadsheetPricing' ? 'crmPricing' : field);
  analysis.properties.crmPricing.properties.source.enum = ['crm', 'none'];
  model.parameters.options.textFormat.textOptions.schema = JSON.stringify(schema, null, 2);
}

function createCrmTool(credentialId, credentialName) {
  return {
    parameters: {
      toolDescription: 'Consulta o catálogo comercial ativo e atualizado no CRM. Chame exatamente uma vez por item, usando a unidade de destino recebida (`barra-shopping-sul` ou `novo-hamburgo`). Use apenas preços, combinações, condições e vigências retornados por esta ferramenta; se não houver oferta correspondente, não invente dados.',
      method: 'GET',
      url: CRM_URL,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: false,
      sendHeaders: false,
      sendBody: false,
      placeholderDefinitions: {
        values: [
          {
            name: 'unit',
            description: 'Slug da unidade de destino. Use somente barra-shopping-sul ou novo-hamburgo.',
            type: 'string',
          },
        ],
      },
      options: { timeout: 20000 },
    },
    id: CRM_TOOL_ID,
    name: CRM_TOOL_NAME,
    type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
    typeVersion: 1.1,
    position: [7696, 1536],
    credentials: {
      httpBearerAuth: {
        id: credentialId,
        name: credentialName,
      },
    },
  };
}

function transform(workflow, { credentialId, credentialName }) {
  if (workflow.id !== WORKFLOW_ID || workflow.active !== false) throw new Error('Expected an inactive Meta Ads Publish export.');
  if (!Array.isArray(workflow.nodes)) throw new Error('Workflow nodes are missing.');
  const legacy = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheetsTool' || node.name === 'Knowledge');
  if (legacy.length !== 1 || legacy[0].name !== 'Knowledge') throw new Error('Expected exactly the legacy Knowledge Google Sheets tool.');
  if (workflow.nodes.some((node) => node.name === CRM_TOOL_NAME || node.id === CRM_TOOL_ID)) throw new Error('CRM Offer Context tool already exists; export a new baseline before reapplying.');

  const livia = requiredNode(workflow, 'Livia');
  const model = requiredNode(workflow, 'OpenAI Chat Model (Agent)');
  updateModelSchema(model);
  livia.parameters.text = replaceExact(
    livia.parameters.text,
    'Em `spreadsheetPricing`, use dados da planilha apenas se forem realmente consultados.',
    'Em `crmPricing`, use somente dados retornados pelo catálogo comercial do CRM nesta execução.',
    'Livia prompt pricing instruction',
  );
  livia.parameters.text = livia.parameters.text.replace(
    'destination_group: $json.destination_group,',
    'destination_group: $json.destination_group,\n  destinations: $json.destinations || [],',
  );
  let systemMessage = String(livia.parameters?.options?.systemMessage || '');
  systemMessage = replaceExact(
    systemMessage,
    '- Se preço não estiver claro na mídia, consulte "Knowledge" no máximo 1 vez.\n- Se faltar contexto de marca, consulte "Documents" no máximo 1 vez.\n- Use a planilha apenas quando necessário e apenas para complementar informação ausente da mídia.',
    '- Consulte `CRM Offer Context` exatamente uma vez por item, usando a unidade de destino.\n- O CRM é a única fonte externa autorizada para preço, oferta, parcelamento, condição e vigência.\n- Se a oferta não for retornada pelo CRM, não use preço ou condição que não esteja inequívoca na mídia.',
    'Livia system source instruction',
  );
  systemMessage = replaceExact(
    systemMessage,
    '- `spreadsheetPricing` deve refletir apenas o que vier da planilha, quando ela for consultada.',
    '- `crmPricing` deve refletir apenas o que vier do CRM, quando ele for consultado.',
    'Livia system pricing field',
  );
  livia.parameters.options.systemMessage = systemMessage;

  workflow.nodes = workflow.nodes.filter((node) => node !== legacy[0]);
  workflow.nodes.push(createCrmTool(credentialId, credentialName));
  delete workflow.connections.Knowledge;
  workflow.connections[CRM_TOOL_NAME] = {
    ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]],
  };
  return workflow;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.get('input');
  const output = args.get('output');
  const credentialId = args.get('credential-id');
  const credentialName = args.get('credential-name');
  if (!input || !output || !credentialId || !credentialName) {
    throw new Error('Usage: node prepare-meta-ads-publish-crm-catalog.js --input=<workflow.json> --output=<candidate.json> --credential-id=<n8n-id> --credential-name=<name>');
  }
  const workflow = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const candidate = transform(workflow, { credentialId, credentialName });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, node_count: candidate.nodes.length, crm_tool: CRM_TOOL_NAME, output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = { CRM_TOOL_ID, CRM_TOOL_NAME, CRM_URL, transform };
