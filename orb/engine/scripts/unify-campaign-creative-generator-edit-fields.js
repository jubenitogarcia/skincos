#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.unified.before-edit-fields-unification.20260601.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.unified.edit-fields-unified.json');

const REMOVED_EDIT_FIELDS = [
  'Configuracao Fase 1',
  'Configuracao Fase 2',
  'Configuracao Fase 3',
  'Configuracao Fase 4',
];

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
}

function writeWorkflow(workflow) {
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = (workflow.nodes || []).find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function removeNode(workflow, name) {
  workflow.nodes = (workflow.nodes || []).filter((node) => node.name !== name);
  delete workflow.connections[name];
  for (const outputs of Object.values(workflow.connections || {})) {
    for (const outputType of Object.keys(outputs || {})) {
      outputs[outputType] = (outputs[outputType] || []).map((bucket) =>
        (bucket || []).filter((edge) => edge.node !== name),
      );
    }
  }
}

function ensureConnection(workflow, from, to, outputType = 'main', outputIndex = 0, inputIndex = 0) {
  if (!workflow.connections[from]) workflow.connections[from] = {};
  if (!workflow.connections[from][outputType]) workflow.connections[from][outputType] = [];
  while (workflow.connections[from][outputType].length <= outputIndex) {
    workflow.connections[from][outputType].push([]);
  }
  const bucket = workflow.connections[from][outputType][outputIndex];
  if (!bucket.some((edge) => edge.node === to && edge.type === outputType && edge.index === inputIndex)) {
    bucket.push({ node: to, type: outputType, index: inputIndex });
  }
}

function setConfigNode(node) {
  node.parameters = {
    keepOnlySet: true,
    values: {
      string: [
        { name: 'campaign_name', value: 'Campanha Maio' },
        { name: 'source_drive_folder_id', value: 'google-drive-folder-id' },
        { name: 'output_drive_folder_id', value: 'google-drive-folder-id' },
        { name: 'execution_mode', value: 'dry_run' },
        { name: 'requested_formats', value: '["feed_3x4","stories_9x16","square_1x1","website_banner","horizontal_ad"]' },
        { name: 'variation_mode', value: 'auto_all' },
        { name: 'image_model', value: 'gpt-image-2' },
        { name: 'fallback_image_models', value: 'gpt-image-1.5,gpt-image-1' },
        { name: 'brand', value: 'Espaco Facial' },
        { name: 'compliance_note', value: 'Avaliacao individual. Resultados variam.' },
      ],
      number: [
        { name: 'max_variations_per_format', value: 6 },
        { name: 'max_jobs_total', value: 30 },
        { name: 'max_source_files', value: 40 },
        { name: 'max_image_references', value: 8 },
        { name: 'max_pdf_chars', value: 12000 },
      ],
    },
    options: {},
  };
}

function replaceCodeRefs(workflow) {
  const prepareInputs = getNode(workflow, 'Prepare Campaign Inputs');
  prepareInputs.parameters.jsCode = String(prepareInputs.parameters.jsCode || '').replace(
    "const cfg = $('Configuracao Fase 1').first().json || {};",
    "const cfg = $('Preparar Orquestracao').first().json || $('Configuracao Inicial').first().json || {};",
  );

  const normalizeJob = getNode(workflow, 'Normalizar Job de Geracao');
  normalizeJob.parameters.jsCode = String(normalizeJob.parameters.jsCode || '').replace(
    "const cfg = $('Configuracao Fase 3').first().json || {};",
    "const cfg = $('Preparar Orquestracao').first().json || $('Configuracao Inicial').first().json || {};",
  );
}

function rewire(workflow) {
  for (const name of REMOVED_EDIT_FIELDS) removeNode(workflow, name);

  ensureConnection(workflow, 'Preparar Orquestracao', 'Search Campaign Files');
  ensureConnection(workflow, 'Normalize Campaign Brief', 'Normalizar Brief');
  ensureConnection(workflow, 'Build Variation Plan', 'Normalizar Job de Geracao');
  ensureConnection(workflow, 'Live Asset Result', 'Normalizar Resultado Gerado');
}

function validate(workflow) {
  const names = new Set((workflow.nodes || []).map((node) => node.name));
  const findings = [];
  const setNodes = (workflow.nodes || []).filter((node) => node.type === 'n8n-nodes-base.set').map((node) => node.name);
  if (setNodes.length !== 1 || setNodes[0] !== 'Configuracao Inicial') {
    findings.push(`Expected only Configuracao Inicial as Edit Fields node; got ${setNodes.join(', ')}`);
  }
  for (const removed of REMOVED_EDIT_FIELDS) {
    if (names.has(removed)) findings.push(`Removed node still present: ${removed}`);
  }
  const serialized = JSON.stringify(workflow);
  for (const removed of REMOVED_EDIT_FIELDS) {
    if (serialized.includes(removed)) findings.push(`Reference still present: ${removed}`);
  }
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) findings.push(`Missing source node '${source}'`);
    for (const buckets of Object.values(outputs || {})) {
      for (const bucket of buckets || []) {
        for (const edge of bucket || []) {
          if (!names.has(edge.node)) findings.push(`Missing target node '${edge.node}' from '${source}'`);
        }
      }
    }
  }
  if (findings.length) throw new Error(findings.join('\n'));
}

function main() {
  const workflow = loadWorkflow();
  setConfigNode(getNode(workflow, 'Configuracao Inicial'));
  replaceCodeRefs(workflow);
  rewire(workflow);
  workflow.meta = {
    ...(workflow.meta || {}),
    codex_edit_fields_unified_at: new Date().toISOString(),
    codex_edit_fields_unified_from: path.basename(INPUT_FILE),
  };
  validate(workflow);
  writeWorkflow(workflow);
  console.log(`Wrote unified Edit Fields workflow to ${OUTPUT_FILE}`);
}

main();
