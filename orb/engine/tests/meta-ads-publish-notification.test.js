'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'workflows', 'meta-ads-publish.current.json'),
  'utf8',
));

test('success WhatsApp notification uses the documented Evolution HTTP contract with bounded retries', () => {
  const node = workflow.nodes.find((candidate) => candidate.name === 'Inform Meta Publish Success (WhatsApp)');
  assert.ok(node);
  assert.equal(node.type, 'n8n-nodes-base.httpRequest');
  assert.equal(node.typeVersion, 4.3);
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /EVOLUTION_INTERNAL_BASE_URL/);
  assert.match(node.parameters.url, /127\.0\.0\.1:8080/);
  assert.match(node.parameters.url, /N8N_META_ADS_NOTIFY_INSTANCE/);
  assert.match(node.parameters.url, /crm-channel-1/);
  assert.match(node.parameters.url, /message\/sendText/);
  assert.equal(node.parameters.headerParameters.parameters[0].name, 'apikey');
  assert.match(node.parameters.headerParameters.parameters[0].value, /EVOLUTION_API_KEY/);
  assert.match(node.parameters.headerParameters.parameters[0].value, /EVOLUTION_API_KEY\.trim\(\)/);
  assert.match(node.parameters.jsonBody, /N8N_META_ADS_NOTIFY_NUMBER/);
  assert.match(node.parameters.jsonBody, /N8N_HANDOFF_NOTIFY_NUMBER/);
  assert.match(node.parameters.jsonBody, /meta_ads_notify_number_missing/);
  assert.doesNotMatch(node.parameters.jsonBody, /5551995103563/);
  assert.match(node.parameters.jsonBody, /whatsapp_message/);
  assert.equal(node.retryOnFail, true);
  assert.equal(node.maxTries, 3);
  assert.equal(node.waitBetweenTries, 5000);
  assert.equal(node.onError, 'continueRegularOutput');
  assert.equal(node.credentials, undefined);
});

test('success notification retains Telegram as an independent parallel branch', () => {
  const branches = workflow.connections['Should Notify?'].main[0];
  assert.deepEqual(
    branches.map((branch) => branch.node).sort(),
    ['Inform Meta Publish Success (Telegram)', 'Inform Meta Publish Success (WhatsApp)'],
  );
});
