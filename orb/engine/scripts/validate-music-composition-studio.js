#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const dir = path.join(__dirname, '..', 'generated-workflows', 'music-composition-studio');
const archiveDir = path.join(__dirname, '..', 'archived-workflows', 'music-composition-studio');
const errors = [];
const expectedModules = ['MSC-00', 'MSC-10', 'MSC-20', 'MSC-30', 'MSC-40', 'MSC-50', 'MSC-60', 'MSC-70', 'MSC-80', 'MSC-90', 'MSC-99'];
const expectedStages = ['MSC-10 Brief and Reference Analyzer', 'MSC-20 Musical Direction', 'MSC-30 Composition Lab', 'MSC-40 Song Blueprint', 'MSC-50 Stem Factory', 'MSC-60 Vocal Factory', 'MSC-70 Arrangement and Assembly', 'MSC-80 Mix and Master', 'MSC-90 Evaluation and Package'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON ${path.relative(dir, file)}: ${error.message}`);
    return null;
  }
}

function codeNodesAreValid(workflow, label) {
  for (const item of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
    try {
      new AsyncFunction('$input', '$json', item.parameters.jsCode || '');
    } catch (error) {
      errors.push(`invalid code ${label}/${item.name}: ${error.message}`);
    }
  }
}

function validateGraph(workflow) {
  const names = workflow.nodes.map((item) => item.name);
  if (new Set(names).size !== names.length) errors.push('duplicate node name');
  const adjacency = new Map(names.map((name) => [name, []]));
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.includes(source)) errors.push(`missing source ${source}`);
    for (const buckets of Object.values(outputs)) for (const entries of buckets) for (const edge of entries) {
      if (!names.includes(edge.node)) errors.push(`missing target ${edge.node}`);
      else adjacency.get(source)?.push(edge.node);
    }
  }
  const start = 'When Executed by Another Workflow';
  const visited = new Set();
  const visiting = new Set();
  function walk(name) {
    if (visiting.has(name)) {
      errors.push(`cycle detected at ${name}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const target of adjacency.get(name) || []) walk(target);
    visiting.delete(name);
    visited.add(name);
  }
  walk(start);
  for (const name of names) if (!visited.has(name)) errors.push(`unreachable node ${name}`);
}

async function executeCode(workflow, name, item) {
  const target = workflow.nodes.find((node) => node.name === name);
  if (!target) throw new Error(`missing node ${name}`);
  const execute = new AsyncFunction('$input', '$json', target.parameters.jsCode || '');
  const output = await execute({ first: () => ({ json: item }), all: () => [{ json: item }] }, item);
  if (!Array.isArray(output) || output.length !== 1 || !output[0]?.json) throw new Error(`${name} returned an invalid item envelope`);
  return output[0].json;
}

async function validateBehavior(workflow) {
  const tiers = [
    ['FAST', 15, false, 3, 1],
    ['STANDARD', 75, false, 4, 2],
    ['PREMIUM', 120, true, 5, 3],
  ];
  for (const [tier, duration, voice, expectedDna, expectedVariants] of tiers) {
    let item = {
      schema_version: '1.0.0',
      production_id: `MSC-VALIDATOR-${tier}`,
      production_tier: tier,
      dry_run: true,
      brief: { purpose: 'original controlled dry-run', duration_target_seconds: duration, genre_family: ['ambient-pop'], mood: ['warm'], voice_requested: voice, references: [{ reference_id: 'REF-1', kind: 'MIX_REFERENCE', rights_status: 'LICENSED', reference_usage_scope: 'ANALYZE_ONLY', source_uri: 'storage://fixture/ref.wav' }] },
      provider_policy: { mode: 'mock', max_cost: 0, max_jobs: 100, allowed_providers: ['mock'] },
      budget_limits: { max_cost: 0 },
      voice_consent: { status: voice ? 'GRANTED' : 'NOT_REQUIRED', voice_id: voice ? 'synthetic-validator' : 'none' },
    };
    item = await executeCode(workflow, 'Validate controlled input', item);
    for (const stage of expectedStages) item = await executeCode(workflow, stage, item);
    item = await executeCode(workflow, 'Build MUSIC_PACKAGE', item);
    if (item.music_package?.status !== 'READY') errors.push(`${tier} inline behavior did not produce READY`);
    if (item.composition_dna?.length !== expectedDna || item.song_animatics?.length !== expectedDna) errors.push(`${tier} inline behavior produced wrong DNA/animatic count`);
    if (item.arrangement_manifests?.length !== expectedVariants || item.mix_manifests?.length !== expectedVariants) errors.push(`${tier} inline behavior produced wrong arrangement/mix count`);
    if (item.music_package?.deliverables?.stems?.some((uri) => !String(uri).startsWith('storage://'))) errors.push(`${tier} inline behavior leaked non-reference audio`);
    if (item.publish_requested !== false || item.binary_audio_transferred !== false) errors.push(`${tier} inline behavior violated control-plane guard`);
  }
  const handled = await executeCode(workflow, 'MSC-99 Error Handler', { production_id: 'MSC-ERR', error: 'AUTHORIZATION token=secret-value' });
  if (handled.status !== 'FAILED' || handled.error_event?.error_code !== 'AUTHORIZATION_ERROR' || JSON.stringify(handled).includes('secret-value')) errors.push('MSC-99 inline behavior did not classify/redact the error');
}

async function main() {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.json') && file !== 'package.json') : [];
  if (files.length !== 1 || files[0] !== 'music-composition-studio.unified.json') errors.push(`expected one unified operational workflow, found ${files.join(', ') || 'none'}`);
  if (fs.existsSync(path.join(dir, 'archive'))) errors.push('predecessor archive must remain outside the operational package');
  const archiveFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter((file) => file.endsWith('.json')).sort() : [];
  const expectedArchiveFiles = expectedModules.map((code) => `music-composition-studio-${code.toLowerCase()}.json`).sort();
  if (JSON.stringify(archiveFiles) !== JSON.stringify(expectedArchiveFiles)) errors.push(`unexpected archive inventory: ${archiveFiles.join(', ') || 'none'}`);
  const workflow = files.length === 1 ? readJson(path.join(dir, files[0])) : null;
  const packageJson = readJson(path.join(dir, 'package.json'));

  if (workflow) {
    const names = workflow.nodes.map((item) => item.name);
    if (workflow.active !== false) errors.push('unified workflow must be inactive');
    if (workflow.name !== 'Music Composition Studio (Unified)') errors.push('unexpected unified workflow name');
    if (!Array.isArray(packageJson) || packageJson.length !== 1 || JSON.stringify(packageJson[0]) !== JSON.stringify(workflow)) errors.push('package.json must contain exactly the canonical unified workflow');
    if (workflow.nodes.some((item) => /manualTrigger|httpRequest|executeCommand|wait|googleDrive|executeWorkflow$/i.test(item.type))) errors.push('unified workflow contains forbidden operational/subworkflow node');
    if (/Bearer\s+[A-Za-z0-9]|api[_-]?key\s*[:=]\s*["'][^"']+|data:audio\/|["']base64["']/i.test(JSON.stringify(workflow))) errors.push('unified workflow contains secret or binary-audio control-plane candidate');
    for (const required of [...expectedStages, 'MSC-99 Error Handler', 'Build MUSIC_PACKAGE']) if (!names.includes(required)) errors.push(`missing inline stage ${required}`);
    for (const name of ['Validate controlled input', ...expectedStages, 'Build MUSIC_PACKAGE']) {
      const item = workflow.nodes.find((node) => node.name === name);
      if (item?.onError !== 'continueErrorOutput') errors.push(`${name} does not route errors to MSC-99`);
      const errorTarget = workflow.connections?.[name]?.main?.[1]?.[0]?.node;
      if (errorTarget !== 'MSC-99 Error Handler') errors.push(`${name} error output does not target MSC-99`);
    }
    codeNodesAreValid(workflow, 'unified');
    validateGraph(workflow);
    await validateBehavior(workflow);
  }

  for (const [index, file] of archiveFiles.entries()) {
    const archived = readJson(path.join(archiveDir, file));
    if (!archived) continue;
    const expectedModule = expectedArchiveFiles[index].match(/msc-\d+/)[0].toUpperCase();
    if (archived.active !== false || archived.meta?.archived !== true || archived.meta?.archive_descriptor !== true || archived.meta?.operational !== false || archived.meta?.superseded_by !== UNIFIED_ID) errors.push(`invalid archive descriptor ${file}`);
    if (archived.meta?.module !== expectedModule) errors.push(`archive descriptor ${file} has module ${archived.meta?.module}, expected ${expectedModule}`);
    if (archived.nodes.some((item) => /manualTrigger|httpRequest|executeCommand|wait|googleDrive|executeWorkflow$/i.test(item.type))) errors.push(`archive descriptor ${file} contains forbidden node`);
    codeNodesAreValid(archived, file);
  }

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('Music Composition Studio unified workflow validation: OK (1 operational; 11 predecessors archived outside package; FAST/STANDARD/PREMIUM inline behavior; MSC-99 routed; zero subworkflow nodes)');
}

const UNIFIED_ID = 'music-composition-studio-unified';
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
