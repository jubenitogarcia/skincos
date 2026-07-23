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
  "orb.service",
  "orb-proxy.service",
  "messaging-whatsapp.service",
  "crm.service",
  "booking.service",
  "cloudflare-orb.service",
  "cloudflare-runtime.service",
];
for (const unit of lifecycleUnits) {
  const source = fs.readFileSync(path.join(root, "ops/runtime/units", unit), "utf8");
  if (!/^PrivateTmp=true$/m.test(source)) fail(`${unit} must retain a private temporary namespace`);
  if (/^ReadWritePaths=.*__TMP_ROOT__/m.test(source)) {
    fail(`${unit} cannot bind __TMP_ROOT__ while PrivateTmp hides the host /var/tmp tree`);
  }
}

const orbUnit = fs.readFileSync(path.join(root, "ops/runtime/units/orb.service"), "utf8");
if (!/^Environment=N8N_TMP_DIR=\/tmp$/m.test(orbUnit)) {
  fail("orb.service must use its systemd-private /tmp namespace");
}

for (const unit of ["orb.service", "orb-proxy.service"]) {
  const source = fs.readFileSync(path.join(root, "ops/runtime/units", unit), "utf8");
  const legacyEnvironment = source.lastIndexOf("EnvironmentFile=-__CONFIG_ROOT__/orb-business.env");
  const nativeEnvironment = source.lastIndexOf("EnvironmentFile=__CONFIG_ROOT__/orb-runtime-paths.env");
  if (legacyEnvironment === -1 || nativeEnvironment <= legacyEnvironment) {
    fail(`${unit} must load native Orb paths after the legacy secret environment`);
  }
}

const lifecycleLayout = fs.readFileSync(path.join(root, "scripts/runtime/prepare-lifecycle-layout.sh"), "utf8");
for (const variable of [
  "N8N_RESTRICT_FILE_ACCESS_TO=/tmp",
  "META_REVIEW_STORE_PATH=$STATE_ROOT/orb/meta-review-store.json",
  "N8N_USER_FOLDER=$STATE_ROOT/orb/n8n-home",
  "N8N_STORAGE_PATH=$STATE_ROOT/orb/n8n-home/.n8n/storage",
  "N8N_LOG_FILE_LOCATION=$LOG_ROOT/orb/n8n.log",
]) {
  if (!lifecycleLayout.includes(variable)) fail(`native Orb path overlay is missing ${variable}`);
}

const crmRunner = fs.readFileSync(path.join(root, "crm/api/scripts/run.sh"), "utf8");
if (!/dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\.\/\.\./.test(crmRunner)) {
  fail("CRM runner must resolve the repository root three levels above crm/api/scripts");
}
if (crmRunner.includes("/../../../..")) {
  fail("CRM runner escapes the native source release by resolving four parent directories");
}

const crmPagesWorkflow = fs.readFileSync(path.join(root, ".github/workflows", "deploy-crm-pages.yml"), "utf8");
if (!/^  group: deploy-crm-pages-\$\{\{ github\.ref_name \}\}$/m.test(crmPagesWorkflow)) {
  fail("deploy-crm-pages.yml must isolate concurrency by environment");
}
if (!/^  cancel-in-progress: false$/m.test(crmPagesWorkflow)) {
  fail("deploy-crm-pages.yml must serialize an in-flight deployment");
}

if (!process.exitCode) process.stdout.write("Architecture contract validation OK.\n");
