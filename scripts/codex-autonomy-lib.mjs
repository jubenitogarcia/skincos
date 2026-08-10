import crypto from "node:crypto";

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

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

export function classifyFiles(policy, files) {
  const normalizedFiles = [...new Set(files.filter(Boolean).map((file) => file.replaceAll("\\", "/")))].sort();
  const matches = normalizedFiles.map((file) => {
    const matchingRules = policy.classificationRules.filter((rule) => matchesAny(file, rule.patterns));
    const matchedRule = matchingRules.sort((left, right) => RISK_ORDER[right.risk] - RISK_ORDER[left.risk])[0];
    const surfaces = policy.surfaces.filter((surface) => matchesAny(file, surface.patterns)).map((surface) => surface.id);
    return {
      file,
      risk: matchedRule?.risk ?? policy.defaultRisk,
      reason: matchedRule?.reason ?? "No higher-risk path rule matched; the default implementation risk applies.",
      surfaces: surfaces.length ? surfaces : ["unclassified"]
    };
  });
  const risk = matches.reduce((current, entry) => RISK_ORDER[entry.risk] > RISK_ORDER[current] ? entry.risk : current, "low");
  const surfaces = [...new Set(matches.flatMap((entry) => entry.surfaces))].sort();
  const level = policy.levels[risk];
  return {
    schemaVersion: 1,
    risk,
    affectedSurfaces: surfaces,
    requiredChecks: level.requiredChecks,
    skippedChecks: level.skippedChecks,
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
