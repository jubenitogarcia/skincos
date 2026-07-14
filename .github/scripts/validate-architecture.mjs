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

if (!process.exitCode) process.stdout.write("Architecture contract validation OK.\n");
