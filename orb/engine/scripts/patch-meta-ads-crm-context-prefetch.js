#!/usr/bin/env node
'use strict';

// Moves the CRM catalog lookup out of the AI sub-node. n8n's HTTP Request Tool
// does not reliably execute a loopback authenticated URL on this runtime,
// while the normal HTTP Request node does. The model still receives only the
// CRM result that belongs to each destination and never a spreadsheet.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CRM_URL = 'http://127.0.0.1:8099/api/atendimento/internal/meta-ads/offer-context';
const PREPARE_NODE = 'Prepare CRM Offer Context Requests';
const FETCH_NODE = 'Fetch CRM Offer Context';
const ATTACH_NODE = 'Attach CRM Offer Context';
const LIVIA_NODE = 'Livia';
const INPUT_NODE = 'Prepare Media Upload Plan';

const PREPARE_CODE = `function text(value) { return String(value ?? '').trim(); }
function unitSlug(destinationGroup) {
  const normalized = text(destinationGroup).toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '');
  if (normalized === 'barrashoppingsul') return 'barra-shopping-sul';
  if (normalized === 'novohamburgo') return 'novo-hamburgo';
  throw new Error(\`Destino CRM desconhecido: \${text(destinationGroup) || 'vazio'}.\`);
}

return $input.all().flatMap((item) => {
  const job = item.json || {};
  const jobKey = text(job.job_key);
  const groupKey = text(job.group_key);
  const destinations = Array.isArray(job.destinations) ? job.destinations : [];
  if (!jobKey || !groupKey || !destinations.length) throw new Error('Prepare CRM Offer Context Requests exige job_key, group_key e destinos.');
  const seen = new Set();
  return destinations.map((destination) => {
    const destinationGroup = text(destination?.destination_group);
    const crmUnit = unitSlug(destinationGroup);
    if (seen.has(crmUnit)) throw new Error(\`Destino CRM duplicado em \${jobKey}: \${crmUnit}.\`);
    seen.add(crmUnit);
    return {
      json: {
        job_key: jobKey,
        group_key: groupKey,
        crm_unit: crmUnit,
        crm_destination_group: destinationGroup,
        crm_source_job: job,
      },
      binary: item.binary || {},
      pairedItem: item.pairedItem,
    };
  });
});`;

const ATTACH_CODE = `function text(value) { return String(value ?? '').trim(); }
function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  return Number((Array.isArray(paired) ? paired[0]?.item : paired?.item) ?? fallback);
}

const requests = $items('${PREPARE_NODE}') || [];
const buckets = new Map();
for (const [index, item] of $input.all().entries()) {
  const request = requests[pairedIndex(item, index)];
  if (!request?.json) throw new Error(\`CRM Offer Context sem request correlacionado; index=\${index}.\`);
  const meta = request.json;
  const jobKey = text(meta.job_key);
  const groupKey = text(meta.group_key);
  const crmUnit = text(meta.crm_unit);
  const sourceJob = meta.crm_source_job;
  if (!jobKey || !groupKey || !crmUnit || !sourceJob) throw new Error('CRM Offer Context retornou contexto incompleto.');
  const bucket = buckets.get(jobKey) || { job: sourceJob, group_key: groupKey, contexts: {}, binary: request.binary || {} };
  if (bucket.group_key !== groupKey || bucket.contexts[crmUnit]) throw new Error(\`CRM Offer Context duplicado ou divergente em \${jobKey}.\`);
  bucket.contexts[crmUnit] = item.json || {};
  buckets.set(jobKey, bucket);
}

return [...buckets.entries()].map(([jobKey, bucket]) => {
  const expected = Array.isArray(bucket.job.destinations) ? bucket.job.destinations.length : 0;
  if (!expected || Object.keys(bucket.contexts).length !== expected) {
    throw new Error(\`Cobertura CRM incompleta em \${jobKey}; expected=\${expected} completed=\${Object.keys(bucket.contexts).length}.\`);
  }
  return {
    json: {
      ...bucket.job,
      crm_offer_context_version: '1',
      crm_offer_contexts: bucket.contexts,
    },
    binary: bucket.binary,
  };
});`;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nodeByName(workflow, name) { return workflow.nodes.find((node) => node.name === name); }

function nodeDefinitions(credentialId, credentialName) {
  return [
    { id: 'meta-publish-prepare-crm-offer-context', name: PREPARE_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position: [7360, 1376], parameters: { jsCode: PREPARE_CODE } },
    {
      id: 'meta-publish-fetch-crm-offer-context', name: FETCH_NODE, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.3, position: [7584, 1376],
      parameters: {
        url: `={{ '${CRM_URL}?unit=' + encodeURIComponent($json.crm_unit) }}`,
        authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', options: { timeout: 20000 },
      },
      credentials: { httpBearerAuth: { id: credentialId, name: credentialName } },
    },
    { id: 'meta-publish-attach-crm-offer-context', name: ATTACH_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position: [7808, 1376], parameters: { jsCode: ATTACH_CODE } },
  ];
}

function validate(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const connections = workflow?.connections || {};
  if (nodes.some((node) => node.type === 'n8n-nodes-base.googleSheetsTool' || node.name === 'Knowledge' || node.name === 'CRM Offer Context')) throw new Error('Legacy commercial source node is still present.');
  const prepare = nodeByName(workflow, PREPARE_NODE);
  const fetch = nodeByName(workflow, FETCH_NODE);
  const attach = nodeByName(workflow, ATTACH_NODE);
  if (!prepare?.parameters?.jsCode?.includes('unitSlug') || !attach?.parameters?.jsCode?.includes('crm_offer_contexts')) throw new Error('CRM prefetch code nodes are incomplete.');
  if (fetch?.type !== 'n8n-nodes-base.httpRequest' || fetch.parameters?.authentication !== 'genericCredentialType' || fetch.parameters?.genericAuthType !== 'httpBearerAuth' || !fetch.credentials?.httpBearerAuth?.id || !String(fetch.parameters?.url || '').includes(CRM_URL)) throw new Error('CRM prefetch HTTP request is incomplete.');
  const inputTargets = connections?.[INPUT_NODE]?.main?.[0] || [];
  const prepareTargets = connections?.[PREPARE_NODE]?.main?.[0] || [];
  const fetchTargets = connections?.[FETCH_NODE]?.main?.[0] || [];
  const attachTargets = connections?.[ATTACH_NODE]?.main?.[0] || [];
  if (!inputTargets.some((edge) => edge.node === PREPARE_NODE) || !prepareTargets.some((edge) => edge.node === FETCH_NODE) || !fetchTargets.some((edge) => edge.node === ATTACH_NODE) || !attachTargets.some((edge) => edge.node === LIVIA_NODE)) {
    throw new Error('CRM prefetch graph is not connected to Livia.');
  }
  const livia = nodeByName(workflow, LIVIA_NODE);
  const prompt = String(livia?.parameters?.text || '');
  const system = String(livia?.parameters?.options?.systemMessage || '');
  if (!prompt.includes('crm_offer_contexts') || !system.includes('consultado automaticamente pelo workflow')) throw new Error('Livia CRM context prompt is incomplete.');
  return true;
}

function transform(workflow, { credentialId, credentialName }) {
  if (workflow?.id !== WORKFLOW_ID || workflow.active !== false) throw new Error('Expected an inactive Meta Ads Publish export.');
  if (!credentialId || !credentialName) throw new Error('CRM bearer credential is required.');
  const candidate = clone(workflow);
  candidate.nodes = candidate.nodes.filter((node) => !['CRM Offer Context', PREPARE_NODE, FETCH_NODE, ATTACH_NODE].includes(node.name));
  candidate.nodes.push(...nodeDefinitions(credentialId, credentialName));
  delete candidate.connections['CRM Offer Context'];
  const existing = candidate.connections?.[INPUT_NODE]?.main?.[0] || [];
  candidate.connections[INPUT_NODE] = { main: [existing.filter((edge) => edge.node !== LIVIA_NODE).concat([{ node: PREPARE_NODE, type: 'main', index: 0 }])] };
  candidate.connections[PREPARE_NODE] = { main: [[{ node: FETCH_NODE, type: 'main', index: 0 }]] };
  candidate.connections[FETCH_NODE] = { main: [[{ node: ATTACH_NODE, type: 'main', index: 0 }]] };
  candidate.connections[ATTACH_NODE] = { main: [[{ node: LIVIA_NODE, type: 'main', index: 0 }]] };
  const livia = nodeByName(candidate, LIVIA_NODE);
  let prompt = String(livia.parameters.text || '');
  if (!prompt.includes('crm_offer_contexts')) {
    prompt = prompt.replace(
      '  destinations: $json.destinations || [],',
      '  destinations: $json.destinations || [],\n  crm_offer_contexts: $json.crm_offer_contexts || {},',
    );
    if (!prompt.includes('crm_offer_contexts')) prompt += '\ncrm_offer_contexts: $json.crm_offer_contexts || {}';
  }
  livia.parameters.text = prompt;
  const crmInstruction = '- O catálogo comercial do CRM foi consultado automaticamente pelo workflow para cada unidade de destino.\n- Use somente os dados presentes em `crm_offer_contexts` para preço, oferta, parcelamento, condição e vigência.\n- Se o CRM não retornar uma oferta, não use preço ou condição que não esteja inequívoca na mídia.';
  let systemMessage = String(livia.parameters?.options?.systemMessage || '');
  systemMessage = systemMessage.replace(/- Consulte `CRM Offer Context`[\s\S]*?inequívoca na mídia\./, crmInstruction);
  if (!systemMessage.includes('consultado automaticamente pelo workflow')) systemMessage += `\n${crmInstruction}`;
  systemMessage = systemMessage.replace('`crmPricing` deve refletir apenas o que vier do CRM, quando ele for consultado.', '`crmPricing` deve refletir apenas o que vier de `crm_offer_contexts`.');
  livia.parameters.options.systemMessage = systemMessage;
  validate(candidate);
  return candidate;
}

function main() {
  const [input, output, credentialId, credentialName] = process.argv.slice(2);
  if (!input || !output || !credentialId || !credentialName) throw new Error('Usage: node patch-meta-ads-crm-context-prefetch.js <input.json> <output.json> <credential-id> <credential-name>');
  const candidate = transform(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')), { credentialId, credentialName });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, crm_source: 'prefetched_http_request', output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = { CRM_URL, PREPARE_NODE, FETCH_NODE, ATTACH_NODE, transform, validate };
