#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PACKAGE_FILE = path.join(__dirname, '..', 'workflows', 'meta-ads.update-campaign-ads.final.package.json');

function loadPackage() {
    return JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
}

function getWorkflow(pack, prefix) {
    const wf = pack.find((item) => item.name.startsWith(prefix));
    if (!wf) throw new Error(`Workflow not found with prefix: ${prefix}`);
    return wf;
}

function getNode(workflow, nodeName) {
    const node = (workflow.nodes || []).find((n) => n.name === nodeName);
    if (!node) throw new Error(`Node not found: ${nodeName} (${workflow.name})`);
    return node;
}

function runCodeNode(jsCode, { inputItems = [{ json: {} }], json = {}, refs = {} } = {}) {
    const inputApi = {
        first: () => inputItems[0] || { json: {} },
        all: () => inputItems,
    };

    const refApi = (name) => {
        const items = refs[name] || [];
        return {
            first: () => items[0] || { json: {} },
            all: () => items,
        };
    };

    const fn = new Function('$json', '$input', '$', jsCode);
    return fn(json, inputApi, refApi);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function structuralValidation(pack) {
    const findings = [];
    for (const wf of pack) {
        const names = new Set((wf.nodes || []).map((n) => n.name));
        for (const [src, outputs] of Object.entries(wf.connections || {})) {
            if (!names.has(src)) findings.push(`Missing source node '${src}' in ${wf.name}`);
            const main = outputs.main || [];
            for (const bucket of main) {
                for (const edge of bucket || []) {
                    if (!names.has(edge.node)) {
                        findings.push(`Missing target node '${edge.node}' from '${src}' in ${wf.name}`);
                    }
                }
            }
        }

        for (const node of wf.nodes || []) {
            if (node.type === 'n8n-nodes-base.httpRequest') {
                const payload = JSON.stringify(node.parameters || {});
                if (/Bearer\s+[A-Za-z0-9]/.test(payload)) {
                    findings.push(`Hardcoded bearer detected in ${wf.name} / ${node.name}`);
                }
            }
        }
    }
    return findings;
}

function logicalValidation(pack) {
    const results = [];

    const phase1 = getWorkflow(pack, '01 - Fase 1');
    const phase2 = getWorkflow(pack, '02 - Fase 2');
    const phase3 = getWorkflow(pack, '03 - Fase 3');

    const phase1BuildPlansCode = getNode(phase1, 'Build Execution Plans').parameters.jsCode || '';
    assert(!phase1BuildPlansCode.includes("$('Build Payload').all()"), 'Phase 1 must not depend on Build Payload global read');
    assert(!phase1BuildPlansCode.includes("$('Build Jobs').all()"), 'Phase 1 must not depend on Build Jobs global read');
    assert(phase1BuildPlansCode.includes('queue_record'), 'Phase 1 must emit queue_record');
    results.push('Phase 1 static checks: OK');

    const normalizarCode = getNode(phase2, 'Normalizar Execution Plan').parameters.jsCode || '';
    const phase2CfgRefs = {
        'Configuração Fase 2': [{ json: { execution_mode: 'dry_run', meta_api_version: 'v24.0' } }],
    };

    const readyPlan = {
        execution_plan_json: JSON.stringify({
            execution_plan_id: 'PLAN_TEST_READY',
            job_key: 'JOB_TEST_READY',
            eligibility_status: 'prepared',
            planned_action: 'create_new',
            media_inventory: [{ ratio: '3x4', drive_file_id: 'DRIVE_1' }],
            resolved_account_id: 'ACT_1',
            resolved_page_id: 'PAGE_1',
            resolved_adset_id: 'ADSET_1',
            resolved_instagram_user_id: 'IG_1',
            drive_file_ids: ['DRIVE_1'],
            blockers: [],
            warnings: [],
        }),
    };

    const readyOut = runCodeNode(normalizarCode, {
        json: readyPlan,
        inputItems: [{ json: readyPlan }],
        refs: phase2CfgRefs,
    });
    assert(Array.isArray(readyOut) && readyOut.length === 1, 'Phase 2 ready normalization must return 1 item');
    assert(readyOut[0].json.validation_status === 'ready', 'Phase 2 ready normalization status mismatch');
    assert(readyOut[0].json.execution_mode === 'dry_run', 'Phase 2 ready normalization execution_mode mismatch');
    results.push('Phase 2 ready normalization: OK');

    const blockedPlan = {
        execution_plan_json: JSON.stringify({
            execution_plan_id: 'PLAN_TEST_BLOCKED',
            job_key: 'JOB_TEST_BLOCKED',
            eligibility_status: 'blocked',
            planned_action: 'create_new',
            media_inventory: [],
            resolved_account_id: '',
            resolved_page_id: '',
            resolved_adset_id: '',
            blockers: ['missing_media_inventory'],
            warnings: [],
        }),
    };

    const blockedOut = runCodeNode(normalizarCode, {
        json: blockedPlan,
        inputItems: [{ json: blockedPlan }],
        refs: phase2CfgRefs,
    });
    assert(blockedOut[0].json.validation_status === 'blocked', 'Phase 2 blocked normalization status mismatch');
    assert(Array.isArray(blockedOut[0].json.errors) && blockedOut[0].json.errors.length > 0, 'Phase 2 blocked normalization must expose errors');
    results.push('Phase 2 blocked normalization: OK');

    const executionResultCode = getNode(phase2, 'Execution Result').parameters.jsCode || '';
    const execResultOut = runCodeNode(executionResultCode, {
        json: { id: 'AD_CREATED_123' },
        inputItems: [{ json: { id: 'AD_CREATED_123' } }],
        refs: {
            'Compose Ad Request': [{
                json: {
                    execution_plan_id: 'PLAN_TEST_READY',
                    job_key: 'JOB_TEST_READY',
                    destination_group: 'BARRA SHOPPING SUL',
                    destination_row_number: '12',
                    action: 'create_new',
                    execution_mode: 'dry_run',
                    creative_id: 'CREATIVE_123',
                    drive_file_ids: ['DRIVE_1'],
                    uploaded_assets: { '3x4': { hash: 'HASH_1' } },
                    queue_record: { retry_count: 0, locked_at: '2026-04-09T00:00:00.000Z' },
                    upload_warnings: [],
                },
            }],
        },
    });
    assert(execResultOut[0].json.status === 'executed_success', 'Phase 2 execution result should be executed_success');
    assert(execResultOut[0].json.execution_plan_id === 'PLAN_TEST_READY', 'Phase 2 execution result must preserve execution_plan_id');
    results.push('Phase 2 execution result mapping: OK');

    const normFinalCode = getNode(phase3, 'Normalizar Finalização').parameters.jsCode || '';
    const finalIn = {
        execution_result_json: JSON.stringify({
            execution_plan_id: 'PLAN_TEST_READY',
            job_key: 'JOB_TEST_READY',
            status: 'executed_success',
            action_executed: 'create_new',
            drive_file_ids: ['DRIVE_1', 'DRIVE_2'],
            creative_id: 'CREATIVE_123',
            ad_id: 'AD_CREATED_123',
            execution_mode: 'dry_run',
            warnings: [],
            errors: [],
        }),
    };
    const normFinalOut = runCodeNode(normFinalCode, {
        json: finalIn,
        inputItems: [{ json: finalIn }],
    });
    assert(normFinalOut[0].json.final_status === 'completed', 'Phase 3 final status must be completed for executed_success');
    assert(Array.isArray(normFinalOut[0].json.drive_file_ids) && normFinalOut[0].json.drive_file_ids.length === 2, 'Phase 3 must preserve drive_file_ids');
    results.push('Phase 3 normalization: OK');

    const prepDriveCode = getNode(phase3, 'Prepare Drive Update').parameters.jsCode || '';
    const prepDriveOut = runCodeNode(prepDriveCode, {
        json: {
            drive_file_ids: 'DRIVE_1',
            job_key: 'JOB_TEST_READY',
            destination_group: 'BARRA SHOPPING SUL',
            creative_id: 'CREATIVE_123',
            ad_id: 'AD_CREATED_123',
            execution_mode: 'dry_run',
        },
        inputItems: [{
            json: {
                drive_file_ids: 'DRIVE_1',
                job_key: 'JOB_TEST_READY',
                destination_group: 'BARRA SHOPPING SUL',
                creative_id: 'CREATIVE_123',
                ad_id: 'AD_CREATED_123',
                execution_mode: 'dry_run',
            },
        }],
    });
    assert(prepDriveOut[0].json.drive_file_id === 'DRIVE_1', 'Phase 3 prepare drive update must use explicit drive_file_id');
    results.push('Phase 3 drive_file_id mapping: OK');

    return results;
}

function main() {
    const pack = loadPackage();
    const structuralFindings = structuralValidation(pack);
    if (structuralFindings.length) {
        console.error('Structural validation failed:');
        structuralFindings.forEach((item) => console.error('-', item));
        process.exit(1);
    }

    const logicResults = logicalValidation(pack);
    console.log('Structural validation: OK');
    logicResults.forEach((line) => console.log(line));
    console.log('Dry-run deterministic validation: OK');
}

main();
