#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

const FILES = {
    orchestrator: 'meta-ads.update-campaign-ads.00-orquestrador-meta-ads-update-campaign-ads.json',
    phase1: 'meta-ads.update-campaign-ads.01-fase-1-preparacao-de-jobs.json',
    phase2: 'meta-ads.update-campaign-ads.02-fase-2-executar-1-job.json',
    phase3: 'meta-ads.update-campaign-ads.03-fase-3-finalizacao-e-reconciliacao.json',
    monitoring: 'meta-ads.update-campaign-ads.04-monitoramento-e-governanca.json',
};

const OUTPUT_FILE = path.join(
    WORKFLOWS_DIR,
    'meta-ads.update-campaign-ads.05-workflow-unico-final.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toSet(values) {
    return new Set(values || []);
}

function filterWorkflow(workflow, excludedNodeNames) {
    const excluded = toSet(excludedNodeNames);
    const keptNodes = (workflow.nodes || []).filter((node) => !excluded.has(node.name));
    const keptNodeNames = new Set(keptNodes.map((node) => node.name));

    const keptConnections = {};
    for (const [sourceName, outputMap] of Object.entries(workflow.connections || {})) {
        if (!keptNodeNames.has(sourceName)) continue;

        const nextOutputMap = {};
        for (const [channel, buckets] of Object.entries(outputMap || {})) {
            if (!Array.isArray(buckets)) continue;
            const filteredBuckets = buckets.map((bucket) =>
                (bucket || []).filter((edge) => edge && keptNodeNames.has(edge.node)),
            );

            if (filteredBuckets.some((bucket) => bucket.length > 0)) {
                nextOutputMap[channel] = filteredBuckets;
            }
        }

        if (Object.keys(nextOutputMap).length > 0) {
            keptConnections[sourceName] = nextOutputMap;
        }
    }

    return {
        nodes: keptNodes,
        connections: keptConnections,
    };
}

function mergeConnections(target, source) {
    for (const [sourceName, outputMap] of Object.entries(source || {})) {
        if (!target[sourceName]) target[sourceName] = {};

        for (const [channel, buckets] of Object.entries(outputMap || {})) {
            if (!target[sourceName][channel]) target[sourceName][channel] = [];

            const destBuckets = target[sourceName][channel];
            for (let i = 0; i < buckets.length; i += 1) {
                if (!destBuckets[i]) destBuckets[i] = [];
                for (const edge of buckets[i] || []) {
                    if (!edge || !edge.node) continue;
                    const exists = destBuckets[i].some(
                        (item) => item.node === edge.node && item.type === edge.type && item.index === edge.index,
                    );
                    if (!exists) destBuckets[i].push(edge);
                }
            }
        }
    }
}

function ensureConnection(connections, from, to, channel = 'main', outputIndex = 0, inputIndex = 0) {
    if (!connections[from]) connections[from] = {};
    if (!connections[from][channel]) connections[from][channel] = [];

    while (connections[from][channel].length <= outputIndex) {
        connections[from][channel].push([]);
    }

    const bucket = connections[from][channel][outputIndex];
    const exists = bucket.some(
        (edge) => edge.node === to && edge.type === channel && edge.index === inputIndex,
    );
    if (!exists) {
        bucket.push({ node: to, type: channel, index: inputIndex });
    }
}

function validateConnections(workflow) {
    const nodeNames = new Set((workflow.nodes || []).map((node) => node.name));
    const issues = [];

    for (const [sourceName, outputMap] of Object.entries(workflow.connections || {})) {
        if (!nodeNames.has(sourceName)) {
            issues.push(`Source node missing: ${sourceName}`);
            continue;
        }

        for (const [channel, buckets] of Object.entries(outputMap || {})) {
            if (!Array.isArray(buckets)) continue;
            for (const bucket of buckets) {
                for (const edge of bucket || []) {
                    if (!nodeNames.has(edge.node)) {
                        issues.push(`Target node missing: ${sourceName} -> ${edge.node} (${channel})`);
                    }
                }
            }
        }
    }

    return issues;
}

function main() {
    const orchestrator = readJson(path.join(WORKFLOWS_DIR, FILES.orchestrator));
    const phase1 = readJson(path.join(WORKFLOWS_DIR, FILES.phase1));
    const phase2 = readJson(path.join(WORKFLOWS_DIR, FILES.phase2));
    const phase3 = readJson(path.join(WORKFLOWS_DIR, FILES.phase3));
    const monitoring = readJson(path.join(WORKFLOWS_DIR, FILES.monitoring));

    const base = filterWorkflow(orchestrator, ['Execute Fase 1', 'Execute Fase 2', 'Execute Fase 3']);
    const p1 = filterWorkflow(phase1, [
        'Manual Trigger',
        'When Executed by Another Workflow',
        'Persistência',
        'Drive Ready',
        'Sheet Ready',
        'Campaigns Ready',
        'AdSets Ready',
        'Ads Ready',
    ]);
    const p2 = filterWorkflow(phase2, [
        "When clicking 'Execute workflow'",
        'Entrada Exemplo - Execution Plan',
        'When Executed by Another Workflow',
    ]);
    const p3 = filterWorkflow(phase3, [
        "When clicking 'Execute workflow'",
        'Entrada Exemplo - Execution Result',
        'When Executed by Another Workflow',
    ]);
    const mon = filterWorkflow(monitoring, ['Manual Trigger']);

    const merged = {
        name: '05 - Workflow Único - Meta Ads Update Campaign Ads (Final)',
        nodes: [
            ...base.nodes,
            ...p1.nodes,
            ...p2.nodes,
            ...p3.nodes,
            ...mon.nodes,
        ],
        connections: {},
        active: false,
        settings: {},
        staticData: null,
        pinData: {},
        meta: {
            instanceId: 'meta-ads-unified-builder',
            sourceWorkflows: [
                FILES.orchestrator,
                FILES.phase1,
                FILES.phase2,
                FILES.phase3,
                FILES.monitoring,
            ],
            generatedAt: new Date().toISOString(),
        },
    };

    mergeConnections(merged.connections, base.connections);
    mergeConnections(merged.connections, p1.connections);
    mergeConnections(merged.connections, p2.connections);
    mergeConnections(merged.connections, p3.connections);
    mergeConnections(merged.connections, mon.connections);

    ensureConnection(merged.connections, 'Preparar Orquestração', 'Configuração Fase 1');
    ensureConnection(merged.connections, 'Download File', 'Merge Ready 1', 'main', 0, 0);
    ensureConnection(merged.connections, 'Get row(s) in sheet', 'Merge Ready 1', 'main', 0, 1);
    ensureConnection(merged.connections, 'Meta List Campaigns', 'Merge Ready 2', 'main', 0, 0);
    ensureConnection(merged.connections, 'Meta List AdSets', 'Merge Ready 2', 'main', 0, 1);
    ensureConnection(merged.connections, 'Merge Ready 1', 'Merge Ready 3', 'main', 0, 0);
    ensureConnection(merged.connections, 'Merge Ready 2', 'Merge Ready 3', 'main', 0, 1);
    ensureConnection(merged.connections, 'Merge Ready 3', 'Merge Ready 4', 'main', 0, 0);
    ensureConnection(merged.connections, 'Meta List Ads', 'Merge Ready 4', 'main', 0, 1);
    ensureConnection(merged.connections, 'Merge Ready 4', 'Build Source Catalog');
    ensureConnection(merged.connections, 'Build Execution Plans', 'Filtrar Plans Preparados');
    ensureConnection(merged.connections, 'Filtrar Plans Preparados', 'Configuração Fase 2');
    ensureConnection(merged.connections, 'Execution Result', 'Normalizar Finalização');
    ensureConnection(merged.connections, 'Publication Ledger', 'Relatório Final da Orquestração');
    ensureConnection(merged.connections, 'Publication Ledger', 'Consolidar Métricas');

    const issues = validateConnections(merged);
    if (issues.length) {
        console.error('Connection validation failed:');
        issues.forEach((issue) => console.error('-', issue));
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(merged, null, 2)}\n`);

    console.log('Unified workflow generated successfully.');
    console.log(`Output: ${OUTPUT_FILE}`);
    console.log(`Nodes: ${merged.nodes.length}`);
    console.log(`Connection sources: ${Object.keys(merged.connections).length}`);
}

main();
