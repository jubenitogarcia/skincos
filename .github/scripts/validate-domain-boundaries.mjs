import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const policyPath = path.join(root, "shared/domain-boundaries.json");
const governedRoots = new Set([
  "ads", "api", "booking", "clientes-readonly", "crm", "finance", "identity", "integration", "inventory", "messaging",
  "ops", "orb", "platform", "service", "shared", "social", "website", "workforce",
]);
const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py"]);
const ignoredDirectories = new Set([".git", ".venv", "node_modules", "dist", "build", "coverage", ".next", "vendor"]);
const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
const toPosix = (value) => value.split(path.sep).join("/");
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolutePath));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(absolutePath);
  }
  return files;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function staticImports(source) {
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[^'";]*?\s+from\s+)["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const imports = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      const key = `${match.index}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push({ specifier, line: lineAt(source, match.index) });
    }
  }
  return imports;
}

function pythonImports(source) {
  const imports = [];
  const pattern = /^\s*(?:from|import)\s+([a-zA-Z_][\w.]*)/gm;
  for (const match of source.matchAll(pattern)) {
    const rootName = String(match[1]).split(".")[0];
    if (governedRoots.has(rootName)) imports.push({ specifier: rootName, line: lineAt(source, match.index), python: true });
  }
  return imports;
}

function pathMatches(candidate, rule) {
  return rule.endsWith("/**") ? candidate.startsWith(rule.slice(0, -2)) : candidate === rule;
}

function resolveTarget(sourcePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const absoluteTarget = path.resolve(path.dirname(sourcePath), specifier);
  const relativeTarget = toPosix(path.relative(root, absoluteTarget));
  if (relativeTarget.startsWith("../") || relativeTarget === "..") return null;
  const targetRoot = relativeTarget.split("/")[0];
  return governedRoots.has(targetRoot) ? { targetRoot, relativeTarget } : null;
}

let policy;
try {
  policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
} catch (error) {
  process.stderr.write(`domain boundary validation failed: cannot parse shared/domain-boundaries.json: ${error.message}\n`);
  process.exit(1);
}

if (policy.schemaVersion !== 1 || !Array.isArray(policy.contracts) || !Array.isArray(policy.recommendedContracts) || !Array.isArray(policy.legacyDirectImports) || !Array.isArray(policy.statefulServiceBindings)) {
  fail("shared/domain-boundaries.json must declare schemaVersion 1, contracts, recommendedContracts, legacyDirectImports and statefulServiceBindings");
}

const contractsById = new Map();
for (const contract of policy.contracts ?? []) {
  if (!contract || !nonEmptyString(contract.id) || !["contract", "sdk", "adapter"].includes(contract.kind) || !Array.isArray(contract.paths) || !Array.isArray(contract.consumers) || !nonEmptyString(contract.owner)) {
    fail("each shared contract must declare id, kind, paths, consumers and owner");
    continue;
  }
  if (contractsById.has(contract.id)) fail(`duplicate shared contract id ${contract.id}`);
  if (contract.providesFor !== undefined && (
    contract.kind !== "adapter" || !nonEmptyString(contract.providesFor) || !governedRoots.has(contract.providesFor)
  )) {
    fail(`contract ${contract.id} providesFor must name a governed domain and is only valid for an adapter`);
  }
  contractsById.set(contract.id, contract);
  for (const contractPath of contract.paths) {
    if (!nonEmptyString(contractPath) || !contractPath.startsWith("shared/")) {
      fail(`contract ${contract.id} path must stay under shared/: ${contractPath}`);
      continue;
    }
    const target = path.join(root, contractPath.replace(/\/\*\*$/, ""));
    if (!fs.existsSync(target)) fail(`contract ${contract.id} points to missing path ${contractPath}`);
  }
}

const recommendations = new Map();
for (const recommendation of policy.recommendedContracts ?? []) {
  if (!recommendation || !nonEmptyString(recommendation.from) || !nonEmptyString(recommendation.to) || !nonEmptyString(recommendation.contractId) || !nonEmptyString(recommendation.path) || !nonEmptyString(recommendation.usage)) {
    fail("each recommended contract must declare from, to, contractId, path and usage");
    continue;
  }
  if (!contractsById.has(recommendation.contractId)) fail(`recommendation ${recommendation.from} -> ${recommendation.to} references unknown contract ${recommendation.contractId}`);
  recommendations.set(`${recommendation.from}:${recommendation.to}`, recommendation);
}

const legacyImports = new Map();
for (const legacy of policy.legacyDirectImports ?? []) {
  if (!legacy || !nonEmptyString(legacy.from) || !nonEmptyString(legacy.specifier) || !nonEmptyString(legacy.replacementContractId) || !/^\d{4}-\d{2}-\d{2}$/.test(legacy.deadline ?? "") || !nonEmptyString(legacy.reason)) {
    fail("each legacy direct import must declare from, specifier, replacementContractId, deadline and reason");
    continue;
  }
  if (!contractsById.has(legacy.replacementContractId)) fail(`legacy import ${legacy.from} references unknown contract ${legacy.replacementContractId}`);
  const key = `${legacy.from}:${legacy.specifier}`;
  if (legacyImports.has(key)) fail(`duplicate legacy direct import ${key}`);
  legacyImports.set(key, legacy);
}

const statefulServiceBindings = new Map();
for (const binding of policy.statefulServiceBindings ?? []) {
  const orderedPair = (value, first, second) => Array.isArray(value)
    && value.length === 2
    && value[0] === first
    && value[1] === second;
  const validVerification = Array.isArray(binding?.verification)
    && binding.verification.length > 0
    && binding.verification.every((check) =>
      nonEmptyString(check?.path)
      && !path.isAbsolute(check.path)
      && !check.path.split(/[\\/]/).includes("..")
      && Array.isArray(check?.mustContain)
      && check.mustContain.length > 0
      && check.mustContain.every(nonEmptyString),
    );
  const validService = binding?.service
    && nonEmptyString(binding.service.production)
    && nonEmptyString(binding.service.staging);
  if (!binding || !nonEmptyString(binding.id) || !governedRoots.has(binding.consumer) || !governedRoots.has(binding.producer)
    || binding.consumer === binding.producer || !nonEmptyString(binding.serviceBinding) || !validService
    || !nonEmptyString(binding.entrypoint) || !nonEmptyString(binding.rpcMethod) || !nonEmptyString(binding.dtoContract)
    || !nonEmptyString(binding.healthCapability) || !/^\d{4}-\d{2}-\d{2}$/.test(binding.reviewBy ?? "")
    || !nonEmptyString(binding.reviewTrigger) || !nonEmptyString(binding.retirementCondition)
    || !orderedPair(binding.deployOrder, binding.producer, binding.consumer)
    || !orderedPair(binding.rollbackOrder, binding.consumer, binding.producer)
    || !validVerification) {
    fail("each stateful service binding must declare consumer/producer, service, binding, entrypoint, RPC DTO/capability, inverse deploy/rollback order, review date/retirement conditions and source verification");
    continue;
  }
  if (statefulServiceBindings.has(binding.id)) {
    fail(`duplicate stateful service binding id ${binding.id}`);
    continue;
  }
  statefulServiceBindings.set(binding.id, binding);
  const today = new Date().toISOString().slice(0, 10);
  if (today > binding.reviewBy) {
    fail(`stateful service binding ${binding.id} review expired on ${binding.reviewBy}; renew or retire the bridge with a proven state migration plan`);
  }
  for (const check of binding.verification) {
    const verificationPath = path.join(root, check.path);
    if (!fs.existsSync(verificationPath)) {
      fail(`stateful service binding ${binding.id} points to missing verification path ${check.path}`);
      continue;
    }
    const source = fs.readFileSync(verificationPath, "utf8");
    for (const fragment of check.mustContain) {
      if (!source.includes(fragment)) {
        fail(`stateful service binding ${binding.id} verification path ${check.path} is missing required fragment ${JSON.stringify(fragment)}`);
      }
    }
  }
}

const usedLegacyImports = new Set();
for (const domain of governedRoots) {
  const domainPath = path.join(root, domain);
  if (!fs.existsSync(domainPath)) continue;
  for (const sourcePath of walk(domainPath)) {
    const relativeSource = toPosix(path.relative(root, sourcePath));
    const sourceRoot = relativeSource.split("/")[0];
    const source = fs.readFileSync(sourcePath, "utf8");
    const imports = [
      ...staticImports(source),
      ...(path.extname(sourcePath) === ".py" ? pythonImports(source) : []),
    ];

    for (const imported of imports) {
      const target = imported.python
        ? { targetRoot: imported.specifier, relativeTarget: imported.specifier }
        : resolveTarget(sourcePath, imported.specifier);
      if (!target || target.targetRoot === sourceRoot) continue;

      if (target.targetRoot === "shared") {
        const allowedContract = [...contractsById.values()].find((contract) =>
          contract.paths.some((contractPath) => pathMatches(target.relativeTarget, contractPath)) &&
          (contract.consumers.includes("*") || contract.consumers.includes(sourceRoot)),
        );
        if (!allowedContract) {
          fail(`${relativeSource}:${imported.line}: ${sourceRoot} imports ${target.relativeTarget} without an authorized shared contract. Add a contract/SDK/adapter to shared/domain-boundaries.json or use an existing shared boundary.`);
        }
        continue;
      }

      const legacyKey = `${relativeSource}:${imported.specifier}`;
      const legacy = legacyImports.get(legacyKey);
      const authorizedAdapter = sourceRoot === "shared" && [...contractsById.values()].find((contract) =>
        contract.kind === "adapter" &&
        contract.providesFor === target.targetRoot &&
        contract.paths.some((contractPath) => pathMatches(relativeSource, contractPath)),
      );
      const recommendation = recommendations.get(`${sourceRoot}:${target.targetRoot}`);
      const recommendationText = recommendation
        ? `Use ${recommendation.contractId} (${recommendation.path}): ${recommendation.usage}.`
        : "Define the required contract, SDK or adapter under shared/ before crossing this boundary.";

      if (authorizedAdapter) {
        continue;
      } else if (sourceRoot === "shared" && !legacy) {
        fail(`${relativeSource}:${imported.line}: shared must not import ${target.targetRoot} implementation ${target.relativeTarget}. Move the neutral projection/adapter into shared. ${recommendationText}`);
      } else if (!legacy) {
        fail(`${relativeSource}:${imported.line}: forbidden direct implementation import ${sourceRoot} -> ${target.targetRoot} (${imported.specifier}). ${recommendationText}`);
      } else {
        usedLegacyImports.add(legacyKey);
        const today = new Date().toISOString().slice(0, 10);
        const contract = contractsById.get(legacy.replacementContractId);
        const message = `${relativeSource}:${imported.line}: legacy direct import ${sourceRoot} -> ${target.targetRoot} (${imported.specifier}) expires ${legacy.deadline}. Replace with ${contract.id}. ${legacy.reason}`;
        if (today > legacy.deadline) fail(message);
        else warn(message);
      }
    }
  }
}

for (const [legacyKey, legacy] of legacyImports) {
  if (!usedLegacyImports.has(legacyKey)) fail(`legacy direct import ${legacyKey} is no longer present; remove it from shared/domain-boundaries.json`);
}

for (const warning of warnings) process.stdout.write(`::warning file=${warning.split(":")[0]}::${warning}\n`);
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`domain boundary validation failed: ${error}\n`);
  process.exit(1);
}
process.stdout.write(`Domain boundary validation OK (${warnings.length} tracked legacy import${warnings.length === 1 ? "" : "s"}).\n`);
