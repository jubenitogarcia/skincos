#!/usr/bin/env node

const fs = require('fs');

const workflowPath = process.argv[2] || 'workflows/livia.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function getNode(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return source.replace(needle, replacement);
}

const compose2 = getNode('Compose (2)');
let code = compose2.parameters.jsCode;

const helperNeedle = `function safeNodeItems(name) {
  try {
    return $items(name) || [];
  } catch {
    return [];
  }
}

function flattenFrameCandidateItems(items) {`;

const helperReplacement = `function safeNodeItems(name) {
  try {
    return $items(name) || [];
  } catch {
    return [];
  }
}

function readDirectInputItems() {
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

  if (name === "Compose (1)") {
    return items.filter((item) => isCompose1MediaItem((item && item.json) || {}));
  }

  if (name === "Upload Main Media") {
    return items.filter((item) => isMainUploadItem((item && item.json) || {}));
  }

  if (name === "Aggregate (2)") {
    return items.filter((item) => isAggregate2Item((item && item.json) || {}));
  }

  return [];
}

function preferDirectItems(name, directItems) {
  const direct = selectDirectNodeItems(name, directItems);
  return direct.length ? direct : safeNodeItems(name);
}

function flattenFrameCandidateItems(items) {`;

code = replaceOnce(code, helperNeedle, helperReplacement, 'Compose (2) direct input helpers');

const flattenNeedle = `    if (Array.isArray(j.frameCandidates)) arrays.push(...j.frameCandidates);
    if (Array.isArray(j.technicalFrameCandidates)) arrays.push(...j.technicalFrameCandidates);
    if (j.candidate && typeof j.candidate === "object") arrays.push(j.candidate);`;

const flattenReplacement = `    if (Array.isArray(j.frameCandidates)) arrays.push(...j.frameCandidates.flat());
    if (Array.isArray(j.technicalFrameCandidates)) arrays.push(...j.technicalFrameCandidates.flat());
    if (Array.isArray(j.candidate)) arrays.push(...j.candidate.flat());
    else if (j.candidate && typeof j.candidate === "object") arrays.push(j.candidate);`;

code = replaceOnce(code, flattenNeedle, flattenReplacement, 'Compose (2) aggregate frame flattening');

const mainNeedle = `// NÃO adicionar aqui:
// const parseFrameItems = $items("Parse Frame Analysis JSON")
const aggregate2Items = safeNodeItems("Aggregate (2)");
const parsedFrameItems = safeNodeItems("Parse Frame Analysis JSON");
const uploadedFrameItems = safeNodeItems("Attach Uploaded Frame Metadata");
const technicalFrameCandidates = flattenFrameCandidateItems(uploadedFrameItems.length ? uploadedFrameItems : aggregate2Items);
const parsedFrameCandidateCount = countParsedFrameCandidates(parsedFrameItems);

let c2Items = safeNodeItems("Compose (1)");
const thumbnailUploadItems = safeNodeItems("Upload File");
const mainUploadItems = safeNodeItems("Upload Main Media");
const uploadItems = mainUploadItems.length ? mainUploadItems : thumbnailUploadItems;
const liviaItems = safeNodeItems("Livia");`;

const mainReplacement = `// Preferir dados do input direto do Merge (3). O fallback por $items()
// fica apenas para execuções isoladas do node no editor.
const directInputItems = readDirectInputItems();
const aggregate2Items = preferDirectItems("Aggregate (2)", directInputItems);
const uploadedFrameItems = aggregate2Items.length ? [] : safeNodeItems("Attach Uploaded Frame Metadata");
const directFrameItems = aggregate2Items.length ? aggregate2Items : uploadedFrameItems;
const technicalFrameCandidates = flattenFrameCandidateItems(directFrameItems);
const parsedFrameItems = technicalFrameCandidates.length ? [] : safeNodeItems("Parse Frame Analysis JSON");
const parsedFrameCandidateCount =
  countParsedFrameCandidates(parsedFrameItems) ||
  technicalFrameCandidates.length;

let c2Items = preferDirectItems("Compose (1)", directInputItems);
const mainUploadItems = preferDirectItems("Upload Main Media", directInputItems);
const thumbnailUploadItems = mainUploadItems.length ? [] : safeNodeItems("Upload File");
const uploadItems = mainUploadItems.length ? mainUploadItems : thumbnailUploadItems;
const liviaItems = preferDirectItems("Livia", directInputItems);`;

code = replaceOnce(code, mainNeedle, mainReplacement, 'Compose (2) main input source');

compose2.parameters.jsCode = code;

const merge3 = getNode('Merge (3)');
merge3.parameters.numberInputs = 4;

workflow.connections['Compose (1)'] = workflow.connections['Compose (1)'] || {};
workflow.connections['Compose (1)'].main = workflow.connections['Compose (1)'].main || [];
workflow.connections['Compose (1)'].main[0] = workflow.connections['Compose (1)'].main[0] || [];

const compose1Targets = workflow.connections['Compose (1)'].main[0];
if (!compose1Targets.some((conn) => conn.node === 'Merge (3)' && conn.type === 'main' && conn.index === 3)) {
  compose1Targets.push({ node: 'Merge (3)', type: 'main', index: 3 });
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n');

console.log(JSON.stringify({
  workflowPath,
  compose2UsesDirectInput: compose2.parameters.jsCode.includes('preferDirectItems("Compose (1)", directInputItems)'),
  merge3Inputs: merge3.parameters.numberInputs,
  compose1ToMerge3: compose1Targets.some((conn) => conn.node === 'Merge (3)' && conn.index === 3),
}, null, 2));
