#!/usr/bin/env node

const fs = require('fs');

const workflowPath = process.argv[2] || 'workflows/livia.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function node(name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(`Missing node: ${name}`);
  return found;
}

function ensureConnection(source, target, index = 0) {
  workflow.connections[source] ||= {};
  workflow.connections[source].main ||= [];
  workflow.connections[source].main[0] ||= [];

  const group = workflow.connections[source].main[0];
  if (!group.some((connection) => connection.node === target && connection.type === 'main' && connection.index === index)) {
    group.push({ node: target, type: 'main', index });
  }
}

function removeConnection(source, target) {
  const main = workflow.connections[source]?.main;
  if (!Array.isArray(main)) return;

  for (const group of main) {
    if (!Array.isArray(group)) continue;
    for (let i = group.length - 1; i >= 0; i -= 1) {
      if (group[i]?.node === target) group.splice(i, 1);
    }
  }
}

function replaceBetween(source, start, end, replacement) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) fail(`Could not find start marker: ${start}`);

  const endIndex = source.indexOf(end, startIndex);
  if (endIndex === -1) fail(`Could not find end marker: ${end}`);

  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

function patchTopology() {
  const merge3 = node('Merge (3)');
  merge3.parameters ||= {};
  merge3.parameters.numberInputs = 3;

  if (!workflow.nodes.some((item) => item.name === 'Merge Main Media Context')) {
    workflow.nodes.push({
      parameters: {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
      },
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [-5824, -2016],
      id: '0a67b89f-9a88-4ec2-a1a8-6b772c0d8c20',
      name: 'Merge Main Media Context',
    });
  } else {
    const mergeMain = node('Merge Main Media Context');
    mergeMain.parameters = {
      ...(mergeMain.parameters || {}),
      mode: 'combine',
      combineBy: 'combineByPosition',
      options: mergeMain.parameters?.options || {},
    };
  }

  removeConnection('Compose (1)', 'Merge (3)');
  removeConnection('Upload Main Media', 'Merge (3)');

  ensureConnection('Compose (1)', 'Merge Main Media Context', 0);
  ensureConnection('Upload Main Media', 'Merge Main Media Context', 1);
  ensureConnection('Merge Main Media Context', 'Merge (3)', 2);
}

function patchCompose2() {
  const compose2 = node('Compose (2)');
  let code = compose2.parameters?.jsCode || '';

  code = code
    .replace('// - Este Code node NÃO referencia "Parse Frame Analysis JSON".\n// - Este Code node NÃO referencia "Aggregate (2)".\n// - Frames/capas vêm apenas da saída normalizada da Livia.',
      '// - Este Code node consome apenas o payload direto do Merge (3).\n// - Aggregate (2), Livia e mídia principal combinada devem chegar no input direto.\n// - Não busca itens de nós anteriores para evitar timeout do JS Task Runner.');

  const helperStart = 'function safeNodeItems(name) {';
  const helperEnd = 'function flattenFrameCandidateItems(items) {';
  const helperReplacement = `function readDirectInputItems() {
  try {
    if (typeof $input !== "undefined" && $input && typeof $input.all === "function") {
      return $input.all() || [];
    }
  } catch {
    return [];
  }

  return [];
}

function isLiviaItem(j) {
  return !!(j && typeof j === "object" && (
    j.output !== undefined ||
    (j.locale && (Array.isArray(j.items) || j.caption || j.captions))
  ));
}

function isCompose1MediaItem(j) {
  return !!(j && typeof j === "object" &&
    j.groupKey !== undefined &&
    j.id !== undefined &&
    j.mimeType !== undefined &&
    (j.instagram || j.facebook || j.threads)
  );
}

function isMainUploadItem(j) {
  if (!j || typeof j !== "object") return false;
  const url = str(j.secure_url || j.url || "");
  const resourceType = str(j.resource_type || "").toLowerCase();
  if (!url || !resourceType) return false;
  if (j.output !== undefined || Array.isArray(j.candidate) || j.candidate) return false;
  return resourceType === "video" || resourceType === "image";
}

function isCombinedMainMediaItem(j) {
  return isCompose1MediaItem(j) && isMainUploadItem(j);
}

function isAggregate2Item(j) {
  if (!j || typeof j !== "object") return false;
  return Array.isArray(j.candidate) ||
    Array.isArray(j.frameCandidates) ||
    Array.isArray(j.technicalFrameCandidates) ||
    (Array.isArray(j.secure_url) && Array.isArray(j.url));
}

function selectDirectNodeItems(name, directItems) {
  const items = Array.isArray(directItems) ? directItems : [];
  if (!items.length) return [];

  if (name === "Livia") {
    return items.filter((item) => isLiviaItem((item && item.json) || {}));
  }

  if (name === "Main Media Context") {
    return items.filter((item) => isCombinedMainMediaItem((item && item.json) || {}));
  }

  if (name === "Aggregate (2)") {
    return items.filter((item) => isAggregate2Item((item && item.json) || {}));
  }

  return [];
}

`;

  code = replaceBetween(code, helperStart, helperEnd, helperReplacement);

  const mainStart = '// Preferir dados do input direto do Merge (3). O fallback por $items()\n// fica apenas para execuções isoladas do node no editor.';
  const mainEnd = 'if (!c2Items.length) return [];';
  const mainReplacement = `// Consumir somente o input direto do Merge (3). Evita buscar itens de nós anteriores, que neste
// workflow pode travar o JS Task Runner quando há dados grandes/pinned.
const directInputItems = readDirectInputItems();
const aggregate2Items = selectDirectNodeItems("Aggregate (2)", directInputItems);
const technicalFrameCandidates = flattenFrameCandidateItems(aggregate2Items);
const parsedFrameCandidateCount = technicalFrameCandidates.length;

let c2Items = selectDirectNodeItems("Main Media Context", directInputItems);
const mainUploadItems = c2Items;
const uploadItems = mainUploadItems;
const liviaItems = selectDirectNodeItems("Livia", directInputItems);

if (!directInputItems.length) {
  throw new Error("Compose (2): Merge (3) não entregou itens no input direto.");
}

if (!aggregate2Items.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem Aggregate (2) para candidatos de frame.");
}

if (!liviaItems.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem saída da Livia.");
}

if (!c2Items.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem mídia principal combinada (Compose 1 + Upload Main Media).");
}

`;

  code = replaceBetween(code, mainStart, mainEnd, mainReplacement);

  if (/\$items\s*\(/.test(code) || /safeNodeItems\s*\(/.test(code)) {
    fail('Compose (2) still contains $items() or safeNodeItems()');
  }

  compose2.parameters.jsCode = code;
}

patchTopology();
patchCompose2();

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  workflowPath,
  nodes: workflow.nodes.length,
  merge3Inputs: node('Merge (3)').parameters.numberInputs,
  hasMergeMainMediaContext: true,
}, null, 2));
