#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { MODULES } = require('../content-studio-v2/workflow-modules');
const DEFAULT_OUT = path.join(__dirname, '..', 'generated-workflows', 'campaign-creative-generator-v2');
const VERSION = '2.0.0';

function readDeploymentMap() {
  const mapFile = process.env.CCG_WORKFLOW_ID_MAP_FILE;
  if (!mapFile) return {};
  const parsed = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CCG_WORKFLOW_ID_MAP_FILE must contain a JSON object');
  return parsed;
}

const DEPLOYMENT_MAP = readDeploymentMap();
const OUT = process.env.CCG_OUTPUT_DIR ? path.resolve(process.env.CCG_OUTPUT_DIR) : DEFAULT_OUT;
function workflowId(module) { return DEPLOYMENT_MAP[module.code] || module.id; }

function node(id, name, type, position, parameters = {}) { return { id, name, type, typeVersion: type.includes('code') ? 2 : 1.1, position, parameters }; }
function trigger(id) { return node(id, 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', [-760, 0], {}); }
function manualTrigger(id) { return { ...node(id, 'Manual safe dry-run smoke', 'n8n-nodes-base.manualTrigger', [-760, 220], {}), typeVersion: 1 }; }
function code(id, name, position, body) { return node(id, name, 'n8n-nodes-base.code', position, { mode: 'runOnceForAllItems', jsCode: body }); }
function edge(from, to) { return { node: to, type: 'main', index: 0 }; }
function workflow(module, nodes, connections) { return { id: workflowId(module), name: module.name, nodes, connections, active: false, settings: { executionOrder: 'v1', ...(module.code === 'CCG-99' || module.code === 'CCG-00' ? {} : { errorWorkflow: DEPLOYMENT_MAP['CCG-99'] || 'ccg-v2-error-handler' }) }, staticData: null, pinData: {}, meta: { codex_generated: true, builder_version: VERSION, module: module.code, architecture: module.code === 'CCG-00' ? 'unified-inline' : 'standalone-module', no_publication: true } }; }
function smokeFixtureCode() { return `return [{ json: { schema_version: '1.0.0', production_id: 'n8n-safe-smoke', content_id: 'n8n-safe-smoke-content', campaign_id: 'n8n-safe-smoke-campaign', content_type: 'STATIC_SINGLE', production_tier: 'FAST', objective: 'validar o contrato sem efeitos externos', funnel_stage: 'consideration', audience: { segment: 'fixture' }, procedure_or_topic: 'cuidados faciais', offer: {}, cta: 'Saiba mais', requested_deliverables: [{ deliverable_id: 'fixture-1', format: '9:16', usage: 'ORGANIC' }], source_assets: [], brand_assets: [], references: [], mandatory_elements: [], forbidden_elements: ['promessa garantida'], provider_policy: { mode: 'mock', mock_provider: true, allowed_providers: ['mock'], max_cost: 0, max_jobs: 1, max_revisions: 0 }, budget: { max_cost: 0 }, dry_run: true, organizer_context: { fixture: true, n8n_manual_smoke: true } } }];`; }
function stageCode(module) { return `const input = $input.all().map((item) => item.json || {});\nif (!input.length) throw new Error('missing workflow input');\nconst first = input[0];\nlet request = first;\nif (typeof first.production_request === 'string') { try { request = JSON.parse(first.production_request); } catch (error) { throw new Error('production_request must be valid JSON'); } } else if (first.production_request && typeof first.production_request === 'object') request = first.production_request;\nif ('${module.code}' !== 'CCG-99') { const required = ['schema_version', 'production_id', 'content_id', 'campaign_id', 'content_type', 'production_tier', 'objective', 'cta', 'provider_policy', 'dry_run']; const missing = required.filter((key) => request[key] === undefined || request[key] === null || request[key] === ''); if (missing.length) throw new Error('contract validation failed: ' + missing.join(',')); if (!['STATIC_SINGLE', 'CAROUSEL', 'SHORT_VIDEO', 'HYBRID'].includes(request.content_type)) throw new Error('contract validation failed: content_type'); if (!['FAST', 'STANDARD', 'PREMIUM'].includes(request.production_tier)) throw new Error('contract validation failed: production_tier'); }\nif (request.dry_run !== true && request.provider_policy && request.provider_policy.mode === 'mock') throw new Error('provider policy mismatch');\nreturn [{ json: { ...first, ...request, ccg_module: '${module.code}', ccg_builder_version: '${VERSION}', ccg_contract_validation: 'strict-required-fields', dry_run: Boolean(request.dry_run) } }];`; }
function buildModule(module) {
  const t = trigger(`${module.code.toLowerCase()}-trigger`);
  const validate = code(`${module.code.toLowerCase()}-validate`, 'Validate contract input', [-520, 0], stageCode(module));
  const result = code(`${module.code.toLowerCase()}-result`, 'Return module result', [0, 0], `const item = $input.first().json || {}; return [{ json: { ...item, module_status: 'DONE', module_output: '${module.output}' } }];`);
  const nodes = [t, validate, result];
  const connections = { [t.name]: { main: [[edge(t.name, validate.name)]] }, [validate.name]: { main: [[edge(validate.name, result.name)]] } };
  if (module.code === 'CCG-00') {
    const smokeTrigger = manualTrigger(`${module.code.toLowerCase()}-manual-smoke`);
    const smokeFixture = code(`${module.code.toLowerCase()}-smoke-fixture`, 'Build safe dry-run fixture', [-520, 220], smokeFixtureCode());
    nodes.push(smokeTrigger, smokeFixture);
    connections[smokeTrigger.name] = { main: [[edge(smokeTrigger.name, smokeFixture.name)]] };
    connections[smokeFixture.name] = { main: [[edge(smokeFixture.name, validate.name)]] };
    let previous = result.name;
    const stages = MODULES.filter((candidate) => candidate.code !== 'CCG-00' && candidate.code !== 'CCG-99');
    for (const [index, candidate] of stages.entries()) {
      const x = 260 + index * 440;
      const stageValidate = code(`${module.code.toLowerCase()}-${candidate.code.toLowerCase()}-validate`, `${candidate.code} Validate contract`, [x, 0], stageCode(candidate));
      const stageResult = code(`${module.code.toLowerCase()}-${candidate.code.toLowerCase()}-result`, `${candidate.code} Return result`, [x + 220, 0], `const item = $input.first().json || {}; return [{ json: { ...item, module_status: 'DONE', module_output: '${candidate.output}', ccg_module: '${candidate.code}' } }];`);
      nodes.push(stageValidate, stageResult);
      connections[previous] = { main: [[edge(previous, stageValidate.name)]] };
      connections[stageValidate.name] = { main: [[edge(stageValidate.name, stageResult.name)]] };
      previous = stageResult.name;
    }
    const packageNode = code(`${module.code.toLowerCase()}-package`, 'Build CONTENT_PACKAGE', [260 + stages.length * 440, 0], `const item = $input.first().json || {}; return [{ json: { ...item, status: item.status || 'NEEDS_REVIEW', output_type: 'CONTENT_PACKAGE', posting_payload: { publish_requested: false } } }];`);
    const errorPolicyNode = code(`${module.code.toLowerCase()}-error-policy`, 'CCG-99 Native error policy', [480 + stages.length * 440, 0], `const item = $input.first().json || {}; return [{ json: { ...item, error_handling: 'native-workflow-execution', external_error_workflow: false } }];`);
    nodes.push(packageNode); connections[previous] = { main: [[edge(previous, packageNode.name)]] };
    nodes.push(errorPolicyNode); connections[packageNode.name] = { main: [[edge(packageNode.name, errorPolicyNode.name)]] };
  }
  return workflow(module, nodes, connections);
}
function main() { fs.mkdirSync(OUT, { recursive: true }); const pack = MODULES.map(buildModule); for (const item of pack) fs.writeFileSync(path.join(OUT, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`); fs.writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify(pack, null, 2)}\n`); console.log(`Wrote ${pack.length} CCG v2 workflows to ${OUT}${Object.keys(DEPLOYMENT_MAP).length ? ' using a deployment ID map' : ''}`); }
main();
