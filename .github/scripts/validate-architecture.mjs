import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const fail = (message) => {
  process.stderr.write(`architecture validation failed: ${message}\n`);
  process.exitCode = 1;
};

const registry = readJson("platform/cloudflare/resource-registry.json");
const catalog = readJson("scripts/catalog.json");

if (registry.schemaVersion !== 1 || !registry.gateway?.productionHostname) {
  fail("Cloudflare registry must declare schemaVersion 1 and a production hostname");
}

const resourceIds = new Set();
const routes = new Set();
for (const resource of registry.resources ?? []) {
  if (!resource.id || !resource.owner || !Array.isArray(resource.routes)) {
    fail("every Cloudflare resource needs id, owner and routes");
    continue;
  }
  if (resourceIds.has(resource.id)) fail(`duplicate resource id ${resource.id}`);
  resourceIds.add(resource.id);
  for (const route of resource.routes) {
    if (!route.startsWith("/")) fail(`route ${route} must start with /`);
    if (routes.has(route)) fail(`duplicate route ${route}`);
    routes.add(route);
  }
}

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.owners) || catalog.owners.length === 0) {
  fail("script catalog must declare schemaVersion 1 and at least one owner");
}

const map = fs.readFileSync(path.join(root, "docs/architecture/target-domain-map.md"), "utf8");
for (const rootName of ["api", "booking", "integration", "messaging", "workforce", "shared", "platform", "ops", "scripts"]) {
  if (!map.includes(`\`${rootName}\``)) fail(`target domain map is missing ${rootName}`);
}

const lifecycleUnits = [
  "messaging-whatsapp.service",
  "crm.service",
  "booking.service",
  "cloudflare-runtime.service",
  "crm-jobs.service",
];
for (const unit of lifecycleUnits) {
  const source = fs.readFileSync(path.join(root, "ops/runtime/units", unit), "utf8");
  if (!/^PrivateTmp=true$/m.test(source)) fail(`${unit} must retain a private temporary namespace`);
  if (/^ReadWritePaths=.*__TMP_ROOT__/m.test(source)) {
    fail(`${unit} cannot bind __TMP_ROOT__ while PrivateTmp hides the host /var/tmp tree`);
  }
}

const crmRunner = fs.readFileSync(path.join(root, "crm/api/scripts/run.sh"), "utf8");
if (!/dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\.\/\.\./.test(crmRunner)) {
  fail("CRM runner must resolve the repository root three levels above crm/api/scripts");
}
if (crmRunner.includes("/../../../..")) {
  fail("CRM runner escapes the native source release by resolving four parent directories");
}

// The HTTP composition root and the continuous-job composition root are
// intentionally disjoint. Keep this check close to the architecture gate so a
// future refactor cannot silently reintroduce a background worker on request
// startup.
const crmHttp = fs.readFileSync(path.join(root, "crm/api/server.js"), "utf8");
if (/continuous-worker|startHarmoniaWorker|createContinuousWorkerService|createWorkerHealthServer/.test(crmHttp)) {
  fail("crm/api/server.js must never import or start the continuous worker");
}
// Textual checks alone are easy to evade by renaming an import. Walk the
// relative ESM import graph from the HTTP composition root and reject every
// worker composition/entrypoint, including an indirect dependency.
const workerOnlyModules = new Set([
  path.resolve(root, "crm/api/continuous-worker.js"),
  path.resolve(root, "crm/api/server/workers/continuousService.js"),
  path.resolve(root, "crm/api/server/harmonia/worker.js"),
]);
const resolveRelativeModule = (fromFile, request) => {
  const base = path.resolve(path.dirname(fromFile), request);
  for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};
const relativeImports = (source) => {
  const imports = new Set();
  for (const pattern of [
    /\bimport\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return imports;
};
const httpReachableModules = new Set();
const pendingHttpModules = [path.resolve(root, "crm/api/server.js")];
while (pendingHttpModules.length) {
  const current = pendingHttpModules.pop();
  if (!current || httpReachableModules.has(current)) continue;
  httpReachableModules.add(current);
  if (workerOnlyModules.has(current)) {
    fail(`CRM HTTP import graph reaches worker-only module ${path.relative(root, current)}`);
    continue;
  }
  const source = fs.readFileSync(current, "utf8");
  for (const request of relativeImports(source)) {
    const resolved = resolveRelativeModule(current, request);
    if (resolved) pendingHttpModules.push(resolved);
  }
}
const continuousRunner = fs.readFileSync(path.join(root, "scripts/crm/run-continuous-workers-linux.sh"), "utf8");
if (/npm\s+install/.test(continuousRunner) || /(^|\n)\s*(source|\.)\s+.*crm(?:-jobs)?\.env/.test(continuousRunner)) {
  fail("continuous worker launcher must not install dependencies or source shell from runtime variables");
}
const jobsUnit = fs.readFileSync(path.join(root, "ops/runtime/units/crm-jobs.service"), "utf8");
if (!/^Environment=CRM_CONTINUOUS_WORKER_HOST=127\.0\.0\.1$/m.test(jobsUnit)) {
  fail("crm-jobs.service must bind health only to loopback");
}
if (!/^Environment=CRM_CONTINUOUS_JOBS_STATE_PATH=__STATE_ROOT__\/crm\/continuous-jobs-state\.json$/m.test(jobsUnit)) {
  fail("crm-jobs.service must declare the durable continuous-jobs checkpoint");
}
for (const relativePath of ["crm/api/server/workers/jobRunner.js", "crm/api/server/workers/clientesJobs.js"]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  if (/node:child_process|\bspawn\b|\beval\s*\(/.test(source)) {
    fail(`${relativePath} must not execute arbitrary shell commands`);
  }
}

const crmPagesWorkflow = fs.readFileSync(path.join(root, ".github/workflows", "deploy-crm-pages.yml"), "utf8");
if (
  !/^concurrency:\r?\n\s+group:\s+ponto-surface-mutation\r?\n\s+cancel-in-progress:\s+false/m.test(crmPagesWorkflow)
) {
  fail("deploy-crm-pages.yml must serialize every preview, general, and governed Ponto mutation with the global surface mutex");
}

if (!process.exitCode) process.stdout.write("Architecture contract validation OK.\n");
