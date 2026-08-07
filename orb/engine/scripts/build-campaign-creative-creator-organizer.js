#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ORGANIZER_ID = 'ccg-orchestrator-001';
const ORGANIZER_NAME = 'Campaign Creative Creator Organizer';
const CREATOR_WORKFLOW_ID = 'TxE9eMS1xfE6kq38';
const CCG_ERROR_WORKFLOW_ID = '9j7WMFTNVNYmNZHC';
const BUILDER_VERSION = '1.0.4';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--input', '--output', '--creator-workflow-id', '--error-workflow-id'].includes(arg)) {
      const key = {
        '--input': 'input',
        '--output': 'output',
        '--creator-workflow-id': 'creatorWorkflowId',
        '--error-workflow-id': 'errorWorkflowId',
      }[arg];
      result[key] = argv[++index];
    }
  }
  return result;
}

function workflowNode(id, name, type, typeVersion, position, parameters) {
  return { id, name, type, typeVersion, position, parameters };
}

function assertSafeId(id, label) {
  if (!id || id.length > 36 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`${label} must contain only letters, numbers, hyphens, or underscores and be at most 36 characters`);
  }
}

function buildRequestCode() {
  return String.raw`
const input = $input.first()?.json || {};
const value = (candidate, fallback = '') => candidate === undefined || candidate === null ? fallback : String(candidate).trim();
const list = (candidate, fallback = []) => {
  if (Array.isArray(candidate)) return candidate;
  if (typeof candidate === 'string' && candidate.trim()) {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {}
  }
  return fallback;
};
const object = (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
const supplied = object(input.production_request);
const executionId = value(typeof $execution !== 'undefined' && $execution.id, 'manual');
const now = new Date().toISOString();
const requestedMaxJobs = Number(input.max_jobs);
// The safe static smoke uses three approved URI assets plus one composition job.
const defaultMaxJobs = Number.isFinite(requestedMaxJobs) && requestedMaxJobs > 0
  ? Math.floor(requestedMaxJobs)
  : 4;
const productionId = value(supplied.production_id, 'organizer-production-' + executionId);
const contentId = value(supplied.content_id, 'organizer-content-' + executionId);
const campaignId = value(supplied.campaign_id, 'organizer-campaign');
const deliverables = list(supplied.requested_deliverables, [{
  deliverable_id: contentId + '-static',
  content_mode: 'STATIC_SINGLE',
  format: '9:16',
  usage: 'ORGANIC',
}]);
const request = Object.keys(supplied).length
  ? {
      ...supplied,
      production_id: productionId,
      content_id: contentId,
      campaign_id: campaignId,
      requested_deliverables: deliverables,
      dry_run: supplied.dry_run === undefined ? true : supplied.dry_run,
      provider_policy: {
        ...object(supplied.provider_policy),
        require_human_approval: true,
        publish_allowed: false,
        publish_requested: false,
      },
      organizer_context: {
        ...object(supplied.organizer_context),
        source: 'ccg-orchestrator-001',
        execution_id: executionId,
      },
    }
  : {
      schema_version: '1.0.0',
      production_id: productionId,
      content_id: contentId,
      campaign_id: campaignId,
      content_type: value(input.content_type, 'STATIC_SINGLE').toUpperCase(),
      production_tier: 'FAST',
      objective: 'Validar a entrada operacional do Campaign Creative Creator sem efeitos externos.',
      funnel_stage: 'consideration',
      audience: { segment: 'organizer-default', location: 'Brasil' },
      procedure_or_topic: 'cuidados faciais',
      offer: {},
      cta: 'Saiba mais',
      requested_deliverables: deliverables,
      // The default operational smoke must be a valid closed-world request.
      // These are synthetic, non-personal mock references with explicit
      // approval/ownership metadata; they never become live provider inputs.
      source_assets: list(input.source_assets).length ? list(input.source_assets) : [
        {
          asset_id: 'organizer-mock-hero-v1',
          role: 'hero_visual',
          asset_type: 'IMAGE',
          file_name: 'organizer-mock-hero.svg',
          mime_type: 'image/svg+xml',
          url: 'mock://approved-assets/organizer-mock-hero-v1.svg',
          approval_status: 'approved',
          rights_status: 'owned',
          contains_personal_data: false,
          width: 1080,
          height: 1440,
          size_bytes: 1024,
          sha256: '1111111111111111111111111111111111111111111111111111111111111111'
        },
        {
          asset_id: 'organizer-mock-background-v1',
          role: 'supporting_background',
          asset_type: 'IMAGE',
          file_name: 'organizer-mock-background.svg',
          mime_type: 'image/svg+xml',
          url: 'mock://approved-assets/organizer-mock-background-v1.svg',
          approval_status: 'approved',
          rights_status: 'owned',
          contains_personal_data: false,
          width: 1080,
          height: 1920,
          size_bytes: 1024,
          sha256: '2222222222222222222222222222222222222222222222222222222222222222'
        }
      ],
      brand_assets: list(input.brand_assets).length ? list(input.brand_assets) : [
        {
          asset_id: 'organizer-mock-brand-logo-v1',
          role: 'brand_logo',
          asset_type: 'LOGO',
          file_name: 'organizer-mock-brand-logo.svg',
          mime_type: 'image/svg+xml',
          url: 'mock://approved-assets/organizer-mock-brand-logo-v1.svg',
          approval_status: 'approved',
          rights_status: 'owned',
          contains_personal_data: false,
          width: 640,
          height: 160,
          size_bytes: 1024,
          sha256: '3333333333333333333333333333333333333333333333333333333333333333'
        }
      ],
      references: list(input.references),
      mandatory_elements: ['CTA legível'],
      forbidden_elements: ['Promessa garantida', 'Antes e depois'],
      provider_policy: {
        mode: 'mock',
        mock_provider: true,
        allowed_providers: ['mock'],
        max_cost: 0,
        max_jobs: defaultMaxJobs,
        max_revisions: 0,
        require_human_approval: true,
        publish_allowed: false,
        publish_requested: false,
      },
      budget: { currency: 'BRL', max_cost: 0 },
      dry_run: true,
      brand_context: { brand_name: 'Espaço Facial', locale: 'pt-BR', country: 'BR', compliance_profile: 'SKINCOS_AESTHETICS_BR_V1' },
      organizer_context: { source: 'ccg-orchestrator-001', execution_id: executionId, requested_at: now },
    };
request.publish_allowed = false;
request.publish_requested = false;
request.run_id = value(request.run_id, 'run-' + executionId);
request.idempotency_key = value(request.idempotency_key, 'ccg:' + campaignId + ':' + contentId + ':' + executionId);
return [{ json: { production_request: request, organizer_request: { creator_workflow_id: 'TxE9eMS1xfE6kq38', mode: request.dry_run ? 'DRY_RUN' : 'LIVE', created_at: now } } }];
`;
}

function buildReturnCode() {
  return String.raw`
const item = $input.first();
const data = item?.json || {};
const packageValue = data.content_package || data.module_outputs?.CCG_90?.content_package;
if (!packageValue) throw new Error('[CCG-Organizer/OUTPUT] Campaign Creative Creator não retornou CONTENT_PACKAGE.');
return [{
  json: {
    ...data,
    output_type: 'CONTENT_PACKAGE',
    organizer_result: {
      status: data.status || data.module_status || 'DONE',
      package_id: packageValue.package_id,
      package_status: packageValue.package_status,
      run_id: data.ccg_context?.run_id || data.production_request?.run_id,
      idempotency_key: data.ccg_context?.idempotency_key || data.production_request?.idempotency_key,
    },
    posting_payload: { publish_requested: false, publish_allowed: false, published: false },
  },
  binary: item?.binary,
}];
`;
}

function buildOrganizer(source, options = {}) {
  if (!source || source.id !== ORGANIZER_ID) throw new Error(`Unexpected Organizer workflow id: ${source?.id || 'missing'}`);
  const creatorWorkflowId = options.creatorWorkflowId || CREATOR_WORKFLOW_ID;
  const errorWorkflowId = options.errorWorkflowId || CCG_ERROR_WORKFLOW_ID;
  assertSafeId(creatorWorkflowId, 'creator workflow id');
  assertSafeId(errorWorkflowId, 'error workflow id');
  if (errorWorkflowId === ORGANIZER_ID) throw new Error('Organizer must not use itself as its error workflow');
  const nodes = [
    workflowNode('ccg-organizer-manual', "When clicking 'Execute workflow'", 'n8n-nodes-base.manualTrigger', 1, [-720, 0], {}),
    // Prefer the native subworkflow trigger for operational calls. This keeps
    // the Organizer private (no webhook) while allowing n8n to retain
    // integrated execution semantics and route real failures to CCG-99.
    workflowNode('ccg-organizer-operational', 'Operational Campaign Request', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [-720, 180], {
      inputSource: 'passthrough',
    }),
    workflowNode('ccg-organizer-config', 'Organizer Safe Defaults', 'n8n-nodes-base.set', 3.4, [-480, 0], {
      assignments: {
        assignments: [
          { id: 'ccg-organizer-content-type', name: 'content_type', value: 'STATIC_SINGLE', type: 'string' },
          { id: 'ccg-organizer-dry-run', name: 'dry_run', value: true, type: 'boolean' },
          { id: 'ccg-organizer-max-jobs', name: 'max_jobs', value: 4, type: 'number' },
        ],
      },
      options: {},
    }),
    workflowNode('ccg-organizer-request', 'Build CCG Operational Request', 'n8n-nodes-base.code', 2, [-240, 0], { jsCode: buildRequestCode() }),
    workflowNode('ccg-organizer-execute', 'Execute Campaign Creative Creator', 'n8n-nodes-base.executeWorkflow', 1.2, [0, 0], {
      source: 'database',
      workflowId: { __rl: true, value: creatorWorkflowId, mode: 'id' },
      mode: 'once',
      options: { waitForSubWorkflow: true },
    }),
    workflowNode('ccg-organizer-return', 'Return CCG Content Package', 'n8n-nodes-base.code', 2, [240, 0], { jsCode: buildReturnCode() }),
  ];
  const output = {
    id: ORGANIZER_ID,
    name: ORGANIZER_NAME,
    active: false,
    nodes,
    connections: {
      [nodes[0].name]: { main: [[{ node: nodes[2].name, type: 'main', index: 0 }]] },
      [nodes[1].name]: { main: [[{ node: nodes[2].name, type: 'main', index: 0 }]] },
      [nodes[2].name]: { main: [[{ node: nodes[3].name, type: 'main', index: 0 }]] },
      [nodes[3].name]: { main: [[{ node: nodes[4].name, type: 'main', index: 0 }]] },
      [nodes[4].name]: { main: [[{ node: nodes[5].name, type: 'main', index: 0 }]] },
    },
    // n8n propagates an integrated child failure to the top-level Organizer.
    // Attach CCG-99 here as well as on the Creator so a technical failure is
    // recoverable regardless of which execution n8n persists as the root.
    settings: { ...(source.settings || {}), availableInMCP: false, errorWorkflow: errorWorkflowId },
    staticData: null,
    pinData: {},
    meta: {
      codex_generated: true,
      codex_builder: 'build-campaign-creative-creator-organizer',
      codex_builder_version: BUILDER_VERSION,
      source_workflow_id: ORGANIZER_ID,
      creator_workflow_id: creatorWorkflowId,
      error_workflow_id: errorWorkflowId,
      architecture: 'n8n-organizer-to-campaign-creative-creator-operational-entry',
      operational_entry: 'executeWorkflowTrigger',
      no_publication: true,
      publish_allowed: false,
      publish_requested: false,
      no_public_webhook: true,
      credentials_stripped_for_git: true,
    },
  };
  for (const node of output.nodes) assertSafeId(node.id, `node id for ${node.name}`);
  return output;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) throw new Error('Usage: build-campaign-creative-creator-organizer.js --input <workflow-export.json> --output <candidate.json> [--creator-workflow-id <id>] [--error-workflow-id <id>]');
  const parsed = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8').replace(/^\uFEFF/, ''));
  const source = Array.isArray(parsed) ? parsed.find((candidate) => candidate?.id === ORGANIZER_ID) : parsed;
  const output = buildOrganizer(source, {
    creatorWorkflowId: args.creatorWorkflowId,
    errorWorkflowId: args.errorWorkflowId,
  });
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Built inactive Campaign Creative Creator Organizer: ${args.output} (${output.nodes.length} nodes)\n`);
}

if (require.main === module) main();

module.exports = {
  BUILDER_VERSION,
  CREATOR_WORKFLOW_ID,
  CCG_ERROR_WORKFLOW_ID,
  ORGANIZER_ID,
  ORGANIZER_NAME,
  buildOrganizer,
};
