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

const crmRunner = fs.readFileSync(path.join(root, "crm/api/scripts/run.sh"), "utf8");
if (!/dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\.\/\.\./.test(crmRunner)) {
  fail("CRM runner must resolve the repository root three levels above crm/api/scripts");
}
if (crmRunner.includes("/../../../..")) {
  fail("CRM runner escapes the native source release by resolving four parent directories");
}

if (!process.exitCode) process.stdout.write("Architecture contract validation OK.\n");
