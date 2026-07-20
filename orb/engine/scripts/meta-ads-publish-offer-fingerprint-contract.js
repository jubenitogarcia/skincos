'use strict';

const OFFER_FINGERPRINT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'confidence', 'procedures', 'price_amount_cents', 'price_qualifier',
    'payment_terms', 'condition_terms', 'validity', 'evidence',
  ],
  properties: {
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    procedures: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'quantity', 'unit'],
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 80 },
          quantity: { type: 'string', maxLength: 32 },
          unit: { type: 'string', maxLength: 24 },
        },
      },
    },
    price_amount_cents: { type: 'integer', minimum: 0 },
    price_qualifier: { type: 'string', enum: ['fixed', 'from', 'unknown'] },
    payment_terms: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 48 } },
    condition_terms: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 48 } },
    validity: { type: 'string', maxLength: 80 },
    evidence: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 200 } },
  },
});

const OFFER_PROMPT = [
  'Para cada grupo, preencha offer_fingerprint exclusivamente com fatos visiveis na midia.',
  'Procedures deve conter cada procedimento e sua quantidade/unidade quando exibida; preco deve ser convertido para centavos.',
  'Use price_qualifier=fixed ou from; use unknown e valor 0 quando o preco nao estiver inequivocamente visivel.',
  'Liste pagamento, condicoes e vigencia somente quando visiveis; use arrays vazios e validade vazia quando nao houver.',
  'A confianca mede a certeza comercial, nao a qualidade visual. Nao use nome ou id de arquivo como evidencia.',
].join(' ');

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

function applyOfferFingerprintContract(workflow) {
  const vision = nodeByName(workflow, 'OpenAI Vision Model (Grouping)');
  const agent = nodeByName(workflow, 'Visual Grouping Agent');
  if (!vision || !agent) throw new Error('Nos de agrupamento visual ausentes.');
  const textOptions = vision.parameters?.options?.textFormat?.textOptions;
  if (!textOptions?.schema) throw new Error('Schema do modelo visual ausente.');
  const schema = JSON.parse(textOptions.schema);
  const groupItems = schema?.properties?.groups?.items;
  if (!groupItems?.properties) throw new Error('Schema de grupos visuais invalido.');
  groupItems.properties.offer_fingerprint = OFFER_FINGERPRINT_SCHEMA;
  groupItems.required = [...new Set([...(groupItems.required || []), 'offer_fingerprint'])];
  const nextSchema = JSON.stringify(schema, null, 2);
  const nextText = `${String(agent.parameters?.text || '').replace(/\s*\n?Para cada grupo, preencha offer_fingerprint[\s\S]*$/, '').trim()}\n\n${OFFER_PROMPT}`;
  const nextSystem = `${String(agent.parameters?.options?.systemMessage || '').replace(/\s*\n?Para cada grupo, preencha offer_fingerprint[\s\S]*$/, '').trim()}\n\n${OFFER_PROMPT}`;
  const changes = [];
  if (textOptions.schema !== nextSchema) {
    textOptions.schema = nextSchema;
    changes.push('visual_grouping_schema_offer_fingerprint');
  }
  if (agent.parameters.text !== nextText) {
    agent.parameters.text = nextText;
    changes.push('visual_grouping_prompt_offer_fingerprint');
  }
  if (agent.parameters.options.systemMessage !== nextSystem) {
    agent.parameters.options.systemMessage = nextSystem;
    changes.push('visual_grouping_system_offer_fingerprint');
  }
  return changes;
}

function validateOfferFingerprintContract(workflow) {
  const failures = [];
  const vision = nodeByName(workflow, 'OpenAI Vision Model (Grouping)');
  const agent = nodeByName(workflow, 'Visual Grouping Agent');
  try {
    const schema = JSON.parse(vision?.parameters?.options?.textFormat?.textOptions?.schema || '{}');
    const groupItems = schema?.properties?.groups?.items;
    if (!groupItems?.required?.includes('offer_fingerprint')) failures.push('visual_grouping_offer_fingerprint_not_required');
    if (!groupItems?.properties?.offer_fingerprint) failures.push('visual_grouping_offer_fingerprint_schema_missing');
  } catch {
    failures.push('visual_grouping_schema_invalid_json');
  }
  const text = `${agent?.parameters?.text || ''}\n${agent?.parameters?.options?.systemMessage || ''}`;
  if (!text.includes('offer_fingerprint')) failures.push('visual_grouping_offer_fingerprint_prompt_missing');
  return failures;
}

module.exports = { OFFER_FINGERPRINT_SCHEMA, applyOfferFingerprintContract, validateOfferFingerprintContract };
