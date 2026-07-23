#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createMetaAdsPublishStructuredSchema } = require('./lib/meta-ads-publish-structured-schema');

const moduleRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const errorWorkflowPath = path.join(moduleRoot, 'workflows', 'meta-ads-publish-error.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

const MAIN_WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const ERROR_WORKFLOW_ID = 'metaAdsPublishErrorV1';
const GATEWAY_CREDENTIAL = {
  id: 'metaPublishGatewayBearer',
  name: 'Meta Ads Publish - Gateway Bearer',
};

const SOURCE_BY_NODE = Object.freeze({
  'Prepare Visual Grouping Batch': 'prepare-visual-grouping-batch.js',
  'Validate Visual Grouping': 'validate-visual-grouping.js',
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
  'Validate Meta Placement Eligibility': 'validate-meta-placement-eligibility.js',
  'Build Payload': 'build-payload.js',
  'Prepare Publish Run': 'prepare-publish-run.js',
  'Restore Publish Groups': 'restore-publish-groups.js',
  'Prepare Gateway Uploads': 'prepare-gateway-uploads.js',
  'Normalize Gateway Upload': 'normalize-gateway-upload.js',
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Prepare Creative Operation': 'prepare-creative-operation.js',
  'Attach Creative Result': 'attach-creative-result.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
  'Build Stage Batch': 'build-stage-batch.js',
  'Build Activate Batch': 'build-activate-batch.js',
  'Build Drive Finalization': 'build-drive-finalization.js',
  'Prepare Drive Read': 'prepare-drive-read.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
});

function source(name) {
  return fs.readFileSync(path.join(sourceRoot, SOURCE_BY_NODE[name]), 'utf8').replace(/\s+$/, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function node(workflow, name) {
  const found = workflow.nodes.find((entry) => entry.name === name);
  if (!found) throw new Error(`Node not found: ${name}`);
  return found;
}

function upsert(workflow, definition) {
  const index = workflow.nodes.findIndex((entry) => entry.name === definition.name);
  if (index >= 0) workflow.nodes[index] = { ...workflow.nodes[index], ...definition };
  else workflow.nodes.push(definition);
}

function codeNode(id, name, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: source(name),
    },
  };
}

function gatewayNode(id, name, position, method, urlExpression, bodyExpression, options = {}) {
  const parameters = {
    method,
    url: urlExpression,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    sendHeaders: false,
    options: { timeout: options.timeout || 330000 },
  };
  if (bodyExpression) {
    parameters.sendBody = true;
    parameters.specifyBody = 'json';
    parameters.jsonBody = bodyExpression;
  }
  return {
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters,
    credentials: { httpBearerAuth: GATEWAY_CREDENTIAL },
  };
}

function connect(workflow, from, outputs) {
  workflow.connections[from] = {
    main: outputs.map((edges) => edges.map((edge) => ({ type: 'main', index: 0, ...edge }))),
  };
}

function removeNodes(workflow, names) {
  const set = new Set(names);
  workflow.nodes = workflow.nodes.filter((entry) => !set.has(entry.name));
  for (const name of names) delete workflow.connections[name];
  for (const value of Object.values(workflow.connections)) {
    for (const channel of Object.values(value)) {
      for (const edges of channel) {
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          if (set.has(edges[index].node)) edges.splice(index, 1);
        }
      }
    }
  }
}

function structuredOutputSchema() {
  return createMetaAdsPublishStructuredSchema();
}

function visualGroupingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['groups', 'assignments', 'warnings'],
    properties: {
      groups: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['group_key', 'visual_concept', 'confidence', 'evidence'],
          properties: {
            group_key: { type: 'string', pattern: '^VISUAL_GROUP_[0-9]{2,}$' },
            visual_concept: { type: 'string', minLength: 1, maxLength: 160 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
          },
        },
      },
      assignments: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['image_ref', 'group_key', 'slot', 'ratio', 'confidence', 'evidence'],
          properties: {
            image_ref: { type: 'string', pattern: '^IMG_[0-9]{3,}$' },
            group_key: { type: 'string', pattern: '^VISUAL_GROUP_[0-9]{2,}$' },
            slot: { type: 'string', enum: ['feed', 'banner', 'stories'] },
            ratio: { type: 'string', enum: ['1x1', '2x1', '3x4', '4x5', '9x16'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
          },
        },
      },
      warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
    },
  };
}

function upsertVisualGrouping(workflow) {
  const existingModel = node(workflow, 'OpenAI Chat Model (Agent)');
  upsert(workflow, codeNode('meta-publish-prepare-visual-batch', 'Prepare Visual Grouping Batch', [-1984, 384]));
  upsert(workflow, {
    id: 'meta-publish-visual-grouping-agent',
    name: 'Visual Grouping Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 3,
    position: [-1760, 384],
    retryOnFail: false,
    parameters: {
      promptType: 'define',
      text: '=Analise todas as {{ $json.input_count }} imagens anexadas como um unico lote. As imagens aparecem na mesma ordem do manifesto abaixo. Use o indice visual, nunca o nome do arquivo, para devolver image_ref.\n\nManifesto:\n{{ JSON.stringify($json.images.map(({ image_ref, ordinal, mime_type }) => ({ image_ref, ordinal, mime_type }))) }}\n\nDescubra quais imagens sao variacoes do mesmo conceito/oferta e atribua cada imagem exatamente uma vez. Cada grupo deve conter exatamente uma arte feed (1x1, 3x4 ou 4x5), uma banner (2x1) e uma stories (9x16). Retorne somente a estrutura JSON exigida.',
      options: {
        systemMessage: 'Voce e um agente multimodal especializado em organizar criativos de Meta Ads. Compare o lote inteiro visualmente antes de agrupar. Ignore completamente nomes de arquivos. Considere procedimento ou produto, oferta, preco, condicao de pagamento, textos visiveis, pessoas, paleta, composicao e identidade da campanha. Variacoes de proporcao do mesmo conceito e da mesma oferta pertencem ao mesmo grupo; mudanca de oferta, preco, procedimento ou conceito exige outro grupo. Numere os grupos de forma deterministica pela primeira imagem de cada grupo no lote: VISUAL_GROUP_01, VISUAL_GROUP_02 e assim por diante. Classifique a proporcao visual real e o slot. Cada imagem deve aparecer exatamente uma vez, sem duplicatas ou referencias inventadas. Nao force agrupamentos incompletos e nao use nomes de arquivos como evidencia. Responda em portugues do Brasil e somente no schema solicitado.',
        maxIterations: 2,
        passthroughBinaryImages: true,
      },
    },
  });
  upsert(workflow, {
    id: 'meta-publish-visual-grouping-model',
    name: 'OpenAI Vision Model (Grouping)',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.3,
    position: [-1760, 176],
    retryOnFail: true,
    waitBetweenTries: 5000,
    credentials: existingModel.credentials,
    parameters: {
      model: existingModel.parameters.model,
      responsesApiEnabled: true,
      builtInTools: {},
      options: {
        textFormat: {
          textOptions: {
            type: 'json_schema',
            name: 'meta_ads_visual_grouping',
            schema: JSON.stringify(visualGroupingSchema(), null, 2),
          },
        },
      },
    },
  });
  upsert(workflow, codeNode('meta-publish-validate-visual-grouping', 'Validate Visual Grouping', [-1536, 384]));
}

function patchLivia(workflow) {
  const livia = node(workflow, 'Livia');
  livia.position = [-736, 816];
  livia.retryOnFail = false;
  delete livia.maxTries;
  delete livia.waitBetweenTries;
  livia.parameters.text = String(livia.parameters.text)
    .replace(/260 caracteres/g, '240 caracteres')
    .replace(/\n  - 1 `link_url`/g, '')
    .replace(/\n  - 1 `call_to_action_type`/g, '')
    .replace(/\n- Quando não houver URL explícita,[\s\S]*?- O valor de `link_urls\[0\]\.website_url` deve começar com `https:\/\/`\./, '')
    .replace(/\n- O valor de `call_to_action_types` deve ser exatamente um CTA válido do parser\./g, '')
    .replace(/\n- O valor de `link_urls\[0\]\.website_url` deve começar com `https:\/\/`\./g, '')
    .replace(
      'A URL principal e CTA sao controlados pelo workflow a partir do Token Vault; nao gere `link_urls` nem `call_to_action_types`.',
      'A URL principal e o CTA sao controlados pelo workflow a partir do Token Vault; retorne apenas os campos definidos no schema.',
    );
  if (!livia.parameters.text.includes('0 a 4 `site_links`')) {
    livia.parameters.text = livia.parameters.text.replace(
      '- 1 `call_to_action_type`',
      '- 1 `call_to_action_type`\n  - 0 a 4 `site_links` opcionais com `title` e `url` HTTPS',
    );
  }
  if (!livia.parameters.text.includes('allowed_link_hosts:')) {
    livia.parameters.text = livia.parameters.text.replace(
      'media_inventory: $json.media_inventory',
      'media_inventory: $json.media_inventory,\n  allowed_link_hosts: $json.destinations?.[0]?.allowed_link_hosts || []',
    );
  }
  livia.parameters.options.systemMessage = String(livia.parameters.options.systemMessage).replace(/260 caracteres/g, '240 caracteres');
  livia.parameters.options.systemMessage = livia.parameters.options.systemMessage
    .replace(/\n- Gerar exatamente 1 item em `link_urls`\./g, '')
    .replace(/\n- Gerar exatamente 1 item em `call_to_action_types`\./g, '')
    .replace(/\nRegras para URL e CTA:[\s\S]*?\n\nRegras para `analysis`:/, '\n\nRegras para `analysis`:')
    .replace(/\n- Quando não houver URL explícita, conduza para WhatsApp\./g, '')
    .replace(
      'A URL principal e o CTA BOOK_NOW sao controlados pelo workflow; nao retorne `link_urls` nem `call_to_action_types`.',
      'A URL principal e o CTA BOOK_NOW sao controlados pelo workflow; retorne apenas os campos definidos no schema.',
    );
  if (!livia.parameters.options.systemMessage.includes('2 a 4 links HTTPS')) {
    livia.parameters.options.systemMessage = livia.parameters.options.systemMessage.replace(
      '- Gerar exatamente 1 item em `call_to_action_types`.',
      '- Gerar exatamente 1 item em `call_to_action_types`.\n- Gerar `site_links` como array vazio ou com 2 a 4 links HTTPS permitidos pelo input.',
    );
  }
  livia.parameters.options.systemMessage = livia.parameters.options.systemMessage.replace(
    'Se uma informação não estiver segura, deixe em branco ou use formulação neutra.',
    'Se uma informação não estiver segura, interrompa a inferência e use formulação neutra; nunca invente dados.',
  );
  if (!livia.parameters.text.includes('URL principal e CTA sao controlados pelo workflow')) {
    livia.parameters.text = livia.parameters.text.replace(
      'Para `analysis`:',
      'A URL principal e o CTA sao controlados pelo workflow a partir do Token Vault; retorne apenas os campos definidos no schema.\n\nPara `analysis`:',
    );
  }
  if (!livia.parameters.options.systemMessage.includes('URL principal e o CTA BOOK_NOW')) {
    livia.parameters.options.systemMessage = livia.parameters.options.systemMessage.replace(
      'Regras obrigatórias para `creative_override`:',
      'A URL principal e o CTA BOOK_NOW sao controlados pelo workflow; retorne apenas os campos definidos no schema.\n\nRegras obrigatórias para `creative_override`:',
    );
  }

}

function patchOpenAiModel(workflow) {
  const model = node(workflow, 'OpenAI Chat Model (Agent)');
  model.parameters.responsesApiEnabled = true;
  model.parameters.options ||= {};
  model.parameters.options.textFormat = {
    textOptions: {
      type: 'json_schema',
      name: 'meta_ads_publish',
      schema: JSON.stringify(structuredOutputSchema(), null, 2),
    },
  };
}

function patchWorkflow(workflow) {
  if (workflow.id !== MAIN_WORKFLOW_ID) throw new Error(`Unexpected workflow id: ${workflow.id}`);
  removeNodes(workflow, [
    'Wait',
    'Switch',
    'Create Ad',
    'Update Ad',
    'Record Meta Publish Result',
    'Meta Publish Structured Output',
  ]);
  workflow.settings = {
    ...(workflow.settings || {}),
    errorWorkflow: ERROR_WORKFLOW_ID,
    executionTimeout: 1800,
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
  };

  const search = node(workflow, 'Search File');
  search.position = [-2432, 512];
  search.parameters.options = { ...(search.parameters.options || {}), fields: ['*'] };
  search.maxTries = 3;
  search.waitBetweenTries = 3000;

  const download = node(workflow, 'Download File');
  download.position = [-2208, 512];
  download.maxTries = 3;
  download.waitBetweenTries = 3000;
  upsertVisualGrouping(workflow);

  const getConfig = workflow.nodes.find((entry) => ['Get Credential Tokens', 'Get Meta Publish Config'].includes(entry.name));
  if (!getConfig) throw new Error('Config gateway node not found.');
  getConfig.name = 'Get Meta Publish Config';
  getConfig.position = [-2432, 736];
  getConfig.retryOnFail = false;
  delete getConfig.waitBetweenTries;
  getConfig.parameters = {
    method: 'GET',
    url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/config' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    sendHeaders: false,
    options: { timeout: 60000 },
  };
  getConfig.credentials = { httpBearerAuth: GATEWAY_CREDENTIAL };

  const buildConfig = node(workflow, 'Build Meta API Params From Vault');
  buildConfig.position = [-2208, 736];
  buildConfig.parameters.jsCode = source(buildConfig.name);

  upsert(workflow, codeNode('meta-publish-build-inventory', 'Build Meta Account Inventory Requests', [-1984, 864]));
  const inventory = node(workflow, 'Meta List Ads');
  inventory.position = [-1760, 864];
  inventory.retryOnFail = false;
  delete inventory.waitBetweenTries;
  inventory.parameters = {
    method: 'POST',
    url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/inventory' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    sendHeaders: false,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ $json }}',
    options: { timeout: 330000 },
  };
  inventory.credentials = { httpBearerAuth: GATEWAY_CREDENTIAL };
  upsert(workflow, codeNode('meta-publish-validate-placements', 'Validate Meta Placement Eligibility', [-1536, 864]));

  const mergeInput = node(workflow, 'Merge (1)');
  mergeInput.position = [-1312, 640];
  mergeInput.parameters = { numberInputs: 3 };
  const buildPayload = node(workflow, 'Build Payload');
  buildPayload.position = [-1088, 640];
  buildPayload.retryOnFail = false;
  delete buildPayload.waitBetweenTries;
  buildPayload.parameters.jsCode = source(buildPayload.name);

  upsert(workflow, codeNode('meta-publish-prepare-run', 'Prepare Publish Run', [-864, 640]));
  upsert(workflow, gatewayNode(
    'meta-publish-acquire-run',
    'Acquire Publish Run',
    [-640, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs' }}",
    '={{ $json }}',
  ));
  upsert(workflow, codeNode('meta-publish-restore-groups', 'Restore Publish Groups', [-416, 640]));
  upsert(workflow, {
    id: 'meta-publish-resume-route',
    name: 'Resume Drive Only?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [-192, 640],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'meta-publish-resume-condition',
          leftValue: '={{ $json.resume_drive_only }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  });

  upsert(workflow, codeNode('meta-publish-prepare-uploads', 'Prepare Gateway Uploads', [-192, 480]));
  const upload = node(workflow, 'Upload File');
  upload.position = [32, 480];
  upload.retryOnFail = false;
  delete upload.waitBetweenTries;
  upload.parameters = {
    method: 'POST',
    url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    sendHeaders: false,
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        { parameterType: 'formData', name: 'request', value: '={{ JSON.stringify($json.gateway_request) }}' },
        { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
      ],
    },
    options: { timeout: 330000 },
  };
  upload.credentials = { httpBearerAuth: GATEWAY_CREDENTIAL };
  upsert(workflow, codeNode('meta-publish-normalize-upload', 'Normalize Gateway Upload', [256, 480]));

  patchLivia(workflow);
  patchOpenAiModel(workflow);
  const mergeAi = node(workflow, 'Merge (2)');
  mergeAi.position = [480, 640];
  mergeAi.parameters = {};
  const buildJobs = node(workflow, 'Build Jobs');
  buildJobs.position = [704, 640];
  buildJobs.retryOnFail = false;
  delete buildJobs.waitBetweenTries;
  buildJobs.parameters.jsCode = source(buildJobs.name);
  const validate = node(workflow, 'Validate Meta Creative Payload');
  validate.position = [928, 640];
  validate.retryOnFail = false;
  delete validate.waitBetweenTries;
  validate.parameters.jsCode = source(validate.name);

  upsert(workflow, codeNode('meta-publish-prepare-creative', 'Prepare Creative Operation', [1152, 640]));
  const createCreative = node(workflow, 'Create AdCreative');
  Object.assign(createCreative, gatewayNode(
    createCreative.id,
    createCreative.name,
    [1376, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    '={{ $json.gateway_request }}',
  ));
  createCreative.retryOnFail = false;
  delete createCreative.maxTries;
  delete createCreative.waitBetweenTries;
  upsert(workflow, codeNode('meta-publish-attach-creative', 'Attach Creative Result', [1600, 640]));
  const verifyCreative = node(workflow, 'Verify Advantage+ Creative');
  Object.assign(verifyCreative, gatewayNode(
    verifyCreative.id,
    verifyCreative.name,
    [1824, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    '={{ $json.gateway_request }}',
  ));
  verifyCreative.retryOnFail = false;
  delete verifyCreative.maxTries;
  delete verifyCreative.waitBetweenTries;
  const attachVerification = node(workflow, 'Attach Advantage+ Verification');
  attachVerification.position = [2048, 640];
  attachVerification.retryOnFail = false;
  delete attachVerification.waitBetweenTries;
  attachVerification.parameters.jsCode = source(attachVerification.name);

  upsert(workflow, codeNode('meta-publish-build-stage', 'Build Stage Batch', [2272, 640]));
  upsert(workflow, gatewayNode(
    'meta-publish-stage-batch',
    'Stage Ad Batch',
    [2496, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    '={{ $json.gateway_request }}',
  ));
  upsert(workflow, codeNode('meta-publish-build-activate', 'Build Activate Batch', [2720, 640]));
  upsert(workflow, gatewayNode(
    'meta-publish-activate-batch',
    'Activate Ad Batch',
    [2944, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    '={{ $json.gateway_request }}',
  ));

  upsert(workflow, codeNode('meta-publish-drive-finalization', 'Build Drive Finalization', [3168, 640]));
  const updateDrive = node(workflow, 'Update Meta Source File');
  updateDrive.position = [3392, 640];
  updateDrive.retryOnFail = true;
  updateDrive.maxTries = 3;
  updateDrive.waitBetweenTries = 3000;
  updateDrive.onError = 'continueRegularOutput';
  const properties = updateDrive.parameters.options.propertiesUi.propertyValues;
  if (!properties.some((entry) => entry.key === 'meta_ads_run_id')) {
    properties.push({ key: 'meta_ads_run_id', value: '={{ $json.meta_ads_run_id }}' });
  }
  upsert(workflow, codeNode('meta-publish-prepare-drive-read', 'Prepare Drive Read', [3616, 640]));
  upsert(workflow, {
    id: 'meta-publish-read-drive',
    name: 'Read Meta Source File',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [3840, 640],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: '=https://www.googleapis.com/drive/v3/files/{{$json.id}}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'fields', value: 'id,name,properties' }] },
      options: { timeout: 60000 },
    },
    credentials: { googleDriveOAuth2Api: updateDrive.credentials.googleDriveOAuth2Api },
  });
  upsert(workflow, codeNode('meta-publish-verify-drive', 'Verify Drive Finalization', [4064, 640]));
  upsert(workflow, gatewayNode(
    'meta-publish-complete-run',
    'Complete Publish Run',
    [4288, 640],
    'PATCH',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id }}",
    '={{ $json.completion_request }}',
    { timeout: 60000 },
  ));
  upsert(workflow, gatewayNode(
    'meta-publish-claim-notification',
    'Claim Success Notification',
    [4512, 640],
    'POST',
    "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $('Verify Drive Finalization').first().json.run_id + '/events' }}",
    "={{ ({ event_key: 'success_notification', payload: { whatsapp_message: $('Verify Drive Finalization').first().json.whatsapp_message, telegram_message: $('Verify Drive Finalization').first().json.telegram_message } }) }}",
    { timeout: 60000 },
  ));
  upsert(workflow, {
    id: 'meta-publish-should-notify',
    name: 'Should Notify?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [4736, 640],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'meta-publish-notify-condition',
          leftValue: '={{ $json.claimed }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  });

  const whatsapp = node(workflow, 'Inform Meta Publish Success (WhatsApp)');
  whatsapp.position = [4960, 560];
  whatsapp.retryOnFail = false;
  whatsapp.onError = 'continueRegularOutput';
  whatsapp.parameters = {
    resource: 'messages-api',
    operation: 'send-text',
    instanceName: 'crm-channel-1',
    remoteJid: '5551995103563',
    messageText: '={{ $json.event.payload.whatsapp_message }}',
    options_message: {},
  };
  const telegram = node(workflow, 'Inform Meta Publish Success (Telegram)');
  telegram.position = [4960, 720];
  telegram.retryOnFail = false;
  telegram.parameters.text = '={{ $json.event.payload.telegram_message }}';

  workflow.connections = {};
  connect(workflow, 'When clicking ‘Execute workflow’', [[
    { node: 'Search File' },
    { node: 'Get Meta Publish Config' },
  ]]);
  connect(workflow, 'Search File', [[{ node: 'Download File' }]]);
  connect(workflow, 'Download File', [[{ node: 'Prepare Visual Grouping Batch' }]]);
  connect(workflow, 'Prepare Visual Grouping Batch', [[{ node: 'Visual Grouping Agent' }]]);
  connect(workflow, 'Visual Grouping Agent', [[{ node: 'Validate Visual Grouping' }]]);
  connect(workflow, 'Validate Visual Grouping', [[{ node: 'Merge (1)', index: 0 }]]);
  connect(workflow, 'Get Meta Publish Config', [[{ node: 'Build Meta API Params From Vault' }]]);
  connect(workflow, 'Build Meta API Params From Vault', [[
    { node: 'Merge (1)', index: 1 },
    { node: 'Build Meta Account Inventory Requests' },
  ]]);
  connect(workflow, 'Build Meta Account Inventory Requests', [[{ node: 'Meta List Ads' }]]);
  connect(workflow, 'Meta List Ads', [[{ node: 'Validate Meta Placement Eligibility' }]]);
  connect(workflow, 'Validate Meta Placement Eligibility', [[{ node: 'Merge (1)', index: 2 }]]);
  connect(workflow, 'Merge (1)', [[{ node: 'Build Payload' }]]);
  connect(workflow, 'Build Payload', [[{ node: 'Prepare Publish Run' }]]);
  connect(workflow, 'Prepare Publish Run', [[{ node: 'Acquire Publish Run' }]]);
  connect(workflow, 'Acquire Publish Run', [[{ node: 'Restore Publish Groups' }]]);
  connect(workflow, 'Restore Publish Groups', [[{ node: 'Resume Drive Only?' }]]);
  connect(workflow, 'Resume Drive Only?', [
    [{ node: 'Build Drive Finalization' }],
    [{ node: 'Prepare Gateway Uploads' }, { node: 'Livia' }],
  ]);
  connect(workflow, 'Prepare Gateway Uploads', [[{ node: 'Upload File' }]]);
  connect(workflow, 'Upload File', [[{ node: 'Normalize Gateway Upload' }]]);
  connect(workflow, 'Normalize Gateway Upload', [[{ node: 'Merge (2)', index: 1 }]]);
  connect(workflow, 'Livia', [[{ node: 'Merge (2)', index: 0 }]]);
  connect(workflow, 'Merge (2)', [[{ node: 'Build Jobs' }]]);
  connect(workflow, 'Build Jobs', [[{ node: 'Validate Meta Creative Payload' }]]);
  connect(workflow, 'Validate Meta Creative Payload', [[{ node: 'Prepare Creative Operation' }]]);
  connect(workflow, 'Prepare Creative Operation', [[{ node: 'Create AdCreative' }]]);
  connect(workflow, 'Create AdCreative', [[{ node: 'Attach Creative Result' }]]);
  connect(workflow, 'Attach Creative Result', [[{ node: 'Verify Advantage+ Creative' }]]);
  connect(workflow, 'Verify Advantage+ Creative', [[{ node: 'Attach Advantage+ Verification' }]]);
  connect(workflow, 'Attach Advantage+ Verification', [[{ node: 'Build Stage Batch' }]]);
  connect(workflow, 'Build Stage Batch', [[{ node: 'Stage Ad Batch' }]]);
  connect(workflow, 'Stage Ad Batch', [[{ node: 'Build Activate Batch' }]]);
  connect(workflow, 'Build Activate Batch', [[{ node: 'Activate Ad Batch' }]]);
  connect(workflow, 'Activate Ad Batch', [[{ node: 'Build Drive Finalization' }]]);
  connect(workflow, 'Build Drive Finalization', [[{ node: 'Update Meta Source File' }]]);
  connect(workflow, 'Update Meta Source File', [[{ node: 'Prepare Drive Read' }]]);
  connect(workflow, 'Prepare Drive Read', [[{ node: 'Read Meta Source File' }]]);
  connect(workflow, 'Read Meta Source File', [[{ node: 'Verify Drive Finalization' }]]);
  connect(workflow, 'Verify Drive Finalization', [[{ node: 'Complete Publish Run' }]]);
  connect(workflow, 'Complete Publish Run', [[{ node: 'Claim Success Notification' }]]);
  connect(workflow, 'Claim Success Notification', [[{ node: 'Should Notify?' }]]);
  connect(workflow, 'Should Notify?', [[
    { node: 'Inform Meta Publish Success (WhatsApp)' },
    { node: 'Inform Meta Publish Success (Telegram)' },
  ], []]);
  workflow.connections['OpenAI Chat Model (Agent)'] = { ai_languageModel: [[{ node: 'Livia', type: 'ai_languageModel', index: 0 }]] };
  workflow.connections['OpenAI Vision Model (Grouping)'] = { ai_languageModel: [[{ node: 'Visual Grouping Agent', type: 'ai_languageModel', index: 0 }]] };
  workflow.connections.Knowledge = { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] };
  workflow.connections.Documents = { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] };
  workflow.connections['Embeddings OpenAI'] = { ai_embedding: [[{ node: 'Documents', type: 'ai_embedding', index: 0 }]] };

  return workflow;
}

function buildErrorWorkflow(main) {
  const whatsapp = node(main, 'Inform Meta Publish Success (WhatsApp)');
  const telegram = node(main, 'Inform Meta Publish Success (Telegram)');
  const errorCode = `function text(value) { return String(value ?? '').trim(); }
const root = $input.first()?.json || {};
const execution = root.execution || {};
const workflow = root.workflow || {};
const raw = text(execution.error?.message || root.error?.message || 'Falha nao classificada');
const safe = raw.replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{80,}/g, '[REDACTED]').slice(0, 800);
const message = ['Meta Ads Publish falhou', 'Workflow: ' + text(workflow.name || '${MAIN_WORKFLOW_ID}'), 'Execucao: ' + text(execution.id), 'Ultimo no: ' + text(execution.lastNodeExecuted), 'Erro: ' + safe].join('\\n');
return [{ json: { message } }];`;
  return {
    id: ERROR_WORKFLOW_ID,
    name: 'Meta Ads Publish - Error Handler',
    active: false,
    settings: {
      timezone: 'America/Sao_Paulo',
      executionOrder: 'v1',
      saveDataSuccessExecution: 'all',
      saveDataErrorExecution: 'all',
      saveManualExecutions: true,
      saveExecutionProgress: true,
    },
    nodes: [
      { id: 'meta-publish-error-trigger', name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [-320, 0], parameters: {} },
      { id: 'meta-publish-error-build', name: 'Build Sanitized Error Alert', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-96, 0], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: errorCode } },
      { ...whatsapp, id: 'meta-publish-error-whatsapp', name: 'Alert Meta Publish Error (WhatsApp)', position: [128, -80], retryOnFail: false, parameters: { resource: 'messages-api', operation: 'send-text', instanceName: 'crm-channel-1', remoteJid: '5551995103563', messageText: '={{ $json.message }}', options_message: {} } },
      { ...telegram, id: 'meta-publish-error-telegram', name: 'Alert Meta Publish Error (Telegram)', position: [128, 80], retryOnFail: false, parameters: { ...telegram.parameters, text: '={{ $json.message }}' } },
    ],
    connections: {
      'Error Trigger': { main: [[{ node: 'Build Sanitized Error Alert', type: 'main', index: 0 }]] },
      'Build Sanitized Error Alert': { main: [[
        { node: 'Alert Meta Publish Error (WhatsApp)', type: 'main', index: 0 },
        { node: 'Alert Meta Publish Error (Telegram)', type: 'main', index: 0 },
      ]] },
    },
  };
}

function validate(workflow) {
  const names = new Set(workflow.nodes.map((entry) => entry.name));
  if (names.size !== workflow.nodes.length) throw new Error('Duplicate node names.');
  for (const [from, channels] of Object.entries(workflow.connections)) {
    if (!names.has(from)) throw new Error(`Connection source missing: ${from}`);
    for (const edges of Object.values(channels).flat()) {
      for (const edge of edges) if (!names.has(edge.node)) throw new Error(`Connection target missing: ${edge.node}`);
    }
  }
  const serialized = JSON.stringify(workflow);
  const forbidden = ['graph.facebook.com', 'access_token', 'TOKEN_VAULT_API_TOKEN', "'v24.0'", 'standard_enhancements', '$getWorkflowStaticData'];
  for (const marker of forbidden) if (serialized.includes(marker)) throw new Error(`Forbidden marker remains: ${marker}`);
  for (const required of ['Stage Ad Batch', 'Activate Ad Batch', 'Verify Drive Finalization', 'OpenAI Chat Model (Agent)', 'Visual Grouping Agent', 'OpenAI Vision Model (Grouping)', 'Validate Visual Grouping']) {
    if (!names.has(required)) throw new Error(`Required node missing: ${required}`);
  }
  if (names.has('Meta Publish Structured Output')) throw new Error('Legacy structured output parser remains.');
  const model = node(workflow, 'OpenAI Chat Model (Agent)');
  if (model.parameters.responsesApiEnabled !== true) throw new Error('Responses API must be enabled for direct JSON schema output.');
  for (const current of workflow.nodes.filter((entry) => SOURCE_BY_NODE[entry.name])) {
    if (current.parameters.jsCode !== source(current.name)) throw new Error(`Code source drift: ${current.name}`);
  }
}

const workflow = patchWorkflow(readJson(workflowPath));
validate(workflow);
const errorWorkflow = buildErrorWorkflow(workflow);
writeJson(workflowPath, workflow);
writeJson(errorWorkflowPath, errorWorkflow);
console.log(JSON.stringify({ workflow: workflowPath, errorWorkflow: errorWorkflowPath, nodes: workflow.nodes.length }, null, 2));
