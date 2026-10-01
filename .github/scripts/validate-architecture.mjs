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

// The monorepo is a gateway and domain-owner repository. The CRM application,
// its Workers/Pages publisher and its data store live in jubenitogarcia/crm.
const legacyCrmRoot = path.join(root, "crm");
const legacyCrmFiles = fs.existsSync(legacyCrmRoot)
  ? fs.readdirSync(legacyCrmRoot, { recursive: true })
    .filter((entry) => fs.statSync(path.join(legacyCrmRoot, entry)).isFile())
  : [];
if (legacyCrmFiles.length) fail("the legacy crm/ application must not exist in the monorepo");
const gateway = fs.readFileSync(path.join(root, "api/src/router.js"), "utf8");
if (!gateway.includes("isCrmCoreRoute") || !gateway.includes("crmCoreHandler")) {
  fail("the API gateway must retain the explicit external /crm/* mount");
}
const catalogService = fs.readFileSync(path.join(root, "integration/atendimento/commercial-catalog/server.mjs"), "utf8");
if (!catalogService.includes("/api/atendimento/internal/commercial/catalog")) {
  fail("Atendimento must expose the versioned commercial catalog without the CRM runtime");
}

const lifecycleUnits = [
  "messaging-whatsapp.service",
  "booking.service",
  "cloudflare-runtime.service",
  "atendimento-commercial-catalog.service",
];
for (const unit of lifecycleUnits) {
  const source = fs.readFileSync(path.join(root, "ops/runtime/units", unit), "utf8");
  if (!/^PrivateTmp=true$/m.test(source)) fail(`${unit} must retain a private temporary namespace`);
  if (/^ReadWritePaths=.*__TMP_ROOT__/m.test(source)) {
    fail(`${unit} cannot bind __TMP_ROOT__ while PrivateTmp hides the host /var/tmp tree`);
  }
}

if (process.exitCode === undefined) process.stdout.write("Architecture contract validation OK.\n");
