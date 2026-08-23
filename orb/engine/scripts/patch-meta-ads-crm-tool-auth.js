#!/usr/bin/env node
'use strict';

// Normalizes the CRM AI tool to the credential type implemented by n8n's
// toolHttpRequest node. This works on a fresh inactive export only; applying
// it is intentionally delegated to the version-checked workflow snapshot
// script.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CRM_TOOL_NAME = 'CRM Offer Context';
const CRM_URL = 'http://127.0.0.1:8099/api/atendimento/internal/meta-ads/offer-context';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCrmTool(workflow) {
  const tool = workflow?.nodes?.find((node) => node.name === CRM_TOOL_NAME);
  if (!tool || tool.type !== '@n8n/n8n-nodes-langchain.toolHttpRequest') {
    throw new Error('CRM Offer Context HTTP tool is missing.');
  }
  const legacyUrl = `${CRM_URL}?unit={unit}`;
  if (tool.parameters?.url !== CRM_URL && tool.parameters?.url !== legacyUrl) throw new Error('CRM Offer Context URL is unexpected.');
  return tool;
}

function validate(workflow) {
  const tool = getCrmTool(workflow);
  if (tool.parameters?.authentication !== 'genericCredentialType' || tool.parameters?.genericAuthType !== 'httpHeaderAuth' || !tool.credentials?.httpHeaderAuth?.id) {
    throw new Error('CRM Offer Context must use a generic httpHeaderAuth credential.');
  }
  if (tool.credentials?.httpBearerAuth) throw new Error('CRM Offer Context must not retain an unsupported httpBearerAuth credential.');
  const queryUnit = tool.parameters?.parametersQuery?.values?.find((entry) => entry?.name === 'unit');
  if (tool.parameters?.url !== CRM_URL || tool.parameters?.sendQuery !== true || tool.parameters?.specifyQuery !== 'keypair' || queryUnit?.valueProvider !== 'modelRequired') {
    throw new Error('CRM Offer Context must use a model-supplied query parameter for unit.');
  }
  const edge = workflow?.connections?.[CRM_TOOL_NAME]?.ai_tool?.[0]?.[0];
  if (edge?.node !== 'Livia' || edge?.type !== 'ai_tool') throw new Error('CRM Offer Context is not connected to Livia.');
  return true;
}

function transform(workflow, { credentialId, credentialName }) {
  if (workflow?.id !== WORKFLOW_ID || workflow.active !== false) throw new Error('Expected an inactive Meta Ads Publish export.');
  if (!credentialId || !credentialName) throw new Error('A compatible header credential is required.');
  const candidate = clone(workflow);
  const tool = getCrmTool(candidate);
  tool.parameters = {
    ...tool.parameters,
    url: CRM_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendQuery: true,
    specifyQuery: 'keypair',
    parametersQuery: {
      values: [{ name: 'unit', valueProvider: 'modelRequired' }],
    },
  };
  tool.credentials = {
    httpHeaderAuth: { id: credentialId, name: credentialName },
  };
  validate(candidate);
  return candidate;
}

function main() {
  const [input, output, credentialId, credentialName] = process.argv.slice(2);
  if (!input || !output || !credentialId || !credentialName) {
    throw new Error('Usage: node patch-meta-ads-crm-tool-auth.js <input.json> <output.json> <credential-id> <credential-name>');
  }
  const candidate = transform(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')), { credentialId, credentialName });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, crm_tool_auth: 'httpHeaderAuth', output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = { CRM_TOOL_NAME, CRM_URL, transform, validate };
