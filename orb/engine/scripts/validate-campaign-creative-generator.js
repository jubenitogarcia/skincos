#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKFLOW_FILE = process.env.CCG_WORKFLOW_FILE
  || path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.full-image-reference-fix.current.json');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
}

function getNode(workflow, nodeName) {
  const node = (workflow.nodes || []).find((item) => item.name === nodeName);
  if (!node) throw new Error(`Node not found: ${nodeName}`);
  return node;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getTargets(workflow, sourceName) {
  const out = [];
  const main = workflow.connections?.[sourceName]?.main || [];
  main.forEach((branch, index) => {
    for (const edge of branch || []) out.push(`${index}:${edge.node}`);
  });
  return out;
}

async function runCodeNode(workflow, nodeName, env = {}) {
  const code = getNode(workflow, nodeName).parameters.jsCode;
  const fn = new AsyncFunction('$input', '$', '$json', '$binary', 'helpers', 'require', code);
  return await fn.call(
    env.thisArg || {},
    env.$input || { first: () => ({ json: {} }), all: () => [{ json: {} }] },
    env.$ || (() => ({ first: () => ({ json: {} }), all: () => [] })),
    env.$json || {},
    env.$binary || {},
    env.helpers || {},
    require,
  );
}

function validateStructure(workflow) {
  const findings = [];
  const names = new Set((workflow.nodes || []).map((node) => node.name));
  const requiredNodes = [
    'Prepare Campaign Inputs',
    'Optimize Campaign Images',
    'Analyze Campaign Images',
    'Merge Image Analyses',
    'Campaign Interpreter',
    'Build Variation Plan',
    'Normalizar Job de Geracao',
    'Build OpenAI Image Request',
    'Tem Referencias Para Edits?',
    'OpenAI Image Generation',
    'OpenAI Image Generation Fallback',
    'Tem B64 Para Binario?',
    'Precisa Revisao Automatizada?',
    'Download Revision Source Image',
    'Build QA Revision Request',
    'OpenAI Image Revision',
    'Normalize Revised OpenAI Image',
    'Tem B64 Revisado?',
    'Build Revised Image Binary',
    'Upload Revised Asset',
    'Revision Asset Result',
    'Relatorio Final da Orquestracao',
  ];

  for (const name of requiredNodes) {
    if (!names.has(name)) findings.push(`Missing required node: ${name}`);
  }

  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) findings.push(`Missing source node: ${source}`);
    for (const buckets of Object.values(outputs || {})) {
      for (const bucket of buckets || []) {
        for (const edge of bucket || []) {
          if (!names.has(edge.node)) findings.push(`Missing target node '${edge.node}' from '${source}'`);
        }
      }
    }
  }

  const expectedEdges = [
    ['Prepare Campaign Inputs', '0:Optimize Campaign Images'],
    ['Optimize Campaign Images', '0:Analyze Campaign Images'],
    ['Analyze Campaign Images', '0:Merge Image Analyses'],
    ['Merge Image Analyses', '0:Campaign Interpreter'],
    ['Build Variation Plan', '0:Normalizar Job de Geracao'],
    ['Build OpenAI Image Request', '0:Tem Referencias Para Edits?'],
    ['Tem Referencias Para Edits?', '0:OpenAI Image Generation'],
    ['Tem Referencias Para Edits?', '1:OpenAI Image Generation Fallback'],
    ['OpenAI Image Generation', '0:Normalize OpenAI Image'],
    ['OpenAI Image Generation Fallback', '0:Normalize OpenAI Image'],
    ['Normalize OpenAI Image', '0:Tem B64 Para Binario?'],
    ['Tem B64 Para Binario?', '0:QA Fallback Sem Imagem'],
    ['Tem B64 Para Binario?', '1:Build Image Binary'],
    ['Finalize QA Status', '0:Precisa Revisao Automatizada?'],
    ['Precisa Revisao Automatizada?', '0:Build Campaign Manifest'],
    ['Precisa Revisao Automatizada?', '1:Download Revision Source Image'],
    ['Download Revision Source Image', '0:Build QA Revision Request'],
    ['Build QA Revision Request', '0:OpenAI Image Revision'],
    ['OpenAI Image Revision', '0:Normalize Revised OpenAI Image'],
    ['Normalize Revised OpenAI Image', '0:Tem B64 Revisado?'],
    ['Tem B64 Revisado?', '0:Build Campaign Manifest'],
    ['Tem B64 Revisado?', '1:Build Revised Image Binary'],
    ['Build Revised Image Binary', '0:Upload Revised Asset'],
    ['Upload Revised Asset', '0:Revision Asset Result'],
    ['Revision Asset Result', '0:Tem Imagem Gerada?'],
  ];

  for (const [source, target] of expectedEdges) {
    if (!getTargets(workflow, source).includes(target)) findings.push(`Missing expected edge: ${source} -> ${target}`);
  }

  for (const node of workflow.nodes || []) {
    const payload = JSON.stringify(node.parameters || {});
    if (/Bearer\s+[A-Za-z0-9]/.test(payload) && !payload.includes('{{$vars.')) {
      findings.push(`Hardcoded bearer token candidate: ${node.name}`);
    }
    if (node.type === 'n8n-nodes-base.code') {
      const code = String(node.parameters?.jsCode || '');
      if (code.includes('process.env') && !code.includes("typeof process !== 'undefined'")) {
        findings.push(`Unguarded process.env in Code node: ${node.name}`);
      }
    }
  }

  return findings;
}

function validateCodeSyntax(workflow) {
  const findings = [];
  for (const node of (workflow.nodes || []).filter((item) => item.type === 'n8n-nodes-base.code')) {
    try {
      new AsyncFunction('$input', '$', '$json', '$binary', 'helpers', node.parameters.jsCode || '');
    } catch (error) {
      findings.push(`Invalid Code node syntax: ${node.name}: ${error.message}`);
    }
  }
  return findings;
}

function validateHttpNodes(workflow) {
  const findings = [];
  const edits = getNode(workflow, 'OpenAI Image Generation');
  const fallback = getNode(workflow, 'OpenAI Image Generation Fallback');
  const revision = getNode(workflow, 'OpenAI Image Revision');
  const editParams = edits.parameters || {};
  const editFields = editParams.bodyParameters?.parameters || [];
  const revisionParams = revision.parameters || {};
  const revisionFields = revisionParams.bodyParameters?.parameters || [];

  if (editParams.url !== 'https://api.openai.com/v1/images/edits') findings.push('OpenAI Image Generation must call /v1/images/edits');
  if (editParams.contentType !== 'multipart-form-data') findings.push('OpenAI Image Generation must use multipart/form-data');
  if (JSON.stringify(editParams).includes('openai_image_request.')) findings.push('OpenAI Image Generation should use openai_image_api_payload fields');
  if (!editFields.some((field) => field.parameterType === 'formBinaryData' && field.name === 'image[]' && field.inputDataFieldName === 'reference_sheet')) {
    findings.push('OpenAI Image Generation must send reference_sheet as image[]');
  }
  if (fallback.parameters?.url !== 'https://api.openai.com/v1/images/generations') findings.push('OpenAI fallback must call /v1/images/generations');
  if (!String(fallback.parameters?.body || '').includes('openai_image_api_payload')) findings.push('OpenAI fallback must use openai_image_api_payload');
  if (String(fallback.parameters?.body || '').includes('openai_image_request')) findings.push('OpenAI fallback must not serialize openai_image_request');
  if (revisionParams.url !== 'https://api.openai.com/v1/images/edits') findings.push('OpenAI Image Revision must call /v1/images/edits');
  if (revisionParams.contentType !== 'multipart-form-data') findings.push('OpenAI Image Revision must use multipart/form-data');
  if (!revisionFields.some((field) => field.parameterType === 'formBinaryData' && field.name === 'image[]' && field.inputDataFieldName === 'current_asset')) {
    findings.push('OpenAI Image Revision must send current_asset as image[]');
  }
  if (revisionFields.some((field) => field.parameterType === 'formBinaryData' && field.inputDataFieldName === 'reference_sheet')) {
    findings.push('OpenAI Image Revision should not send duplicate reference_sheet fallback binary');
  }
  if (JSON.stringify(revisionParams).includes('openai_image_request.')) findings.push('OpenAI Image Revision should use openai_image_api_payload fields');

  const prepareQaBinaryCode = String(getNode(workflow, 'Prepare QA Binary').parameters?.jsCode || '');
  if (prepareQaBinaryCode.includes('$(')) findings.push('Prepare QA Binary must not read other node contexts with $()');
  if (prepareQaBinaryCode.includes('Live Asset Result') || prepareQaBinaryCode.includes('Revision Asset Result')) {
    findings.push('Prepare QA Binary must use the downloaded item directly, not Live/Revision context lookups');
  }
  const finalizeQaStatusCode = String(getNode(workflow, 'Finalize QA Status').parameters?.jsCode || '');
  if (!finalizeQaStatusCode.includes("typeof value.output === 'string'")) {
    findings.push('Finalize QA Status must parse Agent v3 string output');
  }

  return findings;
}

function validateStructuredOutputSchemas(workflow) {
  const findings = [];
  function visit(schema, path) {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object' && schema.additionalProperties !== false) {
      findings.push(`${path} must set additionalProperties=false`);
    }
    for (const [key, value] of Object.entries(schema.properties || {})) {
      visit(value, `${path}.properties.${key}`);
    }
    if (schema.items) visit(schema.items, `${path}.items`);
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(schema[keyword])) {
        schema[keyword].forEach((value, index) => visit(value, `${path}.${keyword}[${index}]`));
      }
    }
  }

  for (const node of workflow.nodes || []) {
    const textOptions = node.parameters?.options?.textFormat?.textOptions;
    if (textOptions?.type !== 'json_schema') continue;
    try {
      visit(JSON.parse(textOptions.schema), `${node.name}.textFormat.schema`);
    } catch (error) {
      findings.push(`${node.name} has invalid textFormat JSON schema: ${error.message}`);
    }
  }

  return findings;
}

async function validateLogic(workflow) {
  const jobs = Array.from({ length: 12 }, (_, index) => ({
    json: {
      campaign_folder: '06',
      output_folder_id: 'DRIVE_OUT',
      asset_id: `asset_${index + 1}`,
      format: ['feed', 'stories', 'square', 'website_banner'][index % 4],
      variation_key: ['hero', 'oferta_principal', 'combo'][index % 3],
      generation_prompt: `Prompt ${index + 1}`,
      size: '1024x1024',
      output_format: 'png',
      planned_job_count: 12,
      planned_assets: Array.from({ length: 12 }, (_, itemIndex) => `asset_${itemIndex + 1}`),
      reference_image_count: 26,
      reference_images: ['a.jpg', 'b.jpg'],
    },
  }));

  const normalized = await runCodeNode(workflow, 'Normalizar Job de Geracao', {
    $input: { all: () => jobs },
  });
  assert(normalized.length === 12, 'Normalizar Job de Geracao must preserve all jobs');
  assert(normalized.every((item) => item.json.generation_status === 'ready'), 'Normalized jobs should be ready with prompt and output folder');

  const referenceSheet = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-validator-')), 'reference-sheet.jpg');
  fs.writeFileSync(referenceSheet, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const helpers = {
    prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: `bytes:${buffer.length}`, fileName, mimeType }),
  };
  const request = await runCodeNode(workflow, 'Build OpenAI Image Request', {
    $input: {
      all: () => [{
        json: {
          ...normalized[0].json,
          reference_sheet_path: referenceSheet,
          reference_image_count: 26,
          reference_images: [{ id: 'img1', name: 'arte.jpg', optimized_local_path: '/tmp/arte.jpg' }],
        },
      }],
    },
    thisArg: { helpers },
  });
  assert(request[0].json.openai_image_endpoint === 'edits', 'Image request should use edits when a reference sheet exists');
  assert(request[0].json.reference_transport === 'contact_sheet_all_optimized_images', 'Image request should record reference transport');
  assert(request[0].binary.reference_sheet, 'Image request should attach reference_sheet binary');
  assert(request[0].json.openai_image_api_payload.prompt.includes('contact sheet JPEG'), 'Image prompt should explain the contact sheet reference');
  assert(!Object.hasOwn(request[0].json.openai_image_api_payload, 'reference_transport'), 'API payload must not include reference_transport');

  const finalize = await runCodeNode(workflow, 'Finalize QA Status', {
    $input: {
      all: () => [{
        json: {
          qa: {
            readability_score: 80,
            offer_consistency: 'pass',
            compliance: 'needs_review',
            format_fit: 'pass',
            visual_consistency: 'pass',
            notes: ['Ajustar disclaimer.'],
          },
        },
      }],
    },
    $: (name) => (name === 'Prepare QA Binary' ? {
      all: () => [{
        json: {
          asset_id: 'asset_1',
          lineage_asset_id: 'asset_1',
          drive_file_id: 'DRIVE_IMAGE',
          file_name: 'asset_1.png',
          revision_attempt: 0,
          max_revision_attempts: 2,
          status: 'generated',
        },
      }],
    } : { first: () => ({ json: {} }), all: () => [] }),
  });
  assert(finalize[0].json.status === 'needs_review', 'Finalize QA should preserve needs_review status');
  assert(finalize[0].json.revision_history.length === 1, 'Finalize QA should append revision history');

  const revision = await runCodeNode(workflow, 'Build QA Revision Request', {
    $input: {
      all: () => [{
        json: {},
        binary: { data: { data: 'bytes', fileName: 'asset_1.png', mimeType: 'image/png' } },
      }],
    },
    $: (name) => (name === 'Finalize QA Status' ? { all: () => finalize } : { first: () => ({ json: {} }), all: () => [] }),
    thisArg: { helpers },
  });
  assert(revision[0].json.revision_attempt === 1, 'Revision request should increment revision_attempt');
  assert(revision[0].json.max_revision_attempts === 2, 'Revision limit should remain 2');
  assert(revision[0].json.openai_image_endpoint === 'edits', 'Revision request should use edits endpoint');
  assert(revision[0].binary.current_asset, 'Revision request should attach current image binary');
  assert(!Object.hasOwn(revision[0].json.openai_image_api_payload, 'reference_transport'), 'Revision API payload must not include reference_transport');

  const finalItems = [
    { json: { asset_id: 'asset_1', format: 'feed', variation_key: 'hero', status: 'approved' } },
    { json: { asset_id: 'asset_2', format: 'feed', variation_key: 'combo', status: 'needs_review' } },
    { json: { asset_id: 'asset_3', format: 'stories', variation_key: 'hero', status: 'failed' } },
  ];
  const report = await runCodeNode(workflow, 'Relatorio Final da Orquestracao', {
    $input: { all: () => finalItems },
    $: () => ({ first: () => ({ json: { campaign_folder: '06' } }), all: () => jobs }),
  });
  assert(report[0].json.planned_jobs === 12, 'Report should expose planned_jobs');
  assert(report[0].json.processed_jobs === 3, 'Report should expose processed_jobs');
  assert(report[0].json.skipped_jobs === 9, 'Report should expose skipped_jobs');
  assert(report[0].json.approved === 1, 'Report should count approved');
  assert(report[0].json.needs_review === 1, 'Report should count needs_review');
  assert(report[0].json.failed === 1, 'Report should count failed');
  assert(report[0].json.by_format.feed.total === 2, 'Report should group by format');
  assert(report[0].json.by_variation.hero.total === 2, 'Report should group by variation');
}

async function main() {
  const workflow = loadWorkflow();
  const findings = [
    ...validateStructure(workflow),
    ...validateCodeSyntax(workflow),
    ...validateHttpNodes(workflow),
    ...validateStructuredOutputSchemas(workflow),
  ];
  if (findings.length) {
    console.error('Validation failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }

  await validateLogic(workflow);
  console.log(`Workflow validation: OK (${WORKFLOW_FILE})`);
  console.log('Structural validation: OK');
  console.log('Code node syntax: OK');
  console.log('OpenAI image routing: OK');
  console.log('Multijob and final report logic: OK');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
