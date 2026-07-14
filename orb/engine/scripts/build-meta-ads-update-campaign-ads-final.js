#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const SOURCE_FILE = process.env.META_ADS_CAMPAIGN_SOURCE_FILE
    || path.join(os.homedir(), 'Downloads', 'n8n_redesenho_final_fases123.json');
const OUTPUT_DIR = process.env.META_ADS_CAMPAIGN_OUTPUT_DIR || runtimePaths.workflowsDir;

function ensureConnectionsNode(wf, from, outputIndex = 0) {
    if (!wf.connections) wf.connections = {};
    if (!wf.connections[from]) wf.connections[from] = { main: [] };
    if (!wf.connections[from].main) wf.connections[from].main = [];
    while (wf.connections[from].main.length <= outputIndex) {
        wf.connections[from].main.push([]);
    }
}

function removeConnection(wf, from, to) {
    if (!wf.connections || !wf.connections[from] || !Array.isArray(wf.connections[from].main)) return;
    wf.connections[from].main = wf.connections[from].main.map((bucket) =>
        Array.isArray(bucket) ? bucket.filter((edge) => edge && edge.node !== to) : bucket,
    );
}

function connect(wf, from, to, outputIndex = 0, inputIndex = 0) {
    ensureConnectionsNode(wf, from, outputIndex);
    const bucket = wf.connections[from].main[outputIndex];
    if (!bucket.some((edge) => edge && edge.node === to && edge.index === inputIndex && edge.type === 'main')) {
        bucket.push({ node: to, type: 'main', index: inputIndex });
    }
}

function getNode(wf, name) {
    const node = (wf.nodes || []).find((n) => n.name === name);
    if (!node) throw new Error(`Node not found: ${name} in workflow ${wf.name}`);
    return node;
}

function upsertNode(wf, node) {
    const idx = (wf.nodes || []).findIndex((n) => n.id === node.id || n.name === node.name);
    if (idx >= 0) {
        wf.nodes[idx] = node;
    } else {
        wf.nodes.push(node);
    }
}

function parseArrayFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function addExecuteTrigger(wf, position, connectTo) {
    const node = {
        parameters: {},
        id: `exec-trigger-${wf.id}`,
        name: 'When Executed by Another Workflow',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position,
    };
    upsertNode(wf, node);
    connect(wf, node.name, connectTo, 0, 0);
}

function makeModeSwitchNode(id, name, position, leftExpression) {
    return {
        parameters: {
            rules: {
                values: [
                    {
                        conditions: {
                            options: {
                                caseSensitive: true,
                                leftValue: '',
                                typeValidation: 'strict',
                                version: 3,
                            },
                            conditions: [
                                {
                                    id: `${id}-dry-run`,
                                    leftValue: leftExpression,
                                    rightValue: 'dry_run',
                                    operator: {
                                        type: 'string',
                                        operation: 'equals',
                                        name: 'filter.operator.equals',
                                    },
                                },
                            ],
                            combinator: 'and',
                        },
                        renameOutput: true,
                        outputKey: 'DryRun',
                    },
                    {
                        conditions: {
                            options: {
                                caseSensitive: true,
                                leftValue: '',
                                typeValidation: 'strict',
                                version: 3,
                            },
                            conditions: [
                                {
                                    id: `${id}-live`,
                                    leftValue: leftExpression,
                                    rightValue: 'live',
                                    operator: {
                                        type: 'string',
                                        operation: 'equals',
                                        name: 'filter.operator.equals',
                                    },
                                },
                            ],
                            combinator: 'and',
                        },
                        renameOutput: true,
                        outputKey: 'Live',
                    },
                ],
            },
            options: {},
        },
        id,
        name,
        type: 'n8n-nodes-base.switch',
        typeVersion: 3.4,
        position,
    };
}

function buildOrchestrator(wf) {
    wf.name = '00 - Orquestrador - Meta Ads Update Campaign Ads (Final)';

    const cfg = getNode(wf, 'Configuração Inicial');
    cfg.parameters.keepOnlySet = true;
    cfg.parameters.values = {
        string: [
            { name: 'project_name', value: 'Meta Ads Automation v2' },
            { name: 'execution_mode', value: 'dry_run' },
            { name: 'phase_1_workflow_id', value: '088e1c1a-3b75-4a0b-b277-30c213aef187' },
            { name: 'phase_2_workflow_id', value: '6db4dea0-5f1f-41cd-853c-c64ff2fdb634' },
            { name: 'phase_3_workflow_id', value: 'a556d69c-fe70-4a20-855c-131482253ad9' },
            { name: 'notes', value: 'Atualize os IDs das fases se n8n gerar novos IDs no import.' },
        ],
    };

    const code1 = getNode(wf, 'TODO - Disparar Fase 1');
    code1.name = 'Preparar Orquestração';
    code1.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
const cfg = $('Configuração Inicial').first().json || {};
return [{
  json: {
    project_name: safeString(cfg.project_name) || 'Meta Ads Automation v2',
    execution_mode: safeString(cfg.execution_mode).toLowerCase() || 'dry_run',
    phase_1_workflow_id: safeString(cfg.phase_1_workflow_id),
    phase_2_workflow_id: safeString(cfg.phase_2_workflow_id),
    phase_3_workflow_id: safeString(cfg.phase_3_workflow_id),
    started_at: new Date().toISOString(),
  },
}];
`;

    const code2 = getNode(wf, 'TODO - Disparar Fase 2');
    code2.name = 'Filtrar Plans Preparados';
    code2.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
const input = $input.all().map((item) => item.json || {});
const prepared = input.filter((item) => safeString(item.eligibility_status) === 'prepared');
if (!prepared.length) {
  return [{
    json: {
      orchestration_status: 'no_prepared_jobs',
      message: 'Nenhum execution plan preparado retornado pela Fase 1.',
      prepared_count: 0,
      blocked_count: input.filter((item) => safeString(item.eligibility_status) === 'blocked').length,
      generated_at: new Date().toISOString(),
    },
  }];
}
return prepared.map((plan) => ({
  json: {
    ...plan,
    execution_mode: safeString(plan.execution_mode || $('Configuração Inicial').first().json.execution_mode || 'dry_run').toLowerCase(),
    orchestrated_at: new Date().toISOString(),
  },
}));
`;

    const code3 = getNode(wf, 'TODO - Disparar Fase 3');
    code3.name = 'Relatório Final da Orquestração';
    code3.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
const results = $input.all().map((item) => item.json || {});
const summary = {
  total_results: results.length,
  completed: results.filter((r) => safeString(r.final_status) === 'completed').length,
  completed_with_warnings: results.filter((r) => safeString(r.final_status) === 'completed_with_warnings').length,
  manual_review_required: results.filter((r) => Boolean(r.manual_review_required)).length,
  failed: results.filter((r) => safeString(r.final_status) === 'failed').length,
};
return [{
  json: {
    project_name: $('Configuração Inicial').first().json.project_name,
    execution_mode: $('Configuração Inicial').first().json.execution_mode,
    orchestration_finished_at: new Date().toISOString(),
    summary,
    results,
  },
}];
`;

    const executeFase1 = {
        parameters: {
            source: 'database',
            workflowId: {
                __rl: true,
                value: '={{ $("Configuração Inicial").first().json.phase_1_workflow_id }}',
                mode: 'id',
            },
            workflowInputs: {
                mappingMode: 'defineBelow',
                value: {
                    execution_mode: '={{ $("Configuração Inicial").first().json.execution_mode }}',
                },
                matchingColumns: ['execution_mode'],
                schema: [
                    {
                        id: 'execution_mode',
                        displayName: 'execution_mode',
                        required: false,
                        defaultMatch: false,
                        display: true,
                        canBeUsedToMatch: true,
                        removed: false,
                    },
                ],
                attemptToConvertTypes: false,
                convertFieldsToString: false,
            },
            mode: 'once',
            options: {
                waitForSubWorkflow: true,
            },
        },
        id: 'exec-fase1-final',
        name: 'Execute Fase 1',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [-40, -20],
    };

    const executeFase2 = {
        parameters: {
            source: 'database',
            workflowId: {
                __rl: true,
                value: '={{ $("Configuração Inicial").first().json.phase_2_workflow_id }}',
                mode: 'id',
            },
            workflowInputs: {
                mappingMode: 'defineBelow',
                value: {
                    execution_plan_json: '={{ JSON.stringify($json) }}',
                },
                matchingColumns: ['execution_plan_json'],
                schema: [
                    {
                        id: 'execution_plan_json',
                        displayName: 'execution_plan_json',
                        required: false,
                        defaultMatch: false,
                        display: true,
                        canBeUsedToMatch: true,
                        removed: false,
                    },
                ],
                attemptToConvertTypes: false,
                convertFieldsToString: false,
            },
            mode: 'each',
            options: {
                waitForSubWorkflow: true,
            },
        },
        id: 'exec-fase2-final',
        name: 'Execute Fase 2',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [240, -20],
    };

    const executeFase3 = {
        parameters: {
            source: 'database',
            workflowId: {
                __rl: true,
                value: '={{ $("Configuração Inicial").first().json.phase_3_workflow_id }}',
                mode: 'id',
            },
            workflowInputs: {
                mappingMode: 'defineBelow',
                value: {
                    execution_result_json: '={{ JSON.stringify($json) }}',
                },
                matchingColumns: ['execution_result_json'],
                schema: [
                    {
                        id: 'execution_result_json',
                        displayName: 'execution_result_json',
                        required: false,
                        defaultMatch: false,
                        display: true,
                        canBeUsedToMatch: true,
                        removed: false,
                    },
                ],
                attemptToConvertTypes: false,
                convertFieldsToString: false,
            },
            mode: 'each',
            options: {
                waitForSubWorkflow: true,
            },
        },
        id: 'exec-fase3-final',
        name: 'Execute Fase 3',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [520, -20],
    };

    upsertNode(wf, executeFase1);
    upsertNode(wf, executeFase2);
    upsertNode(wf, executeFase3);

    wf.connections = {};
    connect(wf, 'Manual Trigger', 'Configuração Inicial');
    connect(wf, 'Configuração Inicial', 'Preparar Orquestração');
    connect(wf, 'Preparar Orquestração', 'Execute Fase 1');
    connect(wf, 'Execute Fase 1', 'Filtrar Plans Preparados');
    connect(wf, 'Filtrar Plans Preparados', 'Execute Fase 2');
    connect(wf, 'Execute Fase 2', 'Execute Fase 3');
    connect(wf, 'Execute Fase 3', 'Relatório Final da Orquestração');
}

function buildPhase1(wf) {
    wf.name = '01 - Fase 1 - Preparação de Jobs (Final)';
    addExecuteTrigger(wf, [-1120, -560], 'Configuração Fase 1');

    const cfg = getNode(wf, 'Configuração Fase 1');
    cfg.parameters.keepOnlySet = false;
    const values = cfg.parameters.values || {};
    const stringValues = Array.isArray(values.string) ? values.string : [];
    const ensureField = (name, value) => {
        const existing = stringValues.find((item) => item.name === name);
        if (existing) {
            existing.value = value;
        } else {
            stringValues.push({ name, value });
        }
    };
    ensureField('execution_mode', 'dry_run');
    ensureField('max_jobs_per_run', '30');
    cfg.parameters.values = { ...values, string: stringValues };

    const buildPlans = getNode(wf, 'Build Execution Plans');
    buildPlans.parameters.jsCode = String(buildPlans.parameters.jsCode || '').replace(
        'return executionPlans.map((plan) => ({',
        `const executionMode = safeString((input.source_catalog && input.source_catalog.execution_mode) || input.execution_mode || $('Configuração Fase 1').first().json.execution_mode || 'dry_run').toLowerCase();\n\nreturn executionPlans.map((plan) => ({`,
    ).replace(
        '...plan,\n    preparation_report: preparationReport,',
        '...plan,\n    execution_mode: executionMode,\n    queue_record: { queue_status: plan.eligibility_status === \"prepared\" ? \"queued\" : \"blocked\", retry_count: 0, locked_at: \"\", locked_by: \"\" },\n    preparation_report: preparationReport,',
    );
}

function buildPhase2(wf) {
    wf.name = '02 - Fase 2 - Executar 1 Job (Final)';
    addExecuteTrigger(wf, [-1120, -560], 'Configuração Fase 2');

    const cfg = getNode(wf, 'Configuração Fase 2');
    cfg.parameters.keepOnlySet = false;
    const values = cfg.parameters.values || {};
    const stringValues = Array.isArray(values.string) ? values.string : [];
    const ensureField = (name, value) => {
        const existing = stringValues.find((item) => item.name === name);
        if (existing) {
            existing.value = value;
        } else {
            stringValues.push({ name, value });
        }
    };
    ensureField('execution_mode', 'dry_run');
    cfg.parameters.values = { ...values, string: stringValues };

    const normalizar = getNode(wf, 'Normalizar Execution Plan');
    normalizar.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
const cfg = $('Configuração Fase 2').first().json || {};
const raw = $json.execution_plan_json ? JSON.parse($json.execution_plan_json) : ($json || {});
const execution_mode = safeString(raw.execution_mode || cfg.execution_mode || 'dry_run').toLowerCase();
const blockers = safeArray(raw.blockers).slice();
if (safeString(raw.eligibility_status) && safeString(raw.eligibility_status) !== 'prepared') blockers.push('eligibility_status=' + safeString(raw.eligibility_status));
if (!safeArray(raw.media_inventory).length) blockers.push('media_inventory ausente');
if (!safeString(raw.resolved_account_id)) blockers.push('resolved_account_id ausente');
if (!safeString(raw.resolved_page_id)) blockers.push('resolved_page_id ausente');
if ((safeString(raw.planned_action) || 'create_new') !== 'replace_existing' && !safeString(raw.resolved_adset_id)) blockers.push('resolved_adset_id ausente para create_new');

if (blockers.length) {
  return [{
    json: {
      ...raw,
      action: safeString(raw.planned_action) || 'create_new',
      validation_status: 'blocked',
      execution_mode,
      blockers,
      errors: blockers,
      warnings: safeArray(raw.warnings),
      drive_file_ids: safeArray(raw.drive_file_ids),
      uploaded_assets: {},
      queue_record: {
        queue_status: 'blocked',
        retry_count: Number(raw.retry_count || 0),
        locked_at: new Date().toISOString(),
      },
    },
  }];
}

return [{
  json: {
    ...raw,
    planned_action: safeString(raw.planned_action) || 'create_new',
    action: safeString(raw.planned_action) || 'create_new',
    validation_status: 'ready',
    execution_mode,
    destination_ad_account_id: safeString(raw.resolved_account_id),
    destination_page_id: safeString(raw.resolved_page_id),
    destination_instagram_user_id: safeString(raw.resolved_instagram_user_id),
    destination_adset_id: safeString(raw.resolved_adset_id),
    destination_api_version: safeString(raw.meta_api_version || cfg.meta_api_version || 'v24.0'),
    source_ad_id: safeString(raw.matched_source_ad_id),
    queue_record: {
      queue_status: 'locked',
      retry_count: Number(raw.retry_count || 0),
      locked_at: new Date().toISOString(),
    },
  },
}];
`;

    const composeAdRequest = getNode(wf, 'Compose Ad Request');
    composeAdRequest.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
function pickFirstString(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized) return normalized;
  }
  return '';
}

const response = $input.first().json || {};
const buildItems = $('Build Meta Requests').all().map((item) => item.json || {});
const responseKey = safeString(response.execution_plan_id) + '::' + safeString(response.job_key);
let build = buildItems.find((item) => (safeString(item.execution_plan_id) + '::' + safeString(item.job_key)) === responseKey);
if (!build) build = buildItems[0] || {};

const creativeId = pickFirstString(response.id, response.id_1, response.id_2, response.creative_id, response.creative_id_1);
if (!safeString(build.job_key)) throw new Error('Compose Ad Request: contexto do Build Meta Requests ausente.');
if (!creativeId) throw new Error('Compose Ad Request: resposta sem id de creative.');

return [{
  json: {
    ...build,
    creative_id: creativeId,
    createAdBody: {
      name: build.adPayload ? build.adPayload.name : '',
      adset_id: build.adPayload ? build.adPayload.adset_id : '',
      status: build.adPayload ? (build.adPayload.status || 'ACTIVE') : 'ACTIVE',
      creative: { creative_id: creativeId },
    },
    updateAdBody: { creative: { creative_id: creativeId } },
  },
}];
`;

    const executionResult = getNode(wf, 'Execution Result');
    executionResult.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
function pickFirstString(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized) return normalized;
  }
  return '';
}

const current = ($input.first() || {}).json || {};
const context = ($('Compose Ad Request').first() || {}).json || {};
const adId = pickFirstString(current.id, current.ad_id, current.id_1);
const action = safeString(context.action || context.planned_action) || 'create_new';

return [{
  json: {
    execution_plan_id: safeString(context.execution_plan_id),
    job_key: safeString(context.job_key),
    destination_group: safeString(context.destination_group),
    destination_row_number: safeString(context.destination_row_number),
    status: adId ? 'executed_success' : 'executed_partial',
    action_executed: action,
    execution_mode: safeString(context.execution_mode || 'dry_run'),
    creative_id: safeString(context.creative_id),
    ad_id: safeString(adId),
    updated_ad_id: action === 'replace_existing' ? safeString(context.source_ad_id) : '',
    drive_file_ids: context.drive_file_ids || [],
    uploaded_assets: context.uploaded_assets || {},
    analysis: context.analysis || {},
    video_frame: context.video_frame || {},
    queue_record: {
      queue_status: adId ? 'executed' : 'executed_with_warnings',
      retry_count: Number((context.queue_record && context.queue_record.retry_count) || 0),
      locked_at: (context.queue_record && context.queue_record.locked_at) || '',
      finished_at: new Date().toISOString(),
    },
    warnings: context.upload_warnings || [],
    errors: adId ? [] : ['Resposta do endpoint de anúncio sem id retornado'],
    meta_response_summary: current,
  },
}];
`;

    const blockedSwitch = {
        parameters: {
            rules: {
                values: [
                    {
                        conditions: {
                            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                            conditions: [
                                {
                                    id: 'phase2-validation-ready',
                                    leftValue: '={{$json.validation_status}}',
                                    rightValue: 'ready',
                                    operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
                                },
                            ],
                            combinator: 'and',
                        },
                        renameOutput: true,
                        outputKey: 'Ready',
                    },
                    {
                        conditions: {
                            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                            conditions: [
                                {
                                    id: 'phase2-validation-blocked',
                                    leftValue: '={{$json.validation_status}}',
                                    rightValue: 'blocked',
                                    operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
                                },
                            ],
                            combinator: 'and',
                        },
                        renameOutput: true,
                        outputKey: 'Blocked',
                    },
                ],
            },
            options: {},
        },
        id: 'phase2-switch-validation',
        name: 'Switch Validação Plan',
        type: 'n8n-nodes-base.switch',
        typeVersion: 3.4,
        position: [-520, -560],
    };

    const blockedResult = {
        parameters: {
            jsCode: `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
const raw = $json || {};
return [{
  json: {
    execution_plan_id: safeString(raw.execution_plan_id),
    job_key: safeString(raw.job_key),
    destination_group: safeString(raw.destination_group),
    destination_row_number: safeString(raw.destination_row_number),
    status: 'manual_review_required',
    action_executed: safeString(raw.action || raw.planned_action) || 'create_new',
    execution_mode: safeString(raw.execution_mode || 'dry_run'),
    creative_id: '',
    ad_id: '',
    updated_ad_id: '',
    drive_file_ids: safeArray(raw.drive_file_ids),
    uploaded_assets: {},
    warnings: safeArray(raw.warnings),
    errors: safeArray(raw.errors).length ? safeArray(raw.errors) : safeArray(raw.blockers),
    queue_record: {
      queue_status: 'manual_review_required',
      retry_count: Number(raw.retry_count || 0),
      locked_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    },
    meta_response_summary: {},
  },
}];
`,
        },
        id: 'phase2-blocked-result',
        name: 'Execution Result Blocked',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [-280, -760],
    };

    const switchUpload = makeModeSwitchNode('phase2-switch-upload', 'Switch Modo Upload', [-40, -560], '={{$json.execution_mode}}');
    const mockUpload = {
        parameters: {
            jsCode: `
function safeString(value) { return String(value ?? '').trim(); }
const src = $json || {};
const ratio = safeString(src.ratio) || 'asset';
const original = safeString(src.original_name) || ('asset_' + ratio + '.jpg');
const hash = 'DRYRUN_' + ratio.replace(/[^a-zA-Z0-9]+/g, '_') + '_' + Date.now();
return [{
  json: {
    images: {
      [original]: {
        hash,
        url: 'https://example.invalid/' + hash + '.jpg',
      },
    },
  },
}];
`,
        },
        id: 'phase2-mock-upload',
        name: 'Mock Upload File',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [200, -760],
    };

    const switchCreative = makeModeSwitchNode('phase2-switch-creative', 'Switch Modo Creative', [840, -560], '={{$json.execution_mode}}');
    const mockCreative = {
        parameters: {
            jsCode: `
function safeString(value) { return String(value ?? '').trim(); }
const item = $json || {};
const seed = safeString(item.execution_plan_id || item.job_key || Date.now());
return [{
  json: {
    id: 'DRYRUN_CREATIVE_' + seed.replace(/[^a-zA-Z0-9]+/g, '_'),
    execution_plan_id: safeString(item.execution_plan_id),
    job_key: safeString(item.job_key),
  },
}];
`,
        },
        id: 'phase2-mock-creative',
        name: 'Mock Create AdCreative',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1080, -760],
    };

    const switchPublishMode = makeModeSwitchNode('phase2-switch-publish', 'Switch Modo Publicação', [1520, -560], '={{$json.execution_mode}}');
    const mockPublish = {
        parameters: {
            jsCode: `
function safeString(value) { return String(value ?? '').trim(); }
const item = $json || {};
const action = safeString(item.action || item.planned_action) || 'create_new';
if (action === 'replace_existing') {
  return [{ json: { id: safeString(item.source_ad_id || item.ad_id || 'DRYRUN_REPLACED_AD') } }];
}
const seed = safeString(item.execution_plan_id || item.job_key || Date.now());
return [{ json: { id: 'DRYRUN_AD_' + seed.replace(/[^a-zA-Z0-9]+/g, '_') } }];
`,
        },
        id: 'phase2-mock-publish',
        name: 'Mock Publish Ad',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1760, -760],
    };

    upsertNode(wf, blockedSwitch);
    upsertNode(wf, blockedResult);
    upsertNode(wf, switchUpload);
    upsertNode(wf, mockUpload);
    upsertNode(wf, switchCreative);
    upsertNode(wf, mockCreative);
    upsertNode(wf, switchPublishMode);
    upsertNode(wf, mockPublish);

    // Rewire major flow
    removeConnection(wf, 'Entrada Exemplo - Execution Plan', 'Normalizar Execution Plan');
    connect(wf, 'Entrada Exemplo - Execution Plan', 'Configuração Fase 2');
    connect(wf, 'Configuração Fase 2', 'Normalizar Execution Plan');

    removeConnection(wf, 'Normalizar Execution Plan', 'Split Out Assets');
    connect(wf, 'Normalizar Execution Plan', 'Switch Validação Plan');
    connect(wf, 'Switch Validação Plan', 'Split Out Assets', 0, 0);
    connect(wf, 'Switch Validação Plan', 'Execution Result Blocked', 1, 0);

    removeConnection(wf, 'Prepare Upload Input', 'Upload File');
    connect(wf, 'Prepare Upload Input', 'Switch Modo Upload');
    connect(wf, 'Switch Modo Upload', 'Mock Upload File', 0, 0);
    connect(wf, 'Switch Modo Upload', 'Upload File', 1, 0);
    connect(wf, 'Mock Upload File', 'Normalize Uploaded Asset');

    removeConnection(wf, 'Build Meta Requests', 'Create AdCreative');
    connect(wf, 'Build Meta Requests', 'Switch Modo Creative');
    connect(wf, 'Switch Modo Creative', 'Mock Create AdCreative', 0, 0);
    connect(wf, 'Switch Modo Creative', 'Create AdCreative', 1, 0);
    connect(wf, 'Mock Create AdCreative', 'Compose Ad Request');

    removeConnection(wf, 'Compose Ad Request', 'Switch');
    connect(wf, 'Compose Ad Request', 'Switch Modo Publicação');
    connect(wf, 'Switch Modo Publicação', 'Mock Publish Ad', 0, 0);
    connect(wf, 'Switch Modo Publicação', 'Switch', 1, 0);
    connect(wf, 'Mock Publish Ad', 'Execution Result');
}

function buildPhase3(wf) {
    wf.name = '03 - Fase 3 - Finalização e Reconciliação (Final)';
    addExecuteTrigger(wf, [-1120, -360], 'Normalizar Finalização');

    const normalizar = getNode(wf, 'Normalizar Finalização');
    normalizar.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
const raw = $json.execution_result_json ? JSON.parse($json.execution_result_json) : ($json || {});
const execution_mode = safeString(raw.execution_mode || 'dry_run').toLowerCase();
const fileIds = safeArray(raw.drive_file_ids).length ? safeArray(raw.drive_file_ids) : (safeString(raw.drive_file_id) ? [safeString(raw.drive_file_id)] : []);
const final_status = safeString(raw.status) === 'executed_success'
  ? 'completed'
  : safeString(raw.status) === 'executed_partial'
    ? 'completed_with_warnings'
    : safeString(raw.status) === 'manual_review_required'
      ? 'manual_review_required'
      : 'failed';
return [{
  json: {
    ...raw,
    execution_mode,
    drive_file_ids: fileIds,
    final_status,
    manual_review_required: final_status === 'manual_review_required' || final_status === 'failed',
  },
}];
`;

    const prepareDriveUpdate = getNode(wf, 'Prepare Drive Update');
    prepareDriveUpdate.parameters.jsCode = `
function safeString(value) { return String(value ?? '').trim(); }
const fileId = safeString($json.drive_file_id || $json.drive_file_ids || $json.id);
if (!fileId) {
  return [{
    json: {
      drive_file_id: '',
      skipped_drive_update: true,
      skip_reason: 'drive_file_id ausente no item',
      job_key: safeString($json.job_key),
      destination_group: safeString($json.destination_group),
      creative_id: safeString($json.creative_id),
      ad_id: safeString($json.ad_id || $json.updated_ad_id),
      published_at: new Date().toISOString(),
      execution_mode: safeString($json.execution_mode || 'dry_run'),
    },
  }];
}
return [{
  json: {
    drive_file_id: fileId,
    skipped_drive_update: false,
    job_key: safeString($json.job_key),
    destination_group: safeString($json.destination_group),
    creative_id: safeString($json.creative_id),
    ad_id: safeString($json.ad_id || $json.updated_ad_id),
    published_at: new Date().toISOString(),
    execution_mode: safeString($json.execution_mode || 'dry_run'),
  },
}];
`;

    const switchDriveMode = makeModeSwitchNode('phase3-switch-drive', 'Switch Modo Drive Update', [80, -560], '={{$json.execution_mode}}');
    const mockDriveUpdate = {
        parameters: {
            jsCode: `
return [{
  json: {
    id: $json.drive_file_id || '',
    drive_file_id: $json.drive_file_id || '',
    dry_run: true,
    updated: !Boolean($json.skipped_drive_update),
    skipped_drive_update: Boolean($json.skipped_drive_update),
    skip_reason: $json.skip_reason || '',
  },
}];
`,
        },
        id: 'phase3-mock-drive-update',
        name: 'Mock Drive Update',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [320, -760],
    };

    const publicationLedger = getNode(wf, 'Publication Ledger');
    publicationLedger.parameters.jsCode = `
const inputItems = $input.all();
const result = $('Normalizar Finalização').first().json || {};
const updated = inputItems.map((item) => item.json || {});
const requestedCount = Array.isArray(result.drive_file_ids) ? result.drive_file_ids.length : 0;
const updatedCount = updated.filter((item) => String(item.drive_file_id || item.id || '').trim()).length;
const skippedCount = updated.filter((item) => Boolean(item.skipped_drive_update)).length;
let finalStatus = result.final_status;
if (requestedCount > 0 && updatedCount < requestedCount && result.execution_mode !== 'dry_run') {
  finalStatus = 'completed_pending_drive_sync';
}
return [{
  json: {
    execution_plan_id: result.execution_plan_id,
    job_key: result.job_key,
    destination_group: result.destination_group,
    destination_row_number: result.destination_row_number,
    execution_mode: result.execution_mode || 'dry_run',
    final_status: finalStatus,
    action_executed: result.action_executed,
    creative_id: result.creative_id,
    ad_id: result.ad_id || result.updated_ad_id,
    published_files: updated.map((item) => item.id || item.drive_file_id || '').filter(Boolean),
    requested_files: requestedCount,
    updated_files: updatedCount,
    skipped_files: skippedCount,
    published_at: new Date().toISOString(),
    warnings: result.warnings || [],
    errors: result.errors || [],
    manual_review_required: Boolean(result.manual_review_required),
    retriable: Boolean((result.errors || []).length),
  },
}];
`;

    upsertNode(wf, switchDriveMode);
    upsertNode(wf, mockDriveUpdate);

    removeConnection(wf, 'Prepare Drive Update', 'Update File');
    connect(wf, 'Prepare Drive Update', 'Switch Modo Drive Update');
    connect(wf, 'Switch Modo Drive Update', 'Mock Drive Update', 0, 0);
    connect(wf, 'Switch Modo Drive Update', 'Update File', 1, 0);
    connect(wf, 'Mock Drive Update', 'Publication Ledger');

    // Keep live path already connected
    connect(wf, 'Update File', 'Publication Ledger');
}

function finalizeMonitoring(wf) {
    wf.name = '04 - Monitoramento e Governança (Final)';
    const node = getNode(wf, 'TODO - Consolidar Métricas');
    node.name = 'Consolidar Métricas';
    node.parameters.jsCode = `
const items = $input.all().map((item) => item.json || {});
return [{
  json: {
    generated_at: new Date().toISOString(),
    monitoring_snapshot: {
      prepared: items.filter((i) => i.eligibility_status === 'prepared').length,
      blocked: items.filter((i) => i.eligibility_status === 'blocked').length,
      executed_success: items.filter((i) => i.status === 'executed_success').length,
      executed_partial: items.filter((i) => i.status === 'executed_partial').length,
      completed: items.filter((i) => i.final_status === 'completed').length,
      manual_review_required: items.filter((i) => i.manual_review_required === true).length,
      failed: items.filter((i) => i.final_status === 'failed').length,
    },
    alerts: items
      .filter((i) => i.manual_review_required || i.final_status === 'failed')
      .map((i) => ({ job_key: i.job_key || '', reason: i.errors || i.warnings || [] })),
  },
}];
`;

    if (wf.connections && wf.connections['Manual Trigger'] && Array.isArray(wf.connections['Manual Trigger'].main)) {
        wf.connections['Manual Trigger'].main = wf.connections['Manual Trigger'].main.map((bucket) =>
            Array.isArray(bucket)
                ? bucket.map((edge) =>
                    edge && edge.node === 'TODO - Consolidar Métricas'
                        ? { ...edge, node: 'Consolidar Métricas' }
                        : edge,
                )
                : bucket,
        );
    }
}

function main() {
    const workflows = parseArrayFile(SOURCE_FILE);

    const orchestrator = workflows.find((wf) => wf.name.startsWith('00 - Orquestrador'));
    const phase1 = workflows.find((wf) => wf.name.startsWith('01 - Fase 1'));
    const phase2 = workflows.find((wf) => wf.name.startsWith('02 - Fase 2'));
    const phase3 = workflows.find((wf) => wf.name.startsWith('03 - Fase 3'));
    const monitoring = workflows.find((wf) => wf.name.startsWith('04 - Monitoramento'));

    if (!orchestrator || !phase1 || !phase2 || !phase3 || !monitoring) {
        throw new Error('Não foi possível localizar todos os workflows esperados no arquivo fonte.');
    }

    buildOrchestrator(orchestrator);
    buildPhase1(phase1);
    buildPhase2(phase2);
    buildPhase3(phase3);
    finalizeMonitoring(monitoring);

    const finalWorkflows = [orchestrator, phase1, phase2, phase3, monitoring];

    const packagePath = path.join(OUTPUT_DIR, 'meta-ads.update-campaign-ads.final.package.json');
    writeJson(packagePath, finalWorkflows);

    for (const wf of finalWorkflows) {
        const slug = wf.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-final$/, '');
        writeJson(path.join(OUTPUT_DIR, `meta-ads.update-campaign-ads.${slug}.json`), wf);
    }

    console.log('Workflows finais gerados com sucesso:');
    console.log('-', packagePath);
    finalWorkflows.forEach((wf) => {
        const slug = wf.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-final$/, '');
        console.log('-', path.join(OUTPUT_DIR, `meta-ads.update-campaign-ads.${slug}.json`));
    });
}

main();
