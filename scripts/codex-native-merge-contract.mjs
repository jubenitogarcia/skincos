import crypto from "node:crypto";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_EVIDENCE_AGE_MS = 60 * 60_000;

export function nativeChangedPathsDigest(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.some((value) => typeof value !== "string" || !value)) {
    throw new Error("native merge changed paths are unavailable");
  }
  return crypto.createHash("sha256").update(JSON.stringify([...new Set(paths)].sort())).digest("hex");
}

export function nativeGatePlan(report) {
  if (report?.classification_status !== "ok") throw new Error("native merge classification is not sealed");
  if (report.risk === "critical") throw new Error("critical native merge requires its separate exceptional gate");
  const surfaces = new Set(report.surfaces || []);
  if (!Array.isArray(report.surfaces) || report.surfaces.length < 1 || surfaces.has("unclassified")) {
    throw new Error("native merge has an unclassified change surface");
  }
  const plan = ["diff-check", "static-parse"];
  if (surfaces.has("codex-baseline")) {
    plan.push("baseline-contract", "coordination-contract", "supervisor-contract");
    if (["high", "critical"].includes(report.risk)) plan.push("release-manifest-contract");
  }
  if (surfaces.has("github-governance")) plan.push("github-governance-contract");
  if ([...surfaces].some((surface) => !["documentation", "codex-baseline", "github-governance", "global-coordination"].includes(surface))) {
    plan.push("affected-domain-validation");
  }
  if (surfaces.has("global-coordination") && !plan.includes("coordination-contract")) {
    plan.push("coordination-contract");
  }
  return plan;
}

export function assertNativeGateEvidence(evidence, candidate, now = Date.now()) {
  if (!evidence || evidence.schemaVersion !== 1 || evidence.kind !== "skincos-native-merge-gate" || evidence.status !== "passed") {
    throw new Error("native merge validation evidence is missing or failed");
  }
  if (!SHA.test(String(evidence.baseSha || "")) || !SHA.test(String(evidence.headSha || "")) || !SHA.test(String(evidence.trustedMainSha || ""))) {
    throw new Error("native merge evidence has an invalid SHA");
  }
  if (!DIGEST.test(String(evidence.closureDigest || "")) || !DIGEST.test(String(evidence.changedPathsDigest || ""))) {
    throw new Error("native merge evidence has an invalid digest");
  }
  if (
    evidence.repository !== candidate.repository
    || String(evidence.pullNumber) !== String(candidate.pullNumber)
    || evidence.baseSha !== candidate.baseSha
    || evidence.headSha !== candidate.headSha
    || evidence.trustedMainSha !== candidate.baseSha
    || evidence.closureDigest !== candidate.closure.digest
    || evidence.changedPathsDigest !== nativeChangedPathsDigest(candidate.changedPaths)
  ) throw new Error("native merge validation evidence does not match the current PR identity or closure");
  const checkedAt = Date.parse(String(evidence.validatedAt || ""));
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > MAX_EVIDENCE_AGE_MS) {
    throw new Error("native merge validation evidence has expired");
  }
  const plan = nativeGatePlan(evidence.classification);
  const passed = evidence.checks;
  if (!Array.isArray(passed) || passed.length !== plan.length || passed.some((value, index) => value !== plan[index])) {
    throw new Error("native merge validation did not pass the complete risk-selected plan");
  }
  return { baseSha: evidence.baseSha, headSha: evidence.headSha, closureDigest: evidence.closureDigest };
}
