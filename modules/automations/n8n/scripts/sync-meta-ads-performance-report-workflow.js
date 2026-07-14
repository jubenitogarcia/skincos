const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const workflowFiles = [
  path.join(rootDir, 'workflows/meta-ads.performance-report.live-synced.json'),
  path.join(rootDir, 'workflows/meta-ads.performance-report.json'),
];

const nodeSources = {
  'Extract Inventory Items': path.join(rootDir, 'workflow-src/meta-ads-performance-report/extract-inventory-items.js'),
  'Limit Campaigns': path.join(rootDir, 'workflow-src/meta-ads-performance-report/limit-campaigns.js'),
  'Limit Adsets': path.join(rootDir, 'workflow-src/meta-ads-performance-report/limit-adsets.js'),
  'Limit Ads': path.join(rootDir, 'workflow-src/meta-ads-performance-report/limit-ads.js'),
  'Build Insights': path.join(rootDir, 'workflow-src/meta-ads-performance-report/build-insights.js'),
  'Normalize Metrics': path.join(rootDir, 'workflow-src/meta-ads-performance-report/normalize-metrics.js'),
  'Consolidate Metrics': path.join(rootDir, 'workflow-src/meta-ads-performance-report/consolidate-metrics.js'),
  'Prepare Worker Persistence': path.join(rootDir, 'workflow-src/meta-ads-performance-report/prepare-worker-request.js'),
  'Fail Worker Persistence Config': path.join(rootDir, 'workflow-src/meta-ads-performance-report/fail-worker-persistence-config.js'),
  'Validate Worker Persistence': path.join(rootDir, 'workflow-src/meta-ads-performance-report/validate-worker-persistence.js'),
};

const metaBearerCredential = {
  id: '9c46d5b6-94b7-4dcc-b6d5-71d7cb5c5e7c',
  name: 'Meta Ads Performance Report - Meta Graph Bearer',
};

const workerBearerCredential = {
  id: '61fca8c3-3818-4f8d-98bb-f091ddfce3c3',
  name: 'Meta Ads Performance Report - Worker Bearer',
};

const metaNodeUrls = {
  'List Campaigns': "={{ 'https://graph.facebook.com/' + ($json.api_version || 'v24.0') + '/act_' + $json.account_id + '/campaigns' }}",
  'List Adsets': "={{ 'https://graph.facebook.com/' + (($('Params').item.json.api_version || 'v24.0')) + '/' + $json.id + '/adsets' }}",
  'List Ads': "={{ 'https://graph.facebook.com/' + (($('Params').item.json.api_version || 'v24.0')) + '/' + $json.id + '/ads' }}",
  'Get Ad': "={{ 'https://graph.facebook.com/' + (($('Params').item.json.api_version || 'v24.0')) + '/' + ($json.ad_id || $json.id) }}",
  'Get Creative': "={{ 'https://graph.facebook.com/' + (($('Params').item.json.api_version || 'v24.0')) + '/' + (($json.creative && $json.creative.id) || $json.creative_id) }}",
  'Get AdSet': "={{ 'https://graph.facebook.com/' + (($('Params').item.json.api_version || 'v24.0')) + '/' + ($json.adset_id || $json.source_adset_id || $json.id) }}",
  'Get Insights': '={{ $json.insights_url }}',
};

const metaNodeOptionsByName = {
  'List Campaigns': {
    timeout: 60000,
  },
  'List Adsets': {
    timeout: 60000,
    batching: { batch: { batchSize: 1, batchInterval: 4000 } },
  },
  'List Ads': {
    timeout: 60000,
    batching: { batch: { batchSize: 1, batchInterval: 2500 } },
  },
  'Get Ad': {
    batching: { batch: { batchSize: 10, batchInterval: 1000 } },
  },
  'Get Creative': {
    batching: { batch: { batchSize: 10, batchInterval: 1000 } },
  },
  'Get AdSet': {
    batching: { batch: { batchSize: 10, batchInterval: 1000 } },
  },
  'Get Insights': {
    timeout: 60000,
    batching: { batch: { batchSize: 5, batchInterval: 2000 } },
  },
};

const metaNodeFieldParametersByName = {
  'Get Ad': 'id,name,status',
  'Get Creative': 'id,name,status,account_id',
  'Get AdSet': 'id,name,campaign_id,account_id',
};

const stableFieldAllowlistsByNode = {
  'Get Ad': new Set(['id', 'name', 'status']),
  'Get Creative': new Set(['id', 'name', 'status', 'account_id']),
  'Get AdSet': new Set(['id', 'name', 'campaign_id', 'account_id']),
};

const bannedFieldsByNode = {
  'Get Ad': new Set(['effective_status', 'configured_status']),
  'Get Creative': new Set([
    'effective_instagram_media_id',
    'thumbnail_url',
    'object_id',
    'asset_feed_spec',
  ]),
  'Get AdSet': new Set(['effective_status', 'configured_status', 'source_adset_id']),
};

function loadSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\s+$/, '') + '\n';
}

function ensureNode(workflow, nodeDefinition) {
  const existingNode = (workflow.nodes || []).find((entry) => entry.name === nodeDefinition.name);

  if (existingNode) {
    Object.assign(existingNode, nodeDefinition, {
      parameters: { ...(existingNode.parameters || {}), ...(nodeDefinition.parameters || {}) },
    });
    return existingNode;
  }

  workflow.nodes = workflow.nodes || [];
  workflow.nodes.push(nodeDefinition);
  return nodeDefinition;
}

function ensureConnection(workflow, sourceNode, sourceIndex, targetNode, targetIndex) {
  workflow.connections = workflow.connections || {};
  workflow.connections[sourceNode] = workflow.connections[sourceNode] || { main: [] };
  workflow.connections[sourceNode].main[sourceIndex] = workflow.connections[sourceNode].main[sourceIndex] || [];

  const branch = workflow.connections[sourceNode].main[sourceIndex];
  const alreadyConnected = branch.some((entry) => entry.node === targetNode && entry.type === 'main' && entry.index === targetIndex);

  if (!alreadyConnected) {
    branch.push({
      node: targetNode,
      type: 'main',
      index: targetIndex,
    });
  }
}

function replaceConnections(workflow, sourceNode, connections) {
  workflow.connections = workflow.connections || {};
  workflow.connections[sourceNode] = { main: connections };
}

const paramsStringValues = [
  { name: 'account_id', value: "={{ $vars['META_ADS_ACCOUNT_ID'] || '' }}" },
  { name: 'api_version', value: "={{ $vars['META_ADS_API_VERSION'] || 'v24.0' }}" },
  { name: 'report_mode', value: "={{ $vars['META_ADS_REPORT_MODE'] || 'full' }}" },
  { name: 'environment', value: "={{ $vars['META_ADS_REPORT_ENVIRONMENT'] || 'local' }}" },
  { name: 'storage_mode', value: "={{ $vars['META_ADS_REPORT_STORAGE_MODE'] || 'cloudflare_worker' }}" },
  { name: 'worker_base_url', value: "={{ $vars['META_ADS_REPORT_WORKER_BASE_URL'] || '' }}" },
  { name: 'cloudflare_worker_url', value: "={{ $vars['META_ADS_REPORT_WORKER_BASE_URL'] || '' }}" },
  { name: 'worker_persist_path', value: "={{ $vars['META_ADS_REPORT_WORKER_PERSIST_PATH'] || '/ingest/meta-ads-performance-report' }}" },
  { name: 'worker_auth_header', value: "={{ $vars['META_ADS_REPORT_WORKER_AUTH_HEADER'] || 'Authorization' }}" },
  { name: 'worker_auth_scheme', value: "={{ $vars['META_ADS_REPORT_WORKER_AUTH_SCHEME'] || 'Bearer' }}" },
  { name: 'worker_timeout_ms', value: "={{ $vars['META_ADS_REPORT_WORKER_TIMEOUT_MS'] || '120000' }}" },
  { name: 'd1_database_name', value: "={{ $vars['META_ADS_REPORT_D1_DATABASE_NAME'] || '' }}" },
  { name: 'r2_bucket_name', value: "={{ $vars['META_ADS_REPORT_R2_BUCKET_NAME'] || '' }}" },
  { name: 'raw_payloads_enabled', value: "={{ $vars['META_ADS_REPORT_RAW_PAYLOADS_ENABLED'] || 'true' }}" },
  { name: 'compatibility_export_enabled', value: "={{ $vars['META_ADS_REPORT_COMPAT_EXPORT_ENABLED'] || 'false' }}" },
  { name: 'compatibility_export_target', value: "={{ $vars['META_ADS_REPORT_COMPAT_EXPORT_TARGET'] || 'google_sheets_optional' }}" },
  { name: 'inventory_enabled', value: "={{ $vars['META_ADS_REPORT_INVENTORY_ENABLED'] || 'false' }}" },
  { name: 'inventory_freshness_hours', value: "={{ $vars['META_ADS_REPORT_INVENTORY_FRESHNESS_HOURS'] || '168' }}" },
  { name: 'inventory_ads_limit', value: "={{ $vars['META_ADS_REPORT_INVENTORY_ADS_LIMIT'] || '500' }}" },
  { name: 'max_campaigns', value: "={{ $vars['META_ADS_REPORT_MAX_CAMPAIGNS'] || '' }}" },
  { name: 'max_adsets_per_campaign', value: "={{ $vars['META_ADS_REPORT_MAX_ADSETS_PER_CAMPAIGN'] || '' }}" },
  { name: 'max_ads_per_adset', value: "={{ $vars['META_ADS_REPORT_MAX_ADS_PER_ADSET'] || '' }}" },
];

function syncParamsNode(workflow) {
  const paramsNode = (workflow.nodes || []).find((entry) => entry.name === 'Params');

  if (!paramsNode) {
    throw new Error(`Node "Params" not found in workflow.`);
  }

  paramsNode.parameters = paramsNode.parameters || {};
  paramsNode.parameters.keepOnlySet = true;
  paramsNode.parameters.values = paramsNode.parameters.values || {};
  paramsNode.parameters.values.string = paramsStringValues;
  paramsNode.parameters.options = paramsNode.parameters.options || {};
}

function syncMetaHttpNode(workflow, nodeName) {
  const node = (workflow.nodes || []).find((entry) => entry.name === nodeName);

  if (!node) {
    throw new Error(`Node "${nodeName}" not found in workflow.`);
  }

  node.parameters = node.parameters || {};
  node.parameters.authentication = 'genericCredentialType';
  node.parameters.genericAuthType = 'httpBearerAuth';
  node.parameters.sendHeaders = false;
  if (metaNodeUrls[nodeName]) {
    node.parameters.url = metaNodeUrls[nodeName];
  }
  if (metaNodeFieldParametersByName[nodeName]) {
    node.parameters.sendQuery = true;
    node.parameters.queryParameters = {
      parameters: [
        {
          name: 'fields',
          value: metaNodeFieldParametersByName[nodeName],
        },
      ],
    };
  }
  node.parameters.options = {
    ...(node.parameters.options || {}),
    ...(metaNodeOptionsByName[nodeName] || {}),
  };
  delete node.parameters.headerParameters;
  node.retryOnFail = true;
  node.maxTries = 5;
  node.waitBetweenTries = 15000;
  node.credentials = {
    ...(node.credentials || {}),
    httpBearerAuth: metaBearerCredential,
  };
}

function validateStableHttpFields(workflowFile, workflow, nodeName) {
  const node = (workflow.nodes || []).find((entry) => entry.name === nodeName);

  if (!node) {
    throw new Error(`Node "${nodeName}" not found in ${workflowFile}`);
  }

  const fieldsParameter = ((node.parameters || {}).queryParameters || {}).parameters || [];
  const fieldsValue = fieldsParameter.find((entry) => entry.name === 'fields')?.value || '';
  const fields = String(fieldsValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const bannedFields = bannedFieldsByNode[nodeName] || new Set();
  const invalidFields = fields.filter((field) => bannedFields.has(field));
  if (invalidFields.length) {
    throw new Error(
      `${nodeName} in ${workflowFile} contains banned fields: ${invalidFields.join(', ')}`,
    );
  }

  const allowedFields = stableFieldAllowlistsByNode[nodeName];
  const unsupportedFields = allowedFields
    ? fields.filter((field) => !allowedFields.has(field))
    : [];
  if (unsupportedFields.length) {
    throw new Error(
      `${nodeName} in ${workflowFile} contains unsupported fields outside the stable allowlist: ${unsupportedFields.join(', ')}`,
    );
  }
}

function syncMergeNode(workflow) {
  const node = (workflow.nodes || []).find((entry) => entry.name === 'Merge');

  if (!node) {
    throw new Error('Node "Merge" not found in workflow.');
  }

  node.parameters = {
    mode: 'combine',
    combineBy: 'combineByPosition',
    numberInputs: 3,
    options: {
      includeUnpaired: false,
      clashHandling: {
        values: {
          resolveClash: 'addSuffix',
        },
      },
    },
  };
}

function syncInventoryNodes(workflow) {
  ensureNode(workflow, {
    id: 'a0eced25-e7dd-4a96-b936-801b7e65e25d',
    name: 'If Inventory Enabled',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-2240, -896],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: '81f7c786-a6c2-4b7b-8202-1cd0d60d2209',
            leftValue: "={{ ($json.inventory_enabled || '').toString().toLowerCase() === 'true' }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  });

  ensureNode(workflow, {
    id: '77e9a24f-d4f8-4c25-bf7f-4fcbf0a35b0d',
    name: 'Fetch Worker Inventory',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [-2016, -896],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    parameters: {
      method: 'GET',
      url: "={{ $json.worker_base_url.replace(/\\/+$/, '') + '/inventory/meta-ads-performance-report' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendQuery: true,
      specifyQuery: 'json',
      jsonQuery: "={{ JSON.stringify({ account_id: $json.account_id, freshness_hours: $json.inventory_freshness_hours || '168', limit: $json.inventory_ads_limit || '500' }) }}",
      sendHeaders: false,
      options: {
        timeout: 30000,
        response: {
          response: {
            fullResponse: true,
            neverError: true,
          },
        },
      },
    },
    credentials: {
      httpBearerAuth: workerBearerCredential,
    },
  });

  ensureNode(workflow, {
    id: 'f589a972-6adf-4ed8-9be8-5c41b1b1e1e0',
    name: 'If Inventory Available',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-1792, -896],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: '2a9f6e6e-f0d2-4b6b-bcad-e730ca4a64d1',
            leftValue: "={{ Boolean($json.body?.ok) && Number($json.body?.count || 0) > 0 }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  });

  ensureNode(workflow, {
    id: 'eaef1458-08af-4c48-b2ea-2453b0c6cfd6',
    name: 'Extract Inventory Items',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1568, -896],
    parameters: {},
  });

  replaceConnections(workflow, 'Params', [
    [
      {
        node: 'If Inventory Enabled',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'If Inventory Enabled', [
    [
      {
        node: 'Fetch Worker Inventory',
        type: 'main',
        index: 0,
      },
    ],
    [
      {
        node: 'List Campaigns',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Fetch Worker Inventory', [
    [
      {
        node: 'If Inventory Available',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'If Inventory Available', [
    [
      {
        node: 'Extract Inventory Items',
        type: 'main',
        index: 0,
      },
    ],
    [
      {
        node: 'List Campaigns',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Extract Inventory Items', [
    [
      {
        node: 'Get Ad',
        type: 'main',
        index: 0,
      },
      {
        node: 'Get Creative',
        type: 'main',
        index: 0,
      },
      {
        node: 'Get AdSet',
        type: 'main',
        index: 0,
      },
    ],
  ]);
}

function syncWorkerNodes(workflow) {
  ensureNode(workflow, {
    id: 'b4b1151a-6f44-403a-96f2-3d8d959ca7f7',
    name: 'Limit Campaigns',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1568, -768],
    parameters: {},
  });

  ensureNode(workflow, {
    id: 'eb39e2f1-6fe4-4766-a738-211239e95b0e',
    name: 'Limit Adsets',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1120, -768],
    parameters: {},
  });

  ensureNode(workflow, {
    id: '8bbad428-c23a-4f59-a15a-053e31f670cd',
    name: 'Limit Ads',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-672, -768],
    parameters: {},
  });

  ensureNode(workflow, {
    id: 'a6f5c69d-7b61-4e37-8710-20cc43bb7901',
    name: 'Prepare Worker Persistence',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [0, -384],
    parameters: {},
  });

  ensureNode(workflow, {
    id: '4b6c0c01-d46e-413d-bd85-2ca54cb1dbcc',
    name: 'If Worker Persistence Ready',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [224, -384],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: '14bbf844-d9f1-44d2-bab9-d99bf8d7b09b',
            leftValue: '={{ $json.persistence_ready }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  });

  ensureNode(workflow, {
    id: '85ef9738-3aa6-4b03-92e3-38d93b25c365',
    name: 'Fail Worker Persistence Config',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [448, -496],
    parameters: {},
  });

  ensureNode(workflow, {
    id: '80656339-a2de-415f-a613-7ce177607d7c',
    name: 'Persist to Worker',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [448, -272],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: "={{ $json.persistence_method || 'POST' }}",
      url: '={{ $json.persistence_target_url }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: true,
      specifyHeaders: 'json',
      jsonHeaders: '={{ JSON.stringify($json.requestHeaders || {}) }}',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody || {}) }}',
      options: {
        timeout: '={{ Number($json.requestTimeoutMs || 120000) }}',
        response: {
          response: {
            fullResponse: true,
            neverError: true,
          },
        },
      },
    },
    credentials: {
      httpBearerAuth: workerBearerCredential,
    },
  });

  ensureNode(workflow, {
    id: '8ec086c5-f56d-4eab-9dd0-7c07ea8ea3d2',
    name: 'Validate Worker Persistence',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [672, -272],
    parameters: {},
  });

  replaceConnections(workflow, 'Consolidate Metrics', [
    [
      {
        node: 'Prepare Worker Persistence',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Prepare Worker Persistence', [
    [
      {
        node: 'If Worker Persistence Ready',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'If Worker Persistence Ready', [
    [
      {
        node: 'Persist to Worker',
        type: 'main',
        index: 0,
      },
    ],
    [
      {
        node: 'Fail Worker Persistence Config',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Persist to Worker', [
    [
      {
        node: 'Validate Worker Persistence',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'List Campaigns', [
    [
      {
        node: 'Limit Campaigns',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Limit Campaigns', [
    [
      {
        node: 'Split Out (1)',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'List Adsets', [
    [
      {
        node: 'Limit Adsets',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Limit Adsets', [
    [
      {
        node: 'Split Out (2)',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'List Ads', [
    [
      {
        node: 'Limit Ads',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Limit Ads', [
    [
      {
        node: 'Split Out (3)',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Split Out (3)', [
    [
      {
        node: 'Get Ad',
        type: 'main',
        index: 0,
      },
      {
        node: 'Get Creative',
        type: 'main',
        index: 0,
      },
      {
        node: 'Get AdSet',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Get Ad', [
    [
      {
        node: 'Merge',
        type: 'main',
        index: 0,
      },
    ],
  ]);

  replaceConnections(workflow, 'Get Creative', [
    [
      {
        node: 'Merge',
        type: 'main',
        index: 1,
      },
    ],
  ]);

  replaceConnections(workflow, 'Get AdSet', [
    [
      {
        node: 'Merge',
        type: 'main',
        index: 2,
      },
    ],
  ]);
}

for (const workflowFile of workflowFiles) {
  const raw = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  const workflow = Array.isArray(raw) ? raw[0] : raw;

  syncParamsNode(workflow);
  syncInventoryNodes(workflow);
  [
    'List Campaigns',
    'List Adsets',
    'List Ads',
    'Get Ad',
    'Get Creative',
    'Get AdSet',
    'Get Insights',
  ].forEach((nodeName) => syncMetaHttpNode(workflow, nodeName));
  syncMergeNode(workflow);
  syncWorkerNodes(workflow);

  for (const [nodeName, sourcePath] of Object.entries(nodeSources)) {
    const node = (workflow.nodes || []).find((entry) => entry.name === nodeName);

    if (!node) {
      throw new Error(`Node "${nodeName}" not found in ${workflowFile}`);
    }

    node.parameters = node.parameters || {};
    node.parameters.jsCode = loadSource(sourcePath);
  }

  ['Get Ad', 'Get Creative', 'Get AdSet'].forEach((nodeName) =>
    validateStableHttpFields(workflowFile, workflow, nodeName),
  );

  const output = Array.isArray(raw) ? [workflow] : workflow;
  fs.writeFileSync(workflowFile, JSON.stringify(output, null, 2) + '\n');
  console.log(`Updated ${path.relative(rootDir, workflowFile)}`);
}
