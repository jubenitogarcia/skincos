#!/usr/bin/env node
'use strict';

// Applies the official CRM commercial catalog contract to a Livia workflow
// export. This module is intentionally deterministic: the workflow supplies
// both unit slugs and the model cannot provide a unit placeholder to the tool.
const fs = require('fs');
const path = require('path');
const {
  CRM_COMMERCIAL_CATALOG_PATH,
  CRM_COMMERCIAL_CATALOG_SCHEMA_VERSION,
  CRM_COMMERCIAL_CATALOG_TOOL_ID,
  CRM_COMMERCIAL_CATALOG_TOOL_NAME,
  CRM_COMMERCIAL_CATALOG_UNITS,
  CRM_COMMERCIAL_CATALOG_URL,
} = require('./lib/crm-commercial-catalog-contract');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const CONTEXT_NODE_ID = 'livia-prepare-crm-commercial-catalog-context';
const CONTEXT_NODE_NAME = 'Prepare Livia CRM Catalog Context';
const VISUAL_ASSERT_NODE = 'Assert Livia Visual Analysis';
const BUILD_EVIDENCE_NODE = 'Build Livia Group Evidence';
const LIVIA_NODE = 'Livia';
const DOCUMENTS_NODE = 'Supabase Vector Store';
const FORBIDDEN_AGENT_TEXT = /\bKnowledge\b|Google Sheets|planilha|spreadsheetPricing/;

const COMMERCIAL_POLICY = [
  '',
  'Catálogo comercial oficial do CRM:',
  '- CRM Commercial Catalog é a única fonte autorizada para preço, oferta, combo, procedimentos vinculados, parcelamento, condições e vigência.',
  '- Consulte CRM Commercial Catalog no máximo uma vez nesta execução quando houver necessidade comercial; a chamada deve usar exclusivamente crmCatalogUnits fornecido pelo workflow.',
  '- crmCatalogUnits é determinístico e contém bss -> barra-shopping-sul e nh -> novo-hamburgo. Não altere, escolha, complete ou invente unidade.',
  '- Nunca use memória, conhecimento geral do modelo, inferência, Documents ou qualquer contexto editorial para preencher crmPricing ou fazer alegação comercial.',
  '- Documents é exclusivamente contexto editorial/brand knowledge: tom, diferenciais e mensagens permitidas. Ignore qualquer preço, oferta, combo, parcelamento, condição ou validade que apareça em Documents.',
  '- adsPricing registra somente evidência comercial visível na mídia; não é fonte oficial e não autoriza alegação comercial sem confirmação inequívoca do catálogo CRM.',
  '- Como a saída é compartilhada por BSS e NH, só use preço ou condição se o mesmo dado estiver ativo, vigente e válido para as duas unidades. Caso contrário, crmPricing.source deve ser none, com value e offer vazios, e a copy deve ser neutra, sem alegação comercial específica.',
  '- Sem retorno inequívoco do CRM Commercial Catalog, não inclua preço, oferta, combo, parcelamento, condição ou vigência na copy.',
].join('\n');

const COMMERCIAL_GUARD_CODE = [
  '// livia_crm_pricing_guard_v1',
  'const commercialProcedures = Array.isArray(output?.procedures) ? output.procedures : null;',
  'if (!commercialProcedures) throw new Error("Assert Livia Visual Analysis: procedures ausente; catálogo comercial não validado.");',
  'for (const procedure of commercialProcedures) {',
  '  if (Object.prototype.hasOwnProperty.call(procedure || {}, "spreadsheetPricing")) {',
  '    throw new Error("Assert Livia Visual Analysis: campo comercial legado detectado; publicação interrompida.");',
  '  }',
  '  const pricing = procedure?.crmPricing;',
  '  const source = String(pricing?.source || "").trim().toLowerCase();',
  '  if (!pricing || !["crm", "none"].includes(source)) {',
  '    throw new Error("Assert Livia Visual Analysis: crmPricing.source deve ser crm ou none.");',
  '  }',
  '  const value = String(pricing.value || "").trim();',
  '  const offer = String(pricing.offer || "").trim();',
  '  if (source === "none" && (value || offer)) {',
  '    throw new Error("Assert Livia Visual Analysis: crmPricing.source=none não pode carregar preço ou condição.");',
  '  }',
  '  if (source === "crm" && !value && !offer) {',
  '    throw new Error("Assert Livia Visual Analysis: crmPricing.source=crm exige retorno comercial inequívoco.");',
  '  }',
  '}',
].join('\n');

const CONTEXT_CODE = [
  'const CRM_UNITS = Object.freeze({ bss: "barra-shopping-sul", nh: "novo-hamburgo" });',
  'function text(value) { return String(value ?? "").trim(); }',
  'function workflowUnit(value) {',
  '  const normalized = text(value).toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "");',
  '  if (["bss", "barrashoppingsul"].includes(normalized)) return "bss";',
  '  if (["nh", "novohamburgo"].includes(normalized)) return "nh";',
  '  return "";',
  '}',
  'function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }',
  'const tokenItems = (() => {',
  '  try { return $("Get Credential Tokens").all() || []; }',
  '  catch { return []; }',
  '})();',
  'const tokenRows = tokenItems.flatMap((item) => {',
  '  const root = asObject(item?.json);',
  '  return Array.isArray(root.items) ? root.items : [];',
  '});',
  'const covered = new Set();',
  'for (const token of tokenRows) {',
  '  if (!token || token.active === false) continue;',
  '  const metadata = asObject(token.metadata);',
  '  const unit = workflowUnit(token.unit || asObject(metadata.legacy_columns).Unit);',
  '  if (unit) covered.add(unit);',
  '}',
  'for (const unit of Object.keys(CRM_UNITS)) {',
  '  if (!covered.has(unit)) throw new Error("Prepare Livia CRM Catalog Context: cobertura de unidade ausente em Get Credential Tokens: " + unit + ".");',
  '}',
  'const crmCatalogUnits = Object.entries(CRM_UNITS).map(([workflowUnit, crmUnit]) => ({ workflowUnit, crmUnit }));',
  'return $input.all().map((item) => ({',
  '  json: { ...(item.json || {}), crmCatalogUnits },',
  '  binary: item.binary,',
  '  pairedItem: item.pairedItem,',
  '}));',
].join('\n');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nodeByName(workflow, name) { return workflow.nodes.find((node) => node.name === name); }

function resolveCrmBearerCredential() {
  const metaPath = path.join(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
  if (!fs.existsSync(metaPath)) throw new Error('CRM bearer credential source artifact is missing.');
  const metaWorkflow = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const fetchNode = metaWorkflow.nodes.find((node) => node.name === 'Fetch CRM Offer Context');
  const credential = fetchNode?.credentials?.httpBearerAuth;
  if (!credential?.id || !credential?.name) throw new Error('Existing CRM bearer credential could not be resolved from the Meta Ads adapter.');
  return { id: credential.id, name: credential.name };
}

function cleanAgentText(value) {
  return String(value || '')
    .replace(/\bKnowledge\b/g, 'catálogo comercial oficial do CRM')
    .replace(/Google Sheets/gi, 'catálogo comercial oficial do CRM')
    .replace(/planilha/gi, 'catálogo comercial oficial do CRM')
    .replace(/spreadsheetPricing/gi, 'crmPricing');
}

function updateModelSchema(model) {
  const raw = model.parameters?.options?.textFormat?.textOptions?.schema;
  if (!raw) throw new Error('OpenAI Chat Model schema is missing.');
  const schema = JSON.parse(raw);
  const procedures = schema?.properties?.procedures;
  const itemSchema = procedures?.items;
  const properties = itemSchema?.properties;
  const required = itemSchema?.required;
  if (!properties || !Array.isArray(required)) throw new Error('Livia procedure schema is incomplete.');

  const existing = properties.crmPricing || properties.spreadsheetPricing;
  if (!existing) throw new Error('Livia procedure schema has no commercial pricing field.');
  const pricing = clone(existing);
  pricing.type = 'object';
  pricing.additionalProperties = false;
  pricing.required = ['value', 'offer', 'source'];
  pricing.properties = {
    ...(pricing.properties || {}),
    value: {
      type: 'string',
      description: 'Preço somente quando retornado de forma inequívoca pelo catálogo comercial oficial do CRM; caso contrário, string vazia.',
    },
    offer: {
      type: 'string',
      description: 'Oferta, combo, parcelamento, condição ou vigência somente quando retornados de forma inequívoca pelo catálogo comercial oficial do CRM; caso contrário, string vazia.',
    },
    source: {
      type: 'string',
      enum: ['crm', 'none'],
      description: 'crm somente para retorno comercial inequívoco e válido para as duas unidades; none sem retorno comum válido.',
    },
  };
  delete properties.spreadsheetPricing;
  properties.crmPricing = pricing;
  itemSchema.required = required.map((field) => field === 'spreadsheetPricing' ? 'crmPricing' : field);

  const adsPricing = properties.adsPricing;
  if (adsPricing?.properties?.value) adsPricing.properties.value.description = 'Valor visível e legível na mídia, sem tratar a mídia como fonte oficial do catálogo.';
  if (adsPricing?.properties?.offer) adsPricing.properties.offer.description = 'Oferta ou condição visível e legível na mídia, sem tratar a mídia como fonte oficial do catálogo.';
  const notes = schema?.properties?.meta?.properties?.notes;
  if (notes) notes.description = 'Observação interna curta em pt-BR. Deve resumir mídia, análise auxiliar, catálogo CRM e/ou Documents exclusivamente editorial, sem inserir dados comerciais vindos de contexto não autorizado.';

  model.parameters.options.textFormat.textOptions.schema = JSON.stringify(schema, null, 2);
}

function createContextNode() {
  return {
    id: CONTEXT_NODE_ID,
    name: CONTEXT_NODE_NAME,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-8320, -336],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: CONTEXT_CODE,
    },
  };
}

function createCatalogTool(credential) {
  return {
    id: CRM_COMMERCIAL_CATALOG_TOOL_ID,
    name: CRM_COMMERCIAL_CATALOG_TOOL_NAME,
    type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
    typeVersion: 1.1,
    position: [-8000, 16],
    parameters: {
      toolDescription: 'Consulta somente leitura o catálogo comercial oficial do CRM. Use o retorno para preço, oferta, combo, procedimentos vinculados, parcelamento, condições e vigência. A unidade já vem do contexto determinístico do workflow; não há unidade fornecida pelo modelo. Se não houver retorno inequívoco comum às duas unidades, não faça alegação comercial específica.',
      method: 'GET',
      url: `={{ '${CRM_COMMERCIAL_CATALOG_URL}?units=' + encodeURIComponent($("${CONTEXT_NODE_NAME}").first().json.crmCatalogUnits.map((unit) => unit.crmUnit).join(',')) }}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: false,
      sendHeaders: false,
      sendBody: false,
      options: { timeout: 20000 },
    },
    credentials: { httpBearerAuth: credential },
  };
}

function addCommercialGuard(assertNode) {
  const code = String(assertNode?.parameters?.jsCode || '');
  if (code.includes('livia_crm_pricing_guard_v1')) return;
  const marker = 'return { json: current };';
  if (!code.includes(marker)) throw new Error('Assert Livia Visual Analysis return contract is missing.');
  assertNode.parameters.jsCode = code.replace(marker, `${COMMERCIAL_GUARD_CODE}\n${marker}`);
}

function validate(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error('Unexpected Livia workflow id.');
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const connections = workflow.connections || {};
  const node = (name) => nodeByName(workflow, name);
  const legacy = nodes.filter((entry) => entry.name === 'Knowledge' || entry.type === 'n8n-nodes-base.googleSheetsTool');
  if (legacy.length) throw new Error('Legacy Knowledge/Google Sheets node remains in Livia.');

  const livia = node(LIVIA_NODE);
  const context = node(CONTEXT_NODE_NAME);
  const tool = node(CRM_COMMERCIAL_CATALOG_TOOL_NAME);
  const documents = node(DOCUMENTS_NODE);
  const assertNode = node(VISUAL_ASSERT_NODE);
  if (!livia || !context || !tool || !documents || !assertNode) throw new Error('Livia commercial catalog nodes are incomplete.');
  if (context.type !== 'n8n-nodes-base.code' || !String(context.parameters?.jsCode || '').includes('Get Credential Tokens') || !String(context.parameters?.jsCode || '').includes('barra-shopping-sul') || !String(context.parameters?.jsCode || '').includes('novo-hamburgo')) {
    throw new Error('Livia CRM catalog context is not deterministic or token-backed.');
  }
  if (tool.type !== '@n8n/n8n-nodes-langchain.toolHttpRequest' || tool.parameters?.method !== 'GET' || tool.parameters?.authentication !== 'genericCredentialType' || tool.parameters?.genericAuthType !== 'httpBearerAuth' || tool.parameters?.sendBody !== false || !tool.credentials?.httpBearerAuth?.id || !String(tool.parameters?.url || '').includes(CRM_COMMERCIAL_CATALOG_PATH)) {
    throw new Error('Livia CRM Commercial Catalog tool configuration is incomplete.');
  }
  if (/\$fromAI|placeholderDefinitions|\{unit\}/i.test(JSON.stringify(tool.parameters || {}))) throw new Error('CRM catalog tool must not expose a model-controlled unit placeholder.');
  if (documents.parameters?.toolName !== 'Documents' || !/editorial|brand|tom/i.test(String(documents.parameters?.toolDescription || '')) || !/ignore qualquer dado comercial/i.test(String(documents.parameters?.toolDescription || ''))) {
    throw new Error('Documents must remain editorial-only context.');
  }
  const prompt = String(livia.parameters?.text || '');
  const system = String(livia.parameters?.options?.systemMessage || '');
  const schemaText = String(node('OpenAI Chat Model')?.parameters?.options?.textFormat?.textOptions?.schema || '');
  if (!prompt.includes('crmCatalogUnits') || !system.includes('crmCatalogUnits') || !system.includes('CRM Commercial Catalog')) throw new Error('Livia commercial catalog instructions are missing.');
  const agentContractText = `${prompt}\n${system}\n${schemaText}`;
  const forbiddenMatches = agentContractText.match(/\bKnowledge\b|Google Sheets|planilha|spreadsheetPricing/g) || [];
  if (FORBIDDEN_AGENT_TEXT.test(agentContractText)) {
    const offendingLines = agentContractText.split(/\n/).filter((line) => FORBIDDEN_AGENT_TEXT.test(line)).slice(0, 3);
    throw new Error(`Legacy commercial source text remains in the Livia agent contract: ${[...new Set(forbiddenMatches)].join(', ')}. ${offendingLines.join(' | ')}`);
  }
  const schema = JSON.parse(schemaText);
  const procedure = schema?.properties?.procedures?.items;
  const pricing = procedure?.properties?.crmPricing;
  if (!procedure || procedure.properties?.spreadsheetPricing || !procedure.required?.includes('crmPricing') || pricing?.additionalProperties !== false || JSON.stringify(pricing?.properties?.source?.enum) !== JSON.stringify(['crm', 'none'])) {
    throw new Error('Livia schema must expose crmPricing with crm/none provenance.');
  }
  if (!String(assertNode.parameters?.jsCode || '').includes('livia_crm_pricing_guard_v1')) throw new Error('Livia commercial pricing guard is missing.');
  const buildTargets = connections[BUILD_EVIDENCE_NODE]?.main?.[0] || [];
  const contextTargets = connections[CONTEXT_NODE_NAME]?.main?.[0] || [];
  const toolTargets = connections[CRM_COMMERCIAL_CATALOG_TOOL_NAME]?.ai_tool?.[0] || [];
  if (!buildTargets.some((edge) => edge.node === CONTEXT_NODE_NAME) || !contextTargets.some((edge) => edge.node === LIVIA_NODE) || !toolTargets.some((edge) => edge.node === LIVIA_NODE)) {
    throw new Error('Livia CRM catalog context/tool graph is not connected.');
  }
  if (!connections[DOCUMENTS_NODE]?.ai_tool?.[0]?.some((edge) => edge.node === LIVIA_NODE)) throw new Error('Documents editorial tool must remain attached to Livia.');
  return true;
}

function patchWorkflow(workflow) {
  const candidate = clone(workflow);
  if (candidate?.id !== WORKFLOW_ID) throw new Error('Unexpected Livia workflow id.');
  if (!Array.isArray(candidate.nodes)) throw new Error('Livia workflow nodes are missing.');
  const credential = resolveCrmBearerCredential();

  candidate.nodes = candidate.nodes.filter((entry) => entry.name !== 'Knowledge' && entry.type !== 'n8n-nodes-base.googleSheetsTool' && entry.name !== CONTEXT_NODE_NAME && entry.id !== CONTEXT_NODE_ID && entry.name !== CRM_COMMERCIAL_CATALOG_TOOL_NAME && entry.id !== CRM_COMMERCIAL_CATALOG_TOOL_ID);
  candidate.nodes.push(createContextNode(), createCatalogTool(credential));
  candidate.connections = candidate.connections || {};
  delete candidate.connections.Knowledge;
  candidate.connections[CRM_COMMERCIAL_CATALOG_TOOL_NAME] = { ai_tool: [[{ node: LIVIA_NODE, type: 'ai_tool', index: 0 }]] };

  const buildConnection = candidate.connections[BUILD_EVIDENCE_NODE] || { main: [[]] };
  const buildTargets = (buildConnection.main?.[0] || []).filter((edge) => edge.node !== LIVIA_NODE && edge.node !== CONTEXT_NODE_NAME);
  candidate.connections[BUILD_EVIDENCE_NODE] = { ...buildConnection, main: [buildTargets.concat([{ node: CONTEXT_NODE_NAME, type: 'main', index: 0 }])] };
  candidate.connections[CONTEXT_NODE_NAME] = { main: [[{ node: LIVIA_NODE, type: 'main', index: 0 }]] };

  const livia = nodeByName(candidate, LIVIA_NODE);
  const model = nodeByName(candidate, 'OpenAI Chat Model');
  const documents = nodeByName(candidate, DOCUMENTS_NODE);
  const assertNode = nodeByName(candidate, VISUAL_ASSERT_NODE);
  if (!livia || !model || !documents || !assertNode) throw new Error('Livia commercial catalog patch prerequisites are missing.');

  let prompt = String(livia.parameters?.text || '');
  const inputMarker = '    videoAnalysis,';
  if (!prompt.includes('crmCatalogUnits: Array.isArray(base.crmCatalogUnits)')) {
    if (!prompt.includes(inputMarker)) throw new Error('Livia prompt data envelope marker is missing.');
    prompt = prompt.replace(inputMarker, '    crmCatalogUnits: Array.isArray(base.crmCatalogUnits) ? base.crmCatalogUnits : [],\n' + inputMarker);
  }
  const cleanedPrompt = cleanAgentText(prompt).trim();
  livia.parameters.text = cleanedPrompt.includes('\nCatálogo comercial oficial do CRM:')
    ? cleanedPrompt
    : `${cleanedPrompt}\n${COMMERCIAL_POLICY}`;
  livia.parameters.options = livia.parameters.options || {};
  const cleanedSystem = cleanAgentText(livia.parameters.options.systemMessage).trim();
  livia.parameters.options.systemMessage = cleanedSystem.includes('\nCatálogo comercial oficial do CRM:')
    ? cleanedSystem
    : `${cleanedSystem}\n${COMMERCIAL_POLICY}`;
  documents.parameters.toolDescription = 'Contexto editorial/brand knowledge da Espaço Facial: tom de voz, benefícios permitidos, diferenciais e mensagens seguras. Ignore qualquer dado comercial que apareça neste contexto; preços, ofertas, combos, parcelamentos, condições e vigências vêm somente do catálogo CRM.';
  updateModelSchema(model);
  addCommercialGuard(assertNode);
  candidate.meta = {
    ...(candidate.meta || {}),
    codexCommercialCatalog: {
      schemaVersion: CRM_COMMERCIAL_CATALOG_SCHEMA_VERSION,
      endpointPath: CRM_COMMERCIAL_CATALOG_PATH,
      toolName: CRM_COMMERCIAL_CATALOG_TOOL_NAME,
      workflowUnits: CRM_COMMERCIAL_CATALOG_UNITS,
      source: 'crm_atendimento.commercial_offers+commercial_offer_procedures/procedures',
      readOnly: true,
    },
  };
  validate(candidate);
  return candidate;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node patch-livia-commercial-catalog.js <input.json> <output.json>');
  const candidate = patchWorkflow(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, tool: CRM_COMMERCIAL_CATALOG_TOOL_NAME, output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = {
  CONTEXT_NODE_NAME,
  CRM_COMMERCIAL_CATALOG_TOOL_NAME,
  patchWorkflow,
  validate,
};
