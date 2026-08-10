#!/usr/bin/env node
'use strict';

// Reconciles the notification topology required after Drive/provider
// verification. The current live export omits both notification nodes; the
// immutable candidate restores them without making the live workflow mutable.

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const ASSERT_NODE = 'Assert Drive Published';
const WHATSAPP_NODE = 'Inform Success (1)';
const TELEGRAM_NODE = 'Inform Success (2)';

function fail(message) {
  throw new Error(message);
}

function node(id, name, type, position, parameters, extra = {}) {
  return { id, name, type, position, parameters, ...extra };
}

function ensureConnection(workflow, from, to, outputIndex = 0, inputIndex = 0) {
  workflow.connections ||= {};
  workflow.connections[from] ||= {};
  workflow.connections[from].main ||= [];
  while (workflow.connections[from].main.length <= outputIndex) workflow.connections[from].main.push([]);
  const bucket = workflow.connections[from].main[outputIndex];
  if (!bucket.some((edge) => edge.node === to && edge.index === inputIndex)) {
    bucket.push({ node: to, type: 'main', index: inputIndex });
  }
}

function removeConnection(workflow, from, to) {
  if (!workflow.connections?.[from]) return;
  const outputs = workflow.connections?.[from]?.main || [];
  workflow.connections[from].main = outputs.map((bucket) => (bucket || []).filter((edge) => edge.node !== to));
}

function buildNodes() {
  return [
    node('259ebe5e-6381-4995-bee1-63539587ebdd', WHATSAPP_NODE, 'n8n-nodes-evolution-api-en.evolutionApi', [-3824, -256], {
      resource: 'messages-api',
      remoteJid: '={{ (() => {\n  const phone = String($env.N8N_DEFAULT_TEST_PHONE || "").replace(/\\D/g, "");\n  if (!/^\\d{12,15}$/.test(phone)) throw new Error("N8N_DEFAULT_TEST_PHONE must be a valid E.164 number.");\n  return phone;\n})() }}',
      messageText: '={{ $json.whatsappMessage }}',
      instanceName: 'crm-channel-1',
      options_message: {},
    }, {
      credentials: { evolutionApi: { id: 'bfuWTzZoi8VCYCzE', name: 'Evolution Token' } },
      onError: 'continueErrorOutput',
      executeOnce: true,
      typeVersion: 1,
    }),
    node('6950b2a9-1cf9-4df3-86f7-d7ce736b188b', TELEGRAM_NODE, 'n8n-nodes-base.telegram', [-3600, -256], {
      text: '={{ (() => {\n  function str(value) {\n    return value === undefined || value === null ? \'\' : String(value);\n  }\n\n  function htmlEscape(value) {\n    return str(value)\n      .replace(/&/g, \'&amp;\')\n      .replace(/</g, \'&lt;\')\n      .replace(/>/g, \'&gt;\');\n  }\n\n  const base = $(\'Assert Drive Published\').first().json.whatsappMessage || \'\';\n  if (!str(base).trim()) throw new Error(\'Telegram notification message is empty after Drive verification.\');\n  return htmlEscape(base);\n})() }}',
      chatId: '7893126619',
      additionalFields: {
        parse_mode: 'HTML',
        appendAttribution: false,
        disable_web_page_preview: true,
      },
    }, {
      credentials: { telegramApi: { id: '9NlSo0dcxNrKtlWW', name: 'Telegram – @espacofacial_bot' } },
      webhookId: '2993dea2-5d8a-4f0b-8601-b0c9d6754471',
      typeVersion: 1.2,
    }),
  ];
}

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) fail(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const candidate = structuredClone(workflow);
  const names = new Set((candidate.nodes || []).map((entry) => entry?.name));
  if (!names.has(ASSERT_NODE) || !names.has('Cleanup Temp Files')) {
    fail('Notification contract requires Assert Drive Published and Cleanup Temp Files.');
  }
  const hasWhatsapp = names.has(WHATSAPP_NODE);
  const hasTelegram = names.has(TELEGRAM_NODE);
  if (hasWhatsapp !== hasTelegram) fail('Notification contract found only one of the required notification nodes.');
  if (!hasWhatsapp) candidate.nodes.push(...buildNodes());

  // Both notifications receive the same bounded, already-verified context.
  // Remove the legacy error-output chain to prevent duplicate Telegram sends.
  removeConnection(candidate, WHATSAPP_NODE, TELEGRAM_NODE);
  ensureConnection(candidate, ASSERT_NODE, WHATSAPP_NODE);
  ensureConnection(candidate, ASSERT_NODE, TELEGRAM_NODE);
  return candidate;
}

function validate(workflow) {
  if (workflow?.id !== WORKFLOW_ID) fail(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const nodes = new Map((workflow.nodes || []).map((entry) => [entry?.name, entry]));
  const whatsapp = nodes.get(WHATSAPP_NODE);
  const telegram = nodes.get(TELEGRAM_NODE);
  if (!whatsapp || !telegram) fail('Notification contract requires both WhatsApp and Telegram nodes.');
  if (String(whatsapp.parameters?.remoteJid || '').includes('555195103563')) fail('WhatsApp notification contains a hard-coded phone.');
  if (!String(whatsapp.parameters?.remoteJid || '').includes('N8N_DEFAULT_TEST_PHONE')) fail('WhatsApp notification must use N8N_DEFAULT_TEST_PHONE.');
  if (!String(telegram.parameters?.text || '').includes("$('Assert Drive Published').first().json.whatsappMessage")) {
    fail('Telegram notification must read the verified publication message.');
  }
  const edges = workflow.connections?.[ASSERT_NODE]?.main?.[0] || [];
  for (const target of [WHATSAPP_NODE, TELEGRAM_NODE, 'Cleanup Temp Files']) {
    if (!edges.some((edge) => edge.node === target && edge.type === 'main')) fail(`Assert Drive Published must feed ${target}.`);
  }
  const legacyEdges = workflow.connections?.[WHATSAPP_NODE]?.main || [];
  if (legacyEdges.some((bucket) => (bucket || []).some((edge) => edge.node === TELEGRAM_NODE))) {
    fail('Notification contract must not route Telegram through the WhatsApp error branch.');
  }
  return [WHATSAPP_NODE, TELEGRAM_NODE];
}

module.exports = { patchWorkflow, validate };
