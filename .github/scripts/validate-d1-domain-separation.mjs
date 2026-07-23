import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const catalogPath = path.join(root, "ops/d1/critical-domain-catalog.json");
const expected = new Set(["identity", "inventory", "finance"]);
const forbiddenTokens = {
  identity: ["crm_", "insumos_", "finance_"],
  inventory: ["crm_", "identity_", "finance_"],
  finance: ["crm_", "identity_", "insumos_"],
};
const errors = [];
const fail = (message) => errors.push(message);
const isString = (value) => typeof value === "string" && value.trim().length > 0;

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
} catch (error) {
  process.stderr.write(`D1 domain separation validation failed: ${error.message}\n`);
  process.exit(1);
}
if (catalog.schemaVersion !== 1) fail("catalog schemaVersion must be 1");
if (catalog.sharedSource?.production !== "skincos-db" || catalog.sharedSource?.staging !== "skincos-db-staging") {
  fail("the shared compatibility source must be declared explicitly");
}
if (!Array.isArray(catalog.domains)) fail("domains must be an array");

const ids = new Set();
const databaseNames = new Set();
const journals = new Set();
const backupBuckets = new Set();
for (const domain of catalog.domains ?? []) {
  const id = domain?.id;
  if (!expected.has(id)) { fail(`unexpected critical domain ${id ?? "<missing>"}`); continue; }
  if (ids.has(id)) fail(`duplicate critical domain ${id}`);
  ids.add(id);
  if (domain.state !== "planned") fail(`${id} must remain planned until its staging cutover is approved`);
  if (!Array.isArray(domain.currentSourceTables) || domain.currentSourceTables.length === 0) fail(`${id} must inventory current source tables`);
  const target = domain.target ?? {};
  const production = `skincos-${id}`;
  const staging = `${production}-staging`;
  if (target.productionDatabase !== production || target.stagingDatabase !== staging) fail(`${id} target database names must be ${production} and ${staging}`);
  for (const database of [target.productionDatabase, target.stagingDatabase]) {
    if (database === "skincos-db" || database === "skincos-db-staging") fail(`${id} cannot target a shared compatibility D1`);
    if (databaseNames.has(database)) fail(`target D1 ${database} is shared by more than one domain`);
    databaseNames.add(database);
  }
  if (!isString(target.productionIdVariable) || !isString(target.stagingIdVariable)) fail(`${id} must declare environment-specific D1 id variables`);
  if (!isString(target.journalTable) || !target.journalTable.endsWith("_release_migrations")) fail(`${id} must declare a dedicated release journal`);
  if (journals.has(target.journalTable)) fail(`journal ${target.journalTable} is shared by more than one domain`);
  journals.add(target.journalTable);
  const migrationsPath = path.join(root, target.migrationDirectory ?? "");
  const migrationFiles = fs.existsSync(migrationsPath) ? fs.readdirSync(migrationsPath).filter((file) => /^\d{4}_.+\.sql$/.test(file)) : [];
  if (migrationFiles.length === 0) fail(`${id} must have versioned target migrations in ${target.migrationDirectory}`);
  for (const file of migrationFiles) {
    const source = fs.readFileSync(path.join(migrationsPath, file), "utf8").toLowerCase();
    for (const token of forbiddenTokens[id]) {
      if (source.includes(token)) fail(`${id} target migration ${file} contains forbidden cross-domain table prefix ${token}`);
    }
  }
  const wrapper = path.join(root, id, "scripts", "apply-isolated-d1-migrations.sh");
  if (!fs.existsSync(wrapper)) fail(`${id} must expose its isolated migration wrapper`);
  const backup = domain.backup ?? {};
  if (!isString(backup.privateEvidenceRoot) || !backup.privateEvidenceRoot.startsWith("C:/CodexRuntime/")) fail(`${id} backup evidence must remain in the private runtime`);
  if (backup.restoreTarget !== "fresh local scratch D1 only before an approved remote recovery") fail(`${id} recovery must restore to scratch before any remote action`);
  for (const bucket of [backup.productionBucket, backup.stagingBucket]) {
    if (!isString(bucket)) { fail(`${id} must declare dedicated backup buckets`); continue; }
    if (backupBuckets.has(bucket)) fail(`backup bucket ${bucket} is shared by more than one domain`);
    backupBuckets.add(bucket);
  }
  const access = domain.access ?? {};
  if (JSON.stringify(access.githubEnvironments) !== JSON.stringify(["staging", "production"])) fail(`${id} requires isolated staging and production environments`);
  if (!Array.isArray(access.writers) || !Array.isArray(access.readers) || !Array.isArray(access.forbidden) || access.forbidden.length < 2) fail(`${id} must declare least-privilege readers, writers and forbidden peers`);
}
for (const id of expected) if (!ids.has(id)) fail(`missing critical domain ${id}`);
if (!fs.existsSync(path.join(root, "scripts/d1/apply-isolated-domain-migrations.sh"))) fail("shared guarded migration runner is missing");

if (errors.length) {
  for (const error of errors) process.stderr.write(`D1 domain separation validation failed: ${error}\n`);
  process.exit(1);
}
process.stdout.write("D1 critical-domain separation validation OK.\n");
