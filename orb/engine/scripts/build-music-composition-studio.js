#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const STAGES = [
  ['MSC-10', 'Brief and Reference Analyzer', 'REFERENCE_ANALYSIS'],
  ['MSC-20', 'Musical Direction', 'MUSIC_CONSTITUTION'],
  ['MSC-30', 'Composition Lab', 'COMPOSITION_DNA'],
  ['MSC-40', 'Song Blueprint', 'SONG_ANIMATIC'],
  ['MSC-50', 'Stem Factory', 'STEM_MANIFEST'],
  ['MSC-60', 'Vocal Factory', 'VOCAL_MANIFEST'],
  ['MSC-70', 'Arrangement and Assembly', 'ARRANGEMENT_MANIFEST'],
  ['MSC-80', 'Mix and Master', 'MASTER_MANIFEST'],
  ['MSC-90', 'Evaluation and Package', 'MUSIC_PACKAGE'],
  ['MSC-99', 'Error Handler', 'ERROR_POLICY'],
].map(([code, name, output]) => ({ code, name, output }));
const ARCHIVED_MODULES = [{ code: 'MSC-00', name: 'Music Orchestrator', output: 'MUSIC_PRODUCTION_REPORT' }, ...STAGES];
const OUT = process.env.MSC_OUTPUT_DIR ? path.resolve(process.env.MSC_OUTPUT_DIR) : path.join(__dirname, '..', 'generated-workflows', 'music-composition-studio');
const ARCHIVE = path.join(OUT, 'archive');
const UNIFIED_ID = 'music-composition-studio-unified';

function node(id, name, type, position, parameters = {}) { return { id, name, type, typeVersion: type === 'n8n-nodes-base.code' ? 2 : 1.1, position, parameters }; }
function inputValidationCode() { return `const items = $input.all();\nif (!items.length) throw new Error('missing input');\nconst input = items[0].json || {};\nif (input.dry_run !== true || input.provider_policy?.mode !== 'mock') throw new Error('MSC is mock-only until explicitly activated');\nif (!input.production_id) throw new Error('production_id is required');\nreturn [{ json: { ...input, msc_workflow: 'unified', workflow_active: false, binary_audio_transferred: false } }];`; }
function stageCode(stage) { return `const item = $input.first().json || {};\nreturn [{ json: { ...item, msc_module: '${stage.code}', msc_output: '${stage.output}', module_status: 'COMPLETED', binary_audio_transferred: false } }];`; }
function workflow() {
  const trigger = node('msc-unified-trigger', 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', [-760, 0]);
  const validate = node('msc-unified-validate', 'Validate controlled input', 'n8n-nodes-base.code', [-520, 0], { mode: 'runOnceForAllItems', jsCode: inputValidationCode() });
  const nodes = [trigger, validate]; const connections = { [trigger.name]: { main: [[{ node: validate.name, type: 'main', index: 0 }]] } }; let previous = validate.name;
  for (const [index, stage] of STAGES.entries()) {
    const item = node(`msc-unified-${stage.code.toLowerCase()}`, `${stage.code} ${stage.name}`, 'n8n-nodes-base.code', [-240 + index * 260, 0], { mode: 'runOnceForAllItems', jsCode: stageCode(stage) });
    nodes.push(item); connections[previous] = { main: [[{ node: item.name, type: 'main', index: 0 }]] }; previous = item.name;
  }
  const packageNode = node('msc-unified-package', 'Build MUSIC_PACKAGE', 'n8n-nodes-base.code', [2500, 0], { mode: 'runOnceForAllItems', jsCode: `const item = $input.first().json || {}; return [{ json: { ...item, output_type: 'MUSIC_PACKAGE', publish_requested: false, package_status: 'READY_FOR_REVIEW' } }];` });
  nodes.push(packageNode); connections[previous] = { main: [[{ node: packageNode.name, type: 'main', index: 0 }]] };
  return { id: UNIFIED_ID, name: 'Music Composition Studio (Unified)', active: false, settings: { executionOrder: 'v1' }, nodes, connections, pinData: {}, staticData: null, meta: { codex_generated: true, builder: 'build-music-composition-studio.js', architecture: 'unified-inline', active_by_default: false, control_plane_only: true, no_paid_provider_calls: true, archived_predecessors: ARCHIVED_MODULES.map((stage) => stage.code) } };
}
function archiveSnapshot(stage) {
  const trigger = node(`${stage.code.toLowerCase()}-archived-trigger`, 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', [-520, 0]);
  const validate = node(`${stage.code.toLowerCase()}-archived-validate`, 'Validate archived module input', 'n8n-nodes-base.code', [-260, 0], { mode: 'runOnceForAllItems', jsCode: inputValidationCode() });
  const emit = node(`${stage.code.toLowerCase()}-archived-emit`, `Archived ${stage.output}`, 'n8n-nodes-base.code', [0, 0], { mode: 'runOnceForAllItems', jsCode: stageCode(stage) });
  return { id: `music-composition-studio-${stage.code.toLowerCase()}`, name: `${stage.code} ${stage.name} (Archived)`, active: false, settings: { executionOrder: 'v1' }, nodes: [trigger, validate, emit], connections: { [trigger.name]: { main: [[{ node: validate.name, type: 'main', index: 0 }]] }, [validate.name]: { main: [[{ node: emit.name, type: 'main', index: 0 }]] } }, pinData: {}, staticData: null, meta: { codex_generated: true, archived: true, superseded_by: UNIFIED_ID, module: stage.code, rollback_snapshot: true } };
}

fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(ARCHIVE, { recursive: true });
for (const stage of ARCHIVED_MODULES) fs.writeFileSync(path.join(ARCHIVE, `music-composition-studio-${stage.code.toLowerCase()}.json`), `${JSON.stringify(archiveSnapshot(stage), null, 2)}\n`);
// The normalized archive snapshots above preserve the old module identity while
// removing stale operational exports from the top-level import inventory.
for (const stale of fs.readdirSync(OUT).filter((file) => /^music-composition-studio-msc-\d+\.json$/.test(file))) fs.unlinkSync(path.join(OUT, stale));
const unified = workflow(); fs.writeFileSync(path.join(OUT, 'music-composition-studio.unified.json'), `${JSON.stringify(unified, null, 2)}\n`); fs.writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify([unified], null, 2)}\n`);
console.log(`Music Composition Studio unified workflow: OK (1 operational workflow; ${ARCHIVED_MODULES.length} archived predecessor snapshots)`);
