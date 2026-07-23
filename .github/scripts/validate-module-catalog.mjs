import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const catalogPath = path.join(root, "docs/architecture/module-catalog.json");
const graphPath = path.join(root, "docs/architecture/module-dependency-graph.mmd");
const maturityStates = new Set(["experimental", "staging", "pilot", "operational", "critical"]);
const requiredFields = [
  "id",
  "maturity",
  "owner",
  "dataOwnership",
  "dependencies",
  "services",
  "datastores",
  "routes",
  "healthChecks",
  "testCommands",
  "featureFlag",
  "fallback",
  "slo",
  "rollback",
];
const governedModuleIds = [
  "ads", "api", "booking", "crm", "finance", "identity", "integration", "inventory", "messaging",
  "ops", "orb", "platform", "service", "shared", "social", "website", "workforce",
];

const errors = [];
const fail = (message) => errors.push(message);
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const graphNodeId = (moduleId) => `module_${moduleId.replaceAll(/[^a-zA-Z0-9]/g, "_")}`;
const graphLabel = (module) => `${module.id}\\n${module.maturity}`;

function validateStringArray(value, label, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => !nonEmptyString(item))) {
    fail(`${label} must be an array of ${min ? "non-empty" : "valid"} strings`);
  }
}

function generateGraph(modules) {
  const lines = [
    "%% Generated from docs/architecture/module-catalog.json; do not edit by hand.",
    "flowchart LR",
  ];

  for (const module of [...modules].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  ${graphNodeId(module.id)}[\"${graphLabel(module)}\"]`);
  }

  for (const module of [...modules].sort((a, b) => a.id.localeCompare(b.id))) {
    const dependencies = module.dependencies ?? {};
    for (const dependency of [...(dependencies.hard ?? [])].sort()) {
      lines.push(`  ${graphNodeId(module.id)} -->|hard| ${graphNodeId(dependency)}`);
    }
    for (const dependency of [...(dependencies.optional ?? [])].sort()) {
      lines.push(`  ${graphNodeId(module.id)} -. optional .-> ${graphNodeId(dependency)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function findCycle(modulesById) {
  const states = new Map();
  const stack = [];

  const visit = (moduleId) => {
    states.set(moduleId, "visiting");
    stack.push(moduleId);
    const module = modulesById.get(moduleId);
    const dependencies = module.dependencies ?? {};
    for (const dependency of [...(dependencies.hard ?? []), ...(dependencies.optional ?? [])]) {
      if (!modulesById.has(dependency)) continue;
      if (states.get(dependency) === "visiting") {
        return [...stack.slice(stack.indexOf(dependency)), dependency];
      }
      if (states.get(dependency) !== "visited") {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    states.set(moduleId, "visited");
    return null;
  };

  for (const moduleId of [...modulesById.keys()].sort()) {
    if (states.get(moduleId) !== "visited") {
      const cycle = visit(moduleId);
      if (cycle) return cycle;
    }
  }
  return null;
}

let catalog;
try {
  catalog = readJson(catalogPath);
} catch (error) {
  process.stderr.write(`module catalog validation failed: cannot parse ${path.relative(root, catalogPath)}: ${error.message}\n`);
  process.exit(1);
}

if (catalog.schemaVersion !== 2) fail("schemaVersion must be 2");
if (JSON.stringify(catalog.maturityModel?.states) !== JSON.stringify(["experimental", "staging", "pilot", "operational", "critical"])) {
  fail("maturityModel must declare the official states in order");
}
if (!Array.isArray(catalog.requiredModuleIds) || catalog.requiredModuleIds.length === 0) {
  fail("requiredModuleIds must be a non-empty array");
}
if (!Array.isArray(catalog.authorizedDependencies)) {
  fail("authorizedDependencies must be an array");
}
if (!Array.isArray(catalog.modules) || catalog.modules.length === 0) {
  fail("modules must be a non-empty array");
}

const modulesById = new Map();
for (const module of catalog.modules ?? []) {
  if (!module || typeof module !== "object") {
    fail("each module must be an object");
    continue;
  }
  for (const field of requiredFields) {
    if (!(field in module)) fail(`module ${module.id ?? "<unknown>"} is missing ${field}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(module.id ?? "")) fail(`module id ${module.id ?? "<unknown>"} must be lowercase kebab-case`);
  if (modulesById.has(module.id)) fail(`duplicate module id ${module.id}`);
  modulesById.set(module.id, module);
  if (!maturityStates.has(module.maturity)) fail(`module ${module.id} has unsupported maturity ${module.maturity}`);
  if (!module.owner || !nonEmptyString(module.owner.primary)) fail(`module ${module.id} must declare owner.primary`);
  validateStringArray(module.dataOwnership, `module ${module.id}.dataOwnership`);
  validateStringArray(module.services, `module ${module.id}.services`);
  validateStringArray(module.datastores, `module ${module.id}.datastores`);
  validateStringArray(module.routes, `module ${module.id}.routes`);
  validateStringArray(module.testCommands, `module ${module.id}.testCommands`);
  if (!Array.isArray(module.healthChecks) || module.healthChecks.length === 0 || module.healthChecks.some((item) => !item || !nonEmptyString(item.name) || !nonEmptyString(item.command))) {
    fail(`module ${module.id}.healthChecks must contain name and command`);
  }
  if (!module.featureFlag || !nonEmptyString(module.featureFlag.key) || !nonEmptyString(module.featureFlag.defaultState) || !nonEmptyString(module.featureFlag.enforcement)) {
    fail(`module ${module.id}.featureFlag must declare key, defaultState and enforcement`);
  }
  if (!nonEmptyString(module.fallback)) fail(`module ${module.id}.fallback must be a non-empty string`);
  if (!module.slo || !nonEmptyString(module.slo.availability) || !nonEmptyString(module.slo.latency) || !nonEmptyString(module.slo.measurement)) {
    fail(`module ${module.id}.slo must declare availability, latency and measurement`);
  }
  if (!nonEmptyString(module.rollback)) fail(`module ${module.id}.rollback must be a non-empty string`);
  if (!module.dependencies || typeof module.dependencies !== "object") {
    fail(`module ${module.id}.dependencies must be an object`);
    continue;
  }
  for (const kind of ["hard", "optional"]) {
    validateStringArray(module.dependencies[kind], `module ${module.id}.dependencies.${kind}`, { min: 0 });
  }
}

const requiredIds = new Set(catalog.requiredModuleIds ?? []);
if (requiredIds.size !== (catalog.requiredModuleIds ?? []).length) fail("requiredModuleIds cannot contain duplicates");
for (const moduleId of governedModuleIds) {
  if (!requiredIds.has(moduleId)) fail(`requiredModuleIds is missing governed module ${moduleId}`);
}
for (const moduleId of requiredIds) {
  if (!governedModuleIds.includes(moduleId)) fail(`requiredModuleIds includes unknown governed module ${moduleId}`);
}
const targetDomainMap = fs.readFileSync(path.join(root, "docs/architecture/target-domain-map.md"), "utf8");
for (const moduleId of governedModuleIds) {
  if (!targetDomainMap.includes(`| \`${moduleId}\` |`)) fail(`target domain map does not define governed module ${moduleId}`);
}
for (const moduleId of requiredIds) {
  if (!modulesById.has(moduleId)) fail(`required module ${moduleId} is missing`);
}
for (const moduleId of modulesById.keys()) {
  if (!requiredIds.has(moduleId)) fail(`module ${moduleId} is not listed in requiredModuleIds`);
}

const allowedEdges = new Set();
for (const edge of catalog.authorizedDependencies ?? []) {
  if (!edge || !nonEmptyString(edge.from) || !nonEmptyString(edge.to) || !["hard", "optional"].includes(edge.kind)) {
    fail("authorizedDependencies entries must declare from, to and kind (hard or optional)");
    continue;
  }
  const key = `${edge.from}:${edge.kind}:${edge.to}`;
  if (allowedEdges.has(key)) fail(`duplicate authorized dependency ${key}`);
  allowedEdges.add(key);
}

const declaredEdges = new Set();
for (const module of modulesById.values()) {
  const seenDependencies = new Set();
  for (const kind of ["hard", "optional"]) {
    for (const dependency of module.dependencies?.[kind] ?? []) {
      const dependencyKey = `${module.id}:${dependency}`;
      if (seenDependencies.has(dependencyKey)) fail(`module ${module.id} declares ${dependency} more than once`);
      seenDependencies.add(dependencyKey);
      if (dependency === module.id) fail(`module ${module.id} cannot depend on itself`);
      if (!modulesById.has(dependency)) fail(`module ${module.id} depends on unknown module ${dependency}`);
      const edge = `${module.id}:${kind}:${dependency}`;
      declaredEdges.add(edge);
      if (!allowedEdges.has(edge)) {
        fail(`unauthorized ${kind} dependency ${module.id} -> ${dependency}`);
      }
    }
  }
}

for (const edge of allowedEdges) {
  const [from, kind, to] = edge.split(":");
  if (!modulesById.has(from) || !modulesById.has(to)) fail(`authorized dependency ${from} -> ${to} references an unknown module`);
  if (!declaredEdges.has(edge)) fail(`authorized dependency ${from} -> ${to} (${kind}) is not declared by its source module`);
}

const cycle = findCycle(modulesById);
if (cycle) fail(`dependency cycle detected: ${cycle.join(" -> ")}`);

const graph = generateGraph([...modulesById.values()]);
if (process.argv.includes("--print")) process.stdout.write(graph);
if (!process.argv.includes("--print")) {
  try {
    const committedGraph = fs.readFileSync(graphPath, "utf8");
    if (committedGraph !== graph) {
      fail("module-dependency-graph.mmd is stale; regenerate it from the catalog before merging");
    }
  } catch (error) {
    fail(`cannot read generated graph: ${error.message}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`module catalog validation failed: ${error}\n`);
  process.exit(1);
}

if (!process.argv.includes("--print")) process.stdout.write("Module catalog validation OK.\n");
