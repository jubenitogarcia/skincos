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

export function buildReleaseManifest({ sourceCommit, sourceTree, surfaces, inputs, policyPaths, artifacts = [], migrations = [], evidence = [], predecessor = null }) {
  const releaseInput = releaseInputDigest({ surfaces, inputs, policyPaths });
  const normalizedArtifacts = artifacts.map((artifact) => ({ name: artifact.name, digest: artifact.digest })).sort((left, right) => left.name.localeCompare(right.name));
  const releaseIdentity = {
    schemaVersion: 1,
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: releaseInput.digest,
    artifacts: normalizedArtifacts,
  };
  return {
    schemaVersion: 1,
    sourceCommit,
    sourceTree,
    releaseInputDigest: releaseInput.digest,
    dependencyClosureDigest: releaseInput.digest,
    releaseInputs: releaseInput.material.inputs,
    surfaces: releaseInput.material.surfaces,
    policiesConsumed: releaseInput.material.policyPaths,
    artifacts: normalizedArtifacts,
    releaseIdentity,
    releaseIdentityDigest: sha256(canonicalJson(releaseIdentity)),
    migrations: [...new Set(migrations)].sort(),
    evidence: evidence.map((entry) => ({ name: entry.name, digest: entry.digest })).sort((left, right) => left.name.localeCompare(right.name)),
    predecessor: predecessor ? { sourceCommit: predecessor.sourceCommit, releaseInputDigest: predecessor.releaseInputDigest, artifactDigests: [...(predecessor.artifactDigests ?? [])].sort() } : null,
    rollback: predecessor ? { strategy: "promote the exact predecessor artifacts", predecessorSourceCommit: predecessor.sourceCommit } : { strategy: "no predecessor supplied; promotion is blocked until rollback identity is recorded" }
  };
}

export function findReusableEvidence(records, manifest) {
  const expectedArtifacts = new Map(manifest.artifacts.map((artifact) => [artifact.name, artifact.digest]));
  return records.find((record) => {
    if (record?.releaseInputDigest !== manifest.releaseInputDigest || record?.status !== "green") return false;
    const actualArtifacts = new Map((record.artifacts ?? []).map((artifact) => [artifact.name, artifact.digest]));
    return actualArtifacts.size === expectedArtifacts.size && [...expectedArtifacts].every(([name, digest]) => actualArtifacts.get(name) === digest);
  }) ?? null;
}
