import crypto from "node:crypto";

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const RISK_LEVELS = Object.freeze(Object.keys(RISK_ORDER));
const CHANGE_STATUS = /^(A|C|D|M|R|T|U|X|B)(\d{0,3})?$/;
const MAX_PATH_LENGTH = 4096;
const MAX_POLICY_PATTERN_LENGTH = 4096;

const FALLBACK_REQUIRED_CHECKS = Object.freeze([
  "diff-check",
  "focal-validation",
  "rollback-plan",
  "exceptional-stop",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, name, { allowEmpty = false, maxLength = 4096 } = {}) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (!allowEmpty && value.trim() === "") throw new Error(`${name} must not be empty`);
  if (value.length > maxLength) throw new Error(`${name} is too long`);
  if ([...value].some((character) => {
    const code = character.codePointAt(0);
    return code === 0 || code < 0x20 || code === 0x7f;
  })) throw new Error(`${name} contains a control character`);
}

export function normalizeRepositoryPath(value, name = "path") {
  assertString(value, name, { maxLength: MAX_PATH_LENGTH });
  let normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`${name} must be repository-relative`);
  }
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (!normalized || normalized === ".") throw new Error(`${name} must identify a file`);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${name} contains an ambiguous path segment`);
  }
  return segments.join("/");
}

function validatePolicyPattern(value, name) {
  assertString(value, name, { maxLength: MAX_POLICY_PATTERN_LENGTH });
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("//")) {
    throw new Error(`${name} must be a repository-relative glob`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new Error(`${name} contains an unsafe path segment`);
  }
  let braceDepth = 0;
  for (const character of normalized) {
    if (character === "{") braceDepth += 1;
    if (character === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) throw new Error(`${name} contains an unbalanced brace`);
    }
  }
  if (braceDepth !== 0) throw new Error(`${name} contains an unbalanced brace`);
  return normalized;
}

function validateStringArray(value, name, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  if (!allowEmpty && value.length === 0) throw new Error(`${name} must not be empty`);
  const normalized = value.map((entry, index) => {
    assertString(entry, `${name}[${index}]`, { maxLength: 512 });
    return entry.trim();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} must not contain duplicates`);
  return normalized;
}

function validatePatternList(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty array`);
  const normalized = value.map((entry, index) => validatePolicyPattern(entry, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} must not contain duplicates`);
  return normalized;
}

function validateRuleList(value, name, { requireId = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty array`);
  const ids = new Set();
  return value.map((rule, index) => {
    if (!isRecord(rule)) throw new Error(`${name}[${index}] must be an object`);
    const id = rule.id;
    if (requireId) {
      assertString(id, `${name}[${index}].id`, { maxLength: 128 });
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`${name}[${index}].id is invalid`);
      if (ids.has(id)) throw new Error(`${name} contains duplicate id: ${id}`);
      ids.add(id);
    }
    validatePatternList(rule.patterns, `${name}[${index}].patterns`);
    return rule;
  });
}

export function validateRiskPolicy(policy) {
  if (!isRecord(policy)) throw new Error("risk policy must be an object");
  if (policy.schemaVersion !== 2) throw new Error("risk policy schemaVersion must be 2");
  if (!RISK_LEVELS.includes(policy.defaultRisk)) throw new Error("risk policy defaultRisk is invalid");
  if (!isRecord(policy.levels)) throw new Error("risk policy levels must be an object");
  for (const level of RISK_LEVELS) {
    const definition = policy.levels[level];
    if (!isRecord(definition)) throw new Error(`risk policy level is missing: ${level}`);
    assertString(definition.label, `risk policy levels.${level}.label`, { maxLength: 128 });
    validateStringArray(definition.requiredChecks, `risk policy levels.${level}.requiredChecks`);
    validateStringArray(definition.skippedChecks, `risk policy levels.${level}.skippedChecks`);
  }
  for (const level of Object.keys(policy.levels)) {
    if (!RISK_LEVELS.includes(level)) throw new Error(`risk policy contains unknown level: ${level}`);
  }

  validateRuleList(policy.surfaces, "risk policy surfaces", { requireId: true });
  for (const [index, surface] of policy.surfaces.entries()) {
    if (typeof surface.releaseInput !== "boolean") throw new Error(`risk policy surfaces[${index}].releaseInput must be boolean`);
  }
  validateRuleList(policy.languageRules, "risk policy languageRules", { requireId: true });
  validateRuleList(policy.classificationRules, "risk policy classificationRules");
  for (const [index, rule] of policy.classificationRules.entries()) {
    if (!RISK_LEVELS.includes(rule.risk)) throw new Error(`risk policy classificationRules[${index}].risk is invalid`);
    assertString(rule.reason, `risk policy classificationRules[${index}].reason`, { maxLength: 512 });
  }
  for (const [key, label] of [
    ["dependencyPatterns", "dependencyPatterns"],
    ["sharedContractPatterns", "sharedContractPatterns"],
    ["productionSensitivePatterns", "productionSensitivePatterns"],
    ["securitySensitivePatterns", "securitySensitivePatterns"],
  ]) validatePatternList(policy[key], `risk policy ${label}`);
  if (policy.releaseSharedInputs !== undefined) validateStringArray(policy.releaseSharedInputs, "risk policy releaseSharedInputs");
  return policy;
}

function normalizeChangeStatus(value, name) {
  assertString(value, name, { maxLength: 4 });
  const match = value.trim().toUpperCase().match(CHANGE_STATUS);
  if (!match) throw new Error(`${name} is invalid`);
  return { code: match[1], score: match[2] || null };
}

function rawChangePaths(entry, code, index) {
  if (Array.isArray(entry.paths)) return entry.paths;
  if (code === "R" || code === "C") {
    return [entry.oldPath ?? entry.from, entry.newPath ?? entry.to];
  }
  return [entry.path ?? entry.newPath ?? entry.to ?? entry.oldPath ?? entry.from];
}

export function normalizeChangedFiles(files) {
  if (!Array.isArray(files)) throw new Error("changed files must be an array");
  const unique = new Map();
  files.forEach((entry, index) => {
    const objectEntry = isRecord(entry) ? entry : { path: entry };
    const { code, score } = normalizeChangeStatus(objectEntry.status ?? "M", `changed files[${index}].status`);
    const paths = rawChangePaths(objectEntry, code, index);
    if (!Array.isArray(paths) || paths.length !== (code === "R" || code === "C" ? 2 : 1)) {
      throw new Error(`changed files[${index}] has an indeterminate path shape`);
    }
    if (paths.some((value) => typeof value !== "string" || value.trim() === "")) {
      throw new Error(`changed files[${index}] has an indeterminate path shape`);
    }
    const normalizedPaths = paths.map((value, pathIndex) => normalizeRepositoryPath(value, `changed files[${index}].paths[${pathIndex}]`));
    if ((code === "R" || code === "C") && normalizedPaths[0] === normalizedPaths[1]) {
      throw new Error(`changed files[${index}] rename/copy paths must differ`);
    }
    const normalized = { status: code, score, paths: normalizedPaths };
    const key = `${code}:${score ?? ""}:${normalizedPaths.join("\u0000")}`;
    unique.set(key, normalized);
  });
  return [...unique.values()].sort((left, right) => {
    const leftKey = `${left.paths[0]}\u0000${left.paths[1] ?? ""}\u0000${left.status}`;
    const rightKey = `${right.paths[0]}\u0000${right.paths[1] ?? ""}\u0000${right.status}`;
    return leftKey.localeCompare(rightKey);
  });
}

export function parseGitNameStatus(output) {
  if (typeof output !== "string") throw new Error("git name-status output must be a string");
  if (output === "") return [];
  const tokens = output.split("\u0000");
  if (tokens.at(-1) === "") tokens.pop();
  if (tokens.some((token) => token === "")) throw new Error("git name-status output contains an empty path token");
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = normalizeChangeStatus(tokens[index], `git name-status entry ${index}`);
    index += 1;
    const pathCount = status.code === "R" || status.code === "C" ? 2 : 1;
    if (index + pathCount > tokens.length) throw new Error("git name-status output is truncated");
    entries.push({ status: tokens[index - 1], paths: tokens.slice(index, index + pathCount) });
    index += pathCount;
  }
  return normalizeChangedFiles(entries);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  const close = pattern.indexOf("}", open + 1);
  if (close < 0) return [pattern];
  const alternatives = pattern.slice(open + 1, close).split(",");
  return alternatives.flatMap((alternative) => expandBraces(
    `${pattern.slice(0, open)}${alternative}${pattern.slice(close + 1)}`
  ));
}

// Match the small, repository-controlled glob dialect without compiling a
// runtime regular expression from policy text.  This keeps path selection
// deterministic and avoids ReDoS when a future policy contains a malformed or
// unexpectedly broad pattern.
function globMatch(value, pattern) {
  const memo = new Map();
  function match(valueIndex, patternIndex) {
    const key = `${valueIndex}:${patternIndex}`;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (patternIndex === pattern.length) {
      result = valueIndex === value.length;
    } else if (pattern[patternIndex] === "*" && pattern[patternIndex + 1] === "*") {
      const afterGlob = patternIndex + 2 + (pattern[patternIndex + 2] === "/" ? 1 : 0);
      result = match(valueIndex, afterGlob)
        || (valueIndex < value.length && match(valueIndex + 1, patternIndex));
    } else if (pattern[patternIndex] === "*") {
      result = match(valueIndex, patternIndex + 1)
        || (valueIndex < value.length && value[valueIndex] !== "/" && match(valueIndex + 1, patternIndex));
    } else if (pattern[patternIndex] === "?") {
      result = valueIndex < value.length && value[valueIndex] !== "/" && match(valueIndex + 1, patternIndex + 1);
    } else {
      result = valueIndex < value.length
        && value[valueIndex] === pattern[patternIndex]
        && match(valueIndex + 1, patternIndex + 1);
    }
    memo.set(key, result);
    return result;
  }
  return match(0, 0);
}

export function matchesAny(path, patterns = []) {
  return patterns.some((pattern) => expandBraces(pattern).some((expanded) => globMatch(path, expanded)));
}

function matchesAnyPath(file, patterns) {
  return matchesAny(file, patterns) || matchesAny(file.toLowerCase(), patterns.map((pattern) => pattern.toLowerCase()));
}

function collectPathEntries(changes) {
  const paths = new Map();
  for (const change of changes) {
    for (const file of change.paths) {
      if (!paths.has(file)) paths.set(file, new Set());
      paths.get(file).add(change.status);
    }
  }
  return [...paths.keys()].sort().map((file) => ({ file, statuses: [...paths.get(file)].sort() }));
}

function classifyLanguage(policy, file) {
  const languages = policy.languageRules
    .filter((rule) => matchesAnyPath(file, rule.patterns))
    .map((rule) => rule.id);
  return languages.length ? languages : ["unknown"];
}

function criticalChecks(policy) {
  try {
    validateRiskPolicy(policy);
    return [...policy.levels.critical.requiredChecks];
  } catch {
    return [...FALLBACK_REQUIRED_CHECKS];
  }
}

function failureText(value) {
  const normalized = String(value ?? "classification failed").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || "classification failed").slice(0, 240);
}

function safeFailureCode(value) {
  const normalized = String(value ?? "classification_failed").trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{0,63}$/.test(normalized) ? normalized : "classification_failed";
}

export function buildClassificationFallback({ policy = null, code = "classification_failed", reason = "classification failed" } = {}) {
  const fallback = {
    active: true,
    code: safeFailureCode(code),
    reason: failureText(reason),
  };
  return {
    schemaVersion: 2,
    risk: "critical",
    surfaces: ["unclassified"],
    affectedSurfaces: ["unclassified"],
    languages: ["unknown"],
    dependencies_changed: true,
    shared_contracts_changed: true,
    production_sensitive: true,
    security_sensitive: true,
    status: "fallback",
    classification_status: "failed",
    fallback,
    requiredChecks: criticalChecks(policy),
    skippedChecks: [],
    pathClassifications: [],
    rationale: `Classification failed closed (${fallback.code}); no change is eligible for the low-risk lane.`,
  };
}

export function classifyFiles(policy, files) {
  validateRiskPolicy(policy);
  const changes = normalizeChangedFiles(files);
  const normalizedEntries = collectPathEntries(changes);
  const normalizedFiles = normalizedEntries.map((entry) => entry.file);
  const matches = normalizedFiles.map((file) => {
    const matchingRules = policy.classificationRules.filter((rule) => matchesAnyPath(file, rule.patterns));
    const matchedRule = matchingRules.sort((left, right) => RISK_ORDER[right.risk] - RISK_ORDER[left.risk])[0];
    const surfaces = policy.surfaces.filter((surface) => matchesAnyPath(file, surface.patterns)).map((surface) => surface.id);
    const fileDependenciesChanged = matchesAnyPath(file, policy.dependencyPatterns);
    const fileSharedContractsChanged = matchesAnyPath(file, policy.sharedContractPatterns);
    const fileSecuritySensitive = matchesAnyPath(file, policy.securitySensitivePatterns);
    let fileRisk = matchedRule?.risk ?? policy.defaultRisk;
    // Keep per-file and aggregate risk conservative. A consumer must not be
    // able to downgrade a dependency, shared contract, or security path by
    // reading pathClassifications instead of the aggregate report.
    if (fileDependenciesChanged || fileSharedContractsChanged || fileSecuritySensitive) {
      fileRisk = RISK_ORDER[fileRisk] < RISK_ORDER.high ? "high" : fileRisk;
    }
    return {
      file,
      risk: fileRisk,
      reason: matchedRule?.reason ?? "No higher-risk path rule matched; the default implementation risk applies.",
      surfaces: surfaces.length ? surfaces : ["unclassified"]
    };
  });
  let risk = matches.reduce((current, entry) => RISK_ORDER[entry.risk] > RISK_ORDER[current] ? entry.risk : current, "low");
  const surfaces = [...new Set(matches.flatMap((entry) => entry.surfaces))].sort();
  const languages = [...new Set(normalizedFiles.flatMap((file) => classifyLanguage(policy, file)))].sort();
  const dependenciesChanged = normalizedFiles.some((file) => matchesAnyPath(file, policy.dependencyPatterns));
  const sharedContractsChanged = normalizedFiles.some((file) => matchesAnyPath(file, policy.sharedContractPatterns));
  const productionSensitive = normalizedFiles.some((file) => matchesAnyPath(file, policy.productionSensitivePatterns));
  const securitySensitive = normalizedFiles.some((file) => matchesAnyPath(file, policy.securitySensitivePatterns));
  const level = policy.levels[risk];
  return {
    schemaVersion: 2,
    risk,
    surfaces,
    // Kept for existing workflow consumers until they migrate to `surfaces`.
    affectedSurfaces: surfaces,
    languages,
    dependencies_changed: dependenciesChanged,
    shared_contracts_changed: sharedContractsChanged,
    production_sensitive: productionSensitive,
    security_sensitive: securitySensitive,
    status: "classified",
    classification_status: "ok",
    fallback: null,
    requiredChecks: [...level.requiredChecks],
    skippedChecks: [...level.skippedChecks],
    pathClassifications: matches,
    rationale: matches.length
      ? `Highest affected risk is ${risk}; checks are selected from the versioned policy for the actual changed paths.`
      : "No changed paths were supplied; only a diff check is required."
  };
}

export function releaseInputDigest({ surfaces, inputs, policyPaths }) {
  const normalizedInputs = [...inputs]
    .map((entry) => ({ path: entry.path.replaceAll("\\", "/"), blob: entry.blob }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const material = {
    schemaVersion: 1,
    surfaces: [...new Set(surfaces)].sort(),
    policyPaths: [...new Set(policyPaths)].sort(),
    inputs: normalizedInputs
  };
  return { material, digest: sha256(canonicalJson(material)) };
}

const ARTIFACT_FIELDS = new Set([
  "name", "digest", "id", "versionId", "deploymentId", "artifactId", "artifactDigest",
  "workflowRunId", "runId", "workerVersionId", "pagesDeploymentId", "schemaIdentity",
  "migrationIdentity", "rollbackIncumbent", "sourceCommit", "sourceTree", "releaseRef", "releaseTag",
]);
const SAFE_ARTIFACT_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/;

export function normalizeArtifactRecord(artifact, { requireDigest = true } = {}) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("artifact record is invalid");
  for (const key of Object.keys(artifact)) {
    if (!ARTIFACT_FIELDS.has(key)) throw new Error(`artifact record field is not allowed: ${key}`);
  }
  const name = String(artifact.name ?? "").trim();
  if (!SAFE_ARTIFACT_VALUE.test(name)) throw new Error("artifact record name is invalid");
  const normalized = { name };
  for (const key of [...ARTIFACT_FIELDS].filter((candidate) => candidate !== "name")) {
    if (artifact[key] === undefined || artifact[key] === null || String(artifact[key]).trim() === "") continue;
    const value = String(artifact[key]).trim();
    if (!SAFE_ARTIFACT_VALUE.test(value)) throw new Error(`artifact record ${key} is invalid`);
    normalized[key] = value;
  }
  if (requireDigest && !normalized.digest) throw new Error(`artifact record ${name} requires a digest`);
  if (normalized.digest && !SAFE_ARTIFACT_VALUE.test(normalized.digest)) throw new Error(`artifact record ${name} digest is invalid`);
  return normalized;
}

export function normalizeArtifactRecords(artifacts = [], options = {}) {
  if (!Array.isArray(artifacts)) throw new Error("artifact records must be an array");
  const normalized = artifacts.map((artifact) => normalizeArtifactRecord(artifact, options))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalized.map((artifact) => artifact.name)).size !== normalized.length) throw new Error("artifact names must be unique");
  return normalized;
}

function normalizeReleaseReference(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const result = String(value).trim();
  if (!SAFE_ARTIFACT_VALUE.test(result)) throw new Error(`${name} is invalid`);
  return result;
}

function normalizeSafeStringList(values, name) {
  if (!Array.isArray(values)) throw new Error(`${name} must be an array`);
  return [...new Set(values.map((value) => {
    const result = String(value ?? "").trim();
    if (!SAFE_ARTIFACT_VALUE.test(result)) throw new Error(`${name} contains an invalid identity`);
    return result;
  }))].sort();
}

export function buildReleaseManifest({
  sourceCommit,
  sourceTree,
  surfaces,
  inputs,
  policyPaths,
  artifacts = [],
  migrations = [],
  evidence = [],
  predecessor = null,
  dependencyClosureDigest = null,
  module = null,
  releaseRef = null,
  releaseTag = null,
  workflowRunId = null,
  rollbackIncumbents = [],
  artifactManifestSchemaVersion = 1,
}) {
  const releaseInput = releaseInputDigest({ surfaces, inputs, policyPaths });
  const normalizedArtifacts = normalizeArtifactRecords(artifacts);
  const normalizedClosureDigest = dependencyClosureDigest
    ? normalizeReleaseReference(dependencyClosureDigest, "dependency closure digest")
    : releaseInput.digest;
  if (!/^[0-9a-f]{64}$/i.test(normalizedClosureDigest)) throw new Error("dependency closure digest is invalid");
  const normalizedModule = normalizeReleaseReference(module, "release module");
  const normalizedReleaseRef = normalizeReleaseReference(releaseRef, "release ref");
  const normalizedReleaseTag = normalizeReleaseReference(releaseTag, "release tag");
  const normalizedWorkflowRunId = normalizeReleaseReference(workflowRunId, "workflow run ID");
  const normalizedRollbackIncumbents = normalizeSafeStringList(rollbackIncumbents, "rollback incumbents");
  const releaseIdentity = {
    schemaVersion: 1,
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: normalizedClosureDigest,
    artifacts: normalizedArtifacts,
    ...(normalizedModule ? { module: normalizedModule } : {}),
    ...(normalizedReleaseRef ? { releaseRef: normalizedReleaseRef } : {}),
    ...(normalizedReleaseTag ? { releaseTag: normalizedReleaseTag } : {}),
    ...(normalizedWorkflowRunId ? { workflowRunId: normalizedWorkflowRunId } : {}),
    ...(normalizedRollbackIncumbents.length ? { rollbackIncumbents: normalizedRollbackIncumbents } : {}),
  };
  const predecessorIdentity = predecessor ? {
    sourceCommit: predecessor.sourceCommit,
    releaseInputDigest: predecessor.releaseInputDigest,
    artifactDigests: [...(predecessor.artifactDigests ?? [])].sort(),
    ...(predecessor.releaseIdentityDigest ? { releaseIdentityDigest: predecessor.releaseIdentityDigest } : {}),
    ...(predecessor.releaseRef ? { releaseRef: predecessor.releaseRef } : {}),
    ...(predecessor.releaseTag ? { releaseTag: predecessor.releaseTag } : {}),
    ...(predecessor.workflowRunId ? { workflowRunId: predecessor.workflowRunId } : {}),
  } : null;
  return {
    schemaVersion: 1,
    sourceCommit,
    sourceTree,
    releaseInputDigest: releaseInput.digest,
    dependencyClosureDigest: normalizedClosureDigest,
    releaseInputs: releaseInput.material.inputs,
    surfaces: releaseInput.material.surfaces,
    policiesConsumed: releaseInput.material.policyPaths,
    artifacts: normalizedArtifacts,
    artifactManifest: {
      schemaVersion: artifactManifestSchemaVersion,
      sourceCommit,
      sourceTree,
      dependencyClosureDigest: normalizedClosureDigest,
      artifacts: normalizedArtifacts,
    },
    releaseIdentity,
    releaseIdentityDigest: sha256(canonicalJson(releaseIdentity)),
    migrations: [...new Set(migrations)].sort(),
    evidence: evidence.map((entry) => ({ name: entry.name, digest: entry.digest })).sort((left, right) => left.name.localeCompare(right.name)),
    predecessor: predecessorIdentity,
    rollback: predecessor
      ? { strategy: "promote the exact predecessor artifacts", predecessorSourceCommit: predecessor.sourceCommit, incumbents: normalizedRollbackIncumbents }
      : { strategy: "no predecessor supplied; promotion is blocked until rollback identity is recorded", incumbents: normalizedRollbackIncumbents }
  };
}

export function findReusableEvidence(records, manifest) {
  let expectedArtifacts;
  try {
    expectedArtifacts = new Map(normalizeArtifactRecords(manifest.artifacts).map((artifact) => [artifact.name, canonicalJson(artifact)]));
  } catch {
    return null;
  }
  return records.find((record) => {
    if (record?.releaseInputDigest !== manifest.releaseInputDigest || record?.status !== "green") return false;
    if (manifest.releaseIdentity?.releaseRef && record.releaseIdentityDigest !== manifest.releaseIdentityDigest) return false;
    let actualArtifacts;
    try {
      actualArtifacts = new Map(normalizeArtifactRecords(record.artifacts).map((artifact) => [artifact.name, canonicalJson(artifact)]));
    } catch {
      return false;
    }
    return actualArtifacts.size === expectedArtifacts.size && [...expectedArtifacts].every(([name, identity]) => actualArtifacts.get(name) === identity);
  }) ?? null;
}
