const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const workflowsDir = path.join(rootDir, 'workflows');

const authExpression =
  "={{ (() => { const sources = []; sources.push($json || {}); try { sources.push($('Build Jobs').item.json || {}); } catch (error) {} try { sources.push($('Meta API Params').first().json || {}); } catch (error) {} try { sources.push($('Get row(s) in sheet').first().json || {}); } catch (error) {} for (const source of sources) { const token = String(source.meta_ads_access_token || source.facebook_ads_access_token || source.fb_ads_access_token || source.access_token || source.ad_account_access_token || '').trim(); if (token) return 'Bearer ' + token; } throw new Error('meta_ads_access_token ausente na configuração operacional.'); })() }}";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function updateAuthorizationHeaders(workflow) {
  for (const node of workflow.nodes || []) {
    if (node.type !== 'n8n-nodes-base.httpRequest') continue;
    const params = node.parameters || {};
    const headerParams = params.headerParameters?.parameters;
    if (!Array.isArray(headerParams)) continue;
    for (const header of headerParams) {
      if (String(header?.name || '').toLowerCase() !== 'authorization') continue;
      header.value = authExpression;
    }
  }
}

function normalizeWorkflowSettings(workflow) {
  workflow.settings = {
    executionOrder: 'v1',
    callerPolicy: 'workflowsFromSameOwner',
    availableInMCP: false,
    timezone: 'America/Sao_Paulo',
    timeSavedMode: 'dynamic',
    binaryMode: 'separate',
    ...(workflow.settings || {}),
  };
}

function patchReportBuildJobs(workflow) {
  const node = (workflow.nodes || []).find((item) => item.name === 'Build Jobs');
  if (!node?.parameters?.jsCode) return;

  let code = node.parameters.jsCode;
  if (!code.includes('function resolveMetaAdsAccessToken(destination) {')) {
    code = code.replace(
      "function deepClone(value) {\n  return value == null ? value : JSON.parse(JSON.stringify(value));\n}\n",
      "function deepClone(value) {\n  return value == null ? value : JSON.parse(JSON.stringify(value));\n}\n\nfunction resolveMetaAdsAccessToken(destination) {\n  return safeString(\n    destination.meta_ads_access_token ||\n      destination.facebook_ads_access_token ||\n      destination.fb_ads_access_token ||\n      destination.access_token ||\n      destination.ad_account_access_token\n  );\n}\n",
    );
  }

  code = code.replace(
    "    const destinationApiVersion =\n      safeString(destination.api_version || DEFAULT_API_VERSION) || DEFAULT_API_VERSION;\n",
    "    const destinationApiVersion =\n      safeString(destination.api_version || DEFAULT_API_VERSION) || DEFAULT_API_VERSION;\n    const destinationMetaAdsAccessToken = resolveMetaAdsAccessToken(destination);\n",
  );

  code = code.replace(
    "    if (!destinationAdsetId) warnings.push('adset_id ausente na planilha DESTINOS.');\n",
    "    if (!destinationAdsetId) warnings.push('adset_id ausente na planilha DESTINOS.');\n    if (!destinationMetaAdsAccessToken) warnings.push('meta_ads_access_token ausente na planilha DESTINOS.');\n",
  );

  code = code.replace(
    "        destination_api_version: destinationApiVersion,\n",
    "        destination_api_version: destinationApiVersion,\n        meta_ads_access_token: destinationMetaAdsAccessToken,\n",
  );

  node.parameters.jsCode = code;
}

function patchMetaApiParams(workflow) {
  const node = (workflow.nodes || []).find((item) => item.name === 'Meta API Params');
  if (!node?.parameters?.values?.string) return;

  const entries = node.parameters.values.string;
  const existing = entries.find((item) => item.name === 'meta_ads_access_token');
  const expression = "={{ $json.meta_ads_access_token || $json.facebook_ads_access_token || $json.fb_ads_access_token || $json.access_token || '' }}";

  if (existing) {
    existing.value = expression;
    return;
  }

  entries.push({
    name: 'meta_ads_access_token',
    value: expression,
  });
}

function patchDuplicateBuildJobs(workflow) {
  const node = (workflow.nodes || []).find((item) => item.name === 'Build Jobs');
  if (!node?.parameters?.jsCode) return;

  let code = node.parameters.jsCode;
  if (code.includes("const metaApiParams = $('Meta API Params').first().json || {};")) {
    code = code.replace(
      "const DEST_API_VERSION = metaApiParams.api_version || 'v24.0';\n",
      "const DEST_API_VERSION = metaApiParams.api_version || 'v24.0';\nconst META_ADS_ACCESS_TOKEN = String(metaApiParams.meta_ads_access_token || metaApiParams.facebook_ads_access_token || metaApiParams.fb_ads_access_token || metaApiParams.access_token || '').trim();\n",
    );

    code = code.replace(
      "  if (!destinationAdsetId) warnings.push('destination_adset_id não informado.');\n",
      "  if (!destinationAdsetId) warnings.push('destination_adset_id não informado.');\n  if (!META_ADS_ACCESS_TOKEN) warnings.push('meta_ads_access_token não informado em Meta API Params.');\n",
    );

    code = code.replace(
      "      destination_api_version: DEST_API_VERSION,\n",
      "      destination_api_version: DEST_API_VERSION,\n      meta_ads_access_token: META_ADS_ACCESS_TOKEN,\n",
    );
  }

  node.parameters.jsCode = code;
}

function sanitizeMetaWorkflows() {
  const files = fs
    .readdirSync(workflowsDir)
    .filter((name) => /^meta-ads.*\.json$/.test(name))
    .sort();

  for (const fileName of files) {
    const filePath = path.join(workflowsDir, fileName);
    const workflow = readJson(filePath);
    normalizeWorkflowSettings(workflow);
    updateAuthorizationHeaders(workflow);
    patchReportBuildJobs(workflow);
    patchMetaApiParams(workflow);
    patchDuplicateBuildJobs(workflow);
    writeJson(filePath, workflow);
  }
}

sanitizeMetaWorkflows();
