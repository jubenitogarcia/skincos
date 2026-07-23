'use strict';

const LIVIA_NODE = 'Livia';
const MODEL_NODE = 'OpenAI Chat Model (Agent)';

function findNode(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

function normalizeCopyContract(value) {
  let text = String(value || '');
  text = text
    .replace(/- 1 `description`/g, '- 5 `descriptions`')
    .replace(/Gerar exatamente 1 `description`\./g, 'Gerar exatamente 5 `descriptions`.')
    .replace(/- `description\.text` com no máximo 60 caracteres/g, '- cada `description.text` com no máximo 60 caracteres')
    .replace(/- `description\.text` deve ter no máximo 60 caracteres/g, '- cada `description.text` deve ter no máximo 60 caracteres');

  const repeatedUrlRule = 'A URL principal e o CTA sao controlados pelo workflow a partir do Token Vault; retorne apenas os campos definidos no schema.';
  text = text
    .replace(/A URL principal e o CTA LEARN_MORE sao controlados pelo workflow; retorne apenas os campos definidos no schema\./g, repeatedUrlRule)
    .replace(/A URL principal e o CTA BOOK_NOW sao controlados pelo workflow; retorne apenas os campos definidos no schema\./g, repeatedUrlRule);
  const first = text.indexOf(repeatedUrlRule);
  if (first >= 0) {
    const before = text.slice(0, first + repeatedUrlRule.length);
    const after = text.slice(first + repeatedUrlRule.length)
      .replace(new RegExp(`\\n\\n${repeatedUrlRule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '');
    text = before + after;
  }
  return text;
}

function parseModelSchema(node) {
  const raw = node && node.parameters && node.parameters.options &&
    node.parameters.options.textFormat && node.parameters.options.textFormat.textOptions &&
    node.parameters.options.textFormat.textOptions.schema;
  if (raw && typeof raw === 'object') return structuredClone(raw);
  try { return JSON.parse(String(raw || '')); }
  catch { return null; }
}

function normalizeModelSchema(schema) {
  const next = structuredClone(schema || {});
  next.required = Array.from(new Set(['job_key', 'group_key', ...(Array.isArray(next.required) ? next.required : [])]));
  next.properties = next.properties && typeof next.properties === 'object' ? next.properties : {};
  next.properties.job_key = { type: 'string', minLength: 1 };
  next.properties.group_key = { type: 'string', minLength: 1 };
  const descriptions = next.properties?.creative_override?.properties?.descriptions;
  if (!descriptions || typeof descriptions !== 'object') throw new Error('Livia model schema descriptions missing');
  descriptions.minItems = 5;
  descriptions.maxItems = 5;
  return next;
}

function validateAgentContract(workflow) {
  const failures = [];
  const node = findNode(workflow, LIVIA_NODE);
  if (!node) return ['Livia node missing'];
  const modelNode = findNode(workflow, MODEL_NODE);
  if (!modelNode) failures.push('Livia model node missing');
  const prompt = String(node.parameters && node.parameters.text || '');
  const system = String(node.parameters && node.parameters.options && node.parameters.options.systemMessage || '');
  for (const [label, value] of [['prompt', prompt], ['system', system]]) {
    if (!/5 `descriptions`/.test(value)) failures.push(`Livia ${label} must require 5 descriptions`);
    if (/1 `description`/.test(value)) failures.push(`Livia ${label} still requires 1 description`);
    if (!/cada `description\.text` (?:com|deve ter) no máximo 60 caracteres/.test(value)) {
      failures.push(`Livia ${label} must cap every description at 60 characters`);
    }
  }
  if (/CTA (?:LEARN_MORE|BOOK_NOW) sao controlados/.test(system)) {
    failures.push('Livia system contains a stale fixed CTA rule');
  }
  const schema = parseModelSchema(modelNode);
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  const descriptions = schema?.properties?.creative_override?.properties?.descriptions;
  if (!required.includes('job_key') || !required.includes('group_key')) {
    failures.push('Livia model schema must require job_key and group_key');
  }
  if (!schema?.properties?.job_key || !schema?.properties?.group_key) {
    failures.push('Livia model schema must define job_key and group_key');
  }
  if (Number(descriptions?.minItems) !== 5 || Number(descriptions?.maxItems) !== 5) {
    failures.push('Livia model schema must require exactly 5 descriptions');
  }
  return failures;
}

function applyAgentContract(workflow) {
  const node = findNode(workflow, LIVIA_NODE);
  if (!node) throw new Error('Node not found: Livia');
  const modelNode = findNode(workflow, MODEL_NODE);
  if (!modelNode) throw new Error(`Node not found: ${MODEL_NODE}`);
  node.parameters = node.parameters || {};
  node.parameters.options = node.parameters.options || {};
  const beforePrompt = String(node.parameters.text || '');
  const beforeSystem = String(node.parameters.options.systemMessage || '');
  const afterPrompt = normalizeCopyContract(beforePrompt);
  const afterSystem = normalizeCopyContract(beforeSystem);
  const drift = [];
  if (afterPrompt !== beforePrompt) {
    node.parameters.text = afterPrompt;
    drift.push('Livia prompt copy contract');
  }
  if (afterSystem !== beforeSystem) {
    node.parameters.options.systemMessage = afterSystem;
    drift.push('Livia system copy contract');
  }
  const beforeSchema = parseModelSchema(modelNode);
  if (!beforeSchema) throw new Error('Livia model schema is invalid JSON');
  const afterSchema = normalizeModelSchema(beforeSchema);
  const beforeSchemaText = JSON.stringify(beforeSchema);
  const afterSchemaText = JSON.stringify(afterSchema);
  if (afterSchemaText !== beforeSchemaText) {
    modelNode.parameters.options.textFormat.textOptions.schema = JSON.stringify(afterSchema, null, 2);
    drift.push('Livia model JSON schema');
  }
  return drift;
}

module.exports = { applyAgentContract, validateAgentContract };
