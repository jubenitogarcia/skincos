#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;

if (!inputPath) {
  console.error('Usage: node scripts/patch-livia-operational-hardening.js <input.json> [output.json]');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function getNode(name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) fail(`Node not found: ${name}`);
  return node;
}

function replaceExact(haystack, needle, replacement, label) {
  if (!haystack.includes(needle)) fail(`Missing code block: ${label}`);
  return haystack.replace(needle, replacement);
}

const writeFile = getNode('Write File');
const optimize = getNode('Optimize');
const wait = getNode('Wait');
const prepareRequest = getNode('Prepare Request');
const compose3 = getNode('Compose (3)');

workflow.staticData ||= {};
if (workflow.staticData && typeof workflow.staticData === 'object') {
  workflow.staticData.global ||= {};
  if (workflow.staticData.global && typeof workflow.staticData.global === 'object') {
    delete workflow.staticData.global.__pr;
  }
}

writeFile.parameters ||= {};
writeFile.parameters.fileName = `={{ (() => {
  const tmpDir = $vars.LIVIA_TMP_DIR || ${JSON.stringify(runtimePaths.tmpDir)};
  const rawName = String($("Download File").item.json.name || "");
  const rawMime = String($("Download File").item.json.mimeType || "").toLowerCase();
  const rawId = String($("Download File").item.json.id || $("Compose (1)").item.json.id || "");

  function safeBase(value) {
    const raw = String(value || "").replace(/^dt:/, "").split("/").pop().replace(/\\.[^.]+$/, "");
    const cleaned = raw.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "media";
  }

  function safeExt(name, mime) {
    const fromName = String(name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
    const allowed = new Set(["mp4", "mov", "m4v", "webm", "mkv", "jpg", "jpeg", "png", "webp", "heic"]);
    if (allowed.has(fromName)) return "." + fromName;
    if (mime.startsWith("video/")) return ".mp4";
    if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
    if (mime.includes("png")) return ".png";
    if (mime.includes("webp")) return ".webp";
    return ".bin";
  }

  const nameBase = safeBase(rawName);
  const idSuffix = safeBase(rawId).slice(-8);
  const base = idSuffix ? \`\${nameBase}_\${idSuffix}\` : nameBase;
  const ext = safeExt(rawName, rawMime);
  return \`\${tmpDir}/\${base}_temp\${ext}\`;
})() }}`;

optimize.parameters ||= {};
optimize.parameters.command = `={{ 
  (() => {
    const isVideo = String($("Download File").item.json.mimeType || "").toLowerCase().startsWith("video");
    const inputFile = String($json.fileName || "");

    const lastSlash = inputFile.lastIndexOf("/");
    const dir = lastSlash >= 0 ? inputFile.substring(0, lastSlash) : "";
    const file = lastSlash >= 0 ? inputFile.substring(lastSlash + 1) : inputFile;

    const parts = file.split(".");
    if (parts.length > 1) parts.pop();
    const base = parts.join(".") || file;
    const outputBase = base.endsWith("_temp") ? base.slice(0, -5) : base;
    const outputFile = isVideo ? \`\${outputBase}.mp4\` : \`\${outputBase}.jpg\`;
    const payload = { inputFile, outputFile: \`\${dir}/\${outputFile}\`, isVideo };

    return \`node <<'NODE'
const { spawnSync } = require('child_process');

const payload = \${JSON.stringify(payload)};
const args = payload.isVideo
  ? ['-y', '-i', payload.inputFile, '-vf', 'scale=-2:1080', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', payload.outputFile]
  : ['-y', '-i', payload.inputFile, '-vf', 'scale=1440:-2', '-q:v', '4', payload.outputFile];

const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
NODE\`;
  })()
}}`;

wait.parameters ||= {};
wait.parameters.amount = `={{ Math.max(1, Math.min(120, Number($json.waitSeconds || 15))) }}`;

let prepareCode = prepareRequest.parameters.jsCode;

if (!prepareCode.includes('function sanitizeHttpEnvelope')) {
  prepareCode = replaceExact(
    prepareCode,
    `const execId = String($execution?.id ?? "noexec");
const sd = $getWorkflowStaticData("global");

sd.__pr = sd.__pr || {};
sd.__pr[execId] = sd.__pr[execId] || { queue: [], byRun: {} };
const state = sd.__pr[execId];

function enqueue(job) { state.queue.push(job); }
function dequeue() { return state.queue.shift() || null; }
function saveRun(runIndex, httpEnvelope) { state.byRun[String(runIndex)] = httpEnvelope; }
function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }
`,
    `const execId = String($execution?.id ?? "noexec");
const sd = $getWorkflowStaticData("global");

function sanitizeHttpEnvelope(httpEnvelope) {
  const env = httpEnvelope && typeof httpEnvelope === "object" ? httpEnvelope : {};
  const body = getHttpBody(env);
  const headers = normObj(env.headers || {});
  const contentType = str(headers["content-type"] || headers["Content-Type"] || "", "");

  return removeNulls({
    statusCode: env.statusCode,
    statusMessage: env.statusMessage,
    headers: contentType ? { "content-type": contentType } : {},
    body,
  });
}

sd.__pr = normObj(sd.__pr);
for (const key of Object.keys(sd.__pr)) {
  if (key !== execId) delete sd.__pr[key];
}
sd.__pr[execId] = sd.__pr[execId] || { queue: [], byRun: {}, createdAt: new Date().toISOString() };
sd.__pr[execId].queue = Array.isArray(sd.__pr[execId].queue) ? sd.__pr[execId].queue : [];
sd.__pr[execId].byRun = normObj(sd.__pr[execId].byRun);
sd.__pr[execId].updatedAt = new Date().toISOString();
const state = sd.__pr[execId];

function enqueue(job) { state.queue.push(job); }
function dequeue() { return state.queue.shift() || null; }
function saveRun(runIndex, httpEnvelope) { state.byRun[String(runIndex)] = sanitizeHttpEnvelope(httpEnvelope); }
function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }
`,
    'prepare request static data state hardening',
  );
}

prepareRequest.parameters.jsCode = prepareCode;

let compose3Code = compose3.parameters.jsCode;

if (!compose3Code.includes('function cleanupPrepareRequestState')) {
  compose3Code = replaceExact(
    compose3Code,
    `function buildWhatsAppMessage(platforms) {
  const blocks = [
    buildPlatformBlock("INSTAGRAM", platforms.instagram),
    buildPlatformBlock("FACEBOOK", platforms.facebook),
    buildPlatformBlock("THREADS", platforms.threads),
  ];

  return blocks.join("\\n\\n------------------------------\\n\\n");
}
`,
    `function buildWhatsAppMessage(platforms) {
  const blocks = [
    buildPlatformBlock("INSTAGRAM", platforms.instagram),
    buildPlatformBlock("FACEBOOK", platforms.facebook),
    buildPlatformBlock("THREADS", platforms.threads),
  ];

  return blocks.join("\\n\\n------------------------------\\n\\n");
}

function cleanupPrepareRequestState() {
  try {
    const execId = String($execution?.id ?? "noexec");
    const sd = $getWorkflowStaticData("global");
    if (!sd || typeof sd !== "object" || !sd.__pr || typeof sd.__pr !== "object") return;

    delete sd.__pr[execId];
    for (const key of Object.keys(sd.__pr)) {
      const entry = sd.__pr[key];
      const queueIsEmpty = !entry || !Array.isArray(entry.queue) || entry.queue.length === 0;
      if (queueIsEmpty) delete sd.__pr[key];
    }
  } catch {}
}
`,
    'compose3 static data cleanup helper',
  );
}

if (!compose3Code.includes('cleanupPrepareRequestState();')) {
  compose3Code = replaceExact(
    compose3Code,
    `return uniqueFiles.map((f) => {
`,
    `cleanupPrepareRequestState();

return uniqueFiles.map((f) => {
`,
    'compose3 static data cleanup call',
  );
}

compose3.parameters.jsCode = compose3Code;

workflow.meta ||= {};
workflow.meta.codexPatch = {
  name: 'livia-operational-hardening',
  appliedAt: new Date().toISOString(),
  notes: [
    'Prunes Prepare Request staticData cache and stores only sanitized HTTP envelopes.',
    'Makes Wait respect per-job waitSeconds.',
    'Sanitizes temp filenames and executes ffmpeg via argv instead of interpolated shell strings.',
    'Keeps credentials, endpoints, trigger, and publish behavior unchanged.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  waitAmount: wait.parameters.amount,
  staticDataHasPrepareCache: Boolean(workflow.staticData?.global?.__pr),
  writeFileName: writeFile.parameters.fileName,
  optimizeUsesSpawnSync: optimize.parameters.command.includes('spawnSync'),
  prepareUsesSanitizeEnvelope: prepareRequest.parameters.jsCode.includes('sanitizeHttpEnvelope'),
  compose3CleansState: compose3.parameters.jsCode.includes('cleanupPrepareRequestState'),
}, null, 2));
