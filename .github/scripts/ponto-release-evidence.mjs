import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STAGES = ["preview", "staging", "pilot", "canary", "production", "rollback"];
const PREDECESSOR = { staging: "preview", pilot: "staging", canary: "pilot", production: "canary" };
const ROLLBACK_PREDECESSORS = new Set(["pilot", "canary", "production"]);
const SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTTPS = /^https:\/\/[^/\s]+(?:\/[^\s]*)?$/i;
const FORBIDDEN_KEYS = /(?:secret|password|passphrase|cookie|authorization|token|email|actor|network|cidr|username|employee)/i;

const [mode, file] = process.argv.slice(2);
const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const optionalJson = (name, fallback) => {
  const raw = String(process.env[name] || "").trim();
  return raw ? JSON.parse(raw) : fallback;
};
const digestFile = (filename) => crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const assertSafeObject = (value, at = "root") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeObject(item, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.test(key), `forbidden evidence key at ${at}.${key}`);
    assertSafeObject(child, `${at}.${key}`);
  }
};
const assertUuid = (value, name) => assert(UUID.test(String(value || "")), `${name} must be a UUID`);
const assertSha256 = (value, name) => assert(SHA256.test(String(value || "")), `${name} must be a SHA-256 digest`);

function validateSurfaces(surfaces, stage, sourceSha) {
  assert(surfaces && typeof surfaces === "object" && !Array.isArray(surfaces), "surfaces must be an object");
  for (const unit of ["timekeeping", "coreApi", "identityWorkforce", "crmPages"]) {
    assert(surfaces[unit] && typeof surfaces[unit] === "object", `missing ${unit} surface`);
    assert(surfaces[unit].sourceSha === sourceSha, `${unit}.sourceSha differs`);
    assert(surfaces[unit].stage === stage, `${unit}.stage differs`);
    assert(/^[0-9]+$/.test(String(surfaces[unit].runId || "")), `${unit}.runId must be numeric`);
  }
  if (!["staging", "pilot", "canary", "production", "rollback"].includes(stage)) return;
  const expectedWeights = {
    staging: { timekeeping: 100, coreApi: 100, identityWorkforce: 100 },
    pilot: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
    canary: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
    production: { timekeeping: 100, coreApi: 100, identityWorkforce: 100 },
    rollback: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
  };
  for (const unit of ["timekeeping", "coreApi", "identityWorkforce"]) {
    const surface = surfaces[unit];
    assertUuid(surface.candidateVersionId, `${unit}.candidateVersionId`);
    assertUuid(surface.incumbentVersionId, `${unit}.incumbentVersionId`);
    assert(surface.candidateVersionId !== surface.incumbentVersionId, `${unit} candidate and incumbent must differ`);
    assertUuid(surface.deploymentId, `${unit}.deploymentId`);
    assert(Number.isInteger(surface.candidatePercent), `${unit}.candidatePercent must be an integer`);
    assert(Number.isInteger(surface.incumbentPercent), `${unit}.incumbentPercent must be an integer`);
    assert(surface.candidatePercent + surface.incumbentPercent === 100, `${unit} traffic must total 100`);
    assert(surface.candidatePercent === expectedWeights[stage][unit], `${unit} candidate weight is invalid for ${stage}`);
    assert(surface.incumbentPercent === 100 - expectedWeights[stage][unit], `${unit} incumbent weight is invalid for ${stage}`);
    assert(surface.candidateTag === `ponto:${unit}:${sourceSha}`, `${unit}.candidateTag does not identify source SHA`);
    assert(HTTPS.test(String(surface.url || "")), `${unit}.url must be HTTPS`);
  }
  assertUuid(surfaces.crmPages.deploymentId, "crmPages.deploymentId");
  assertUuid(surfaces.crmPages.rollbackDeploymentId, "crmPages.rollbackDeploymentId");
  assert(surfaces.crmPages.candidateTag === `ponto:crmPages:${sourceSha}`, "crmPages.candidateTag does not identify source SHA");
  assert(HTTPS.test(String(surfaces.crmPages.url || "")), "crmPages.url must be HTTPS");
  if (stage === "pilot") {
    const baselineRunIds = ["timekeeping", "coreApi", "identityWorkforce", "crmPages"]
      .map(unit => String(surfaces[unit].baselineRunId || ""));
    assert(baselineRunIds.every(value => /^[0-9]+$/.test(value)), "pilot surfaces require numeric baselineRunId");
    assert(new Set(baselineRunIds).size === 1, "pilot surfaces must reference one immutable baseline run");
  }
}

function validateEdgeGuard(edgeGuard, stage, sourceSha) {
  if (!["staging", "pilot", "canary", "production"].includes(stage)) {
    assert(edgeGuard === null, `${stage} must not claim a live edge guard`);
    return;
  }
  assert(edgeGuard && typeof edgeGuard === "object" && !Array.isArray(edgeGuard), `${stage} release requires edge guard evidence`);
  assert(edgeGuard.schemaVersion === 1, "edge guard schemaVersion is invalid");
  assert(edgeGuard.releaseSha === sourceSha, "edge guard source SHA differs");
  assert(edgeGuard.stage === stage, "edge guard stage differs");
  assert(edgeGuard.passed === true, "edge guard did not pass");
  assert(edgeGuard.ruleAction === "block" && edgeGuard.phase === "http_request_firewall_custom", "edge guard ruleset contract is invalid");
  assert(edgeGuard.unconditional === true && edgeGuard.upstreamZoneExemption === false, "edge guard permits an upstream-zone bypass");
  assert(edgeGuard.blockedPath === "/insumos/health/workforce-contract", "edge guard workforce contract path is not blocked");
  assert(JSON.stringify(edgeGuard.blockedHeaders) === JSON.stringify(["cloudflare-workers-version-overrides", "cloudflare-workers-version-key"]), "edge guard headers differ");
  assert(JSON.stringify(edgeGuard.hosts) === JSON.stringify(["api.skincos.com.br", "api-staging.skincos.com.br"]), "edge guard hosts differ");
  assert(/^[0-9a-f]{32}$/.test(String(edgeGuard.zoneId || "")), "edge guard zone ID is invalid");
  assert(/^[0-9a-f]{32}$/.test(String(edgeGuard.rulesetId || "")), "edge guard ruleset ID is invalid");
  assert(
    Array.isArray(edgeGuard.ruleIds)
      && edgeGuard.ruleIds.length === 2
      && new Set(edgeGuard.ruleIds).size === 2
      && edgeGuard.ruleIds.every(value => /^[0-9a-f]{32}$/.test(String(value))),
    "edge guard rule IDs are invalid",
  );
  assert(
    JSON.stringify(edgeGuard.ruleDescriptions) === JSON.stringify([
      "ponto-release-block-public-version-selection-v1",
      "ponto-release-block-public-workforce-contract-v1",
    ]),
    "edge guard rule descriptions differ",
  );
  assert(typeof edgeGuard.rulesetVersion === "string" && edgeGuard.rulesetVersion.length > 0, "edge guard ruleset version is absent");
  assert(Array.isArray(edgeGuard.probes) && edgeGuard.probes.length === 8, "edge guard requires two negative controls and six external block probes");
  for (const host of edgeGuard.hosts) {
    const probes = edgeGuard.probes.filter(probe => probe?.host === host);
    const negative = probes.filter(probe => probe?.kind === "negative-control");
    assert(
      negative.length === 1
        && negative[0].passed === true
        && negative[0].cloudflareRayPresent === true
        && Number.isInteger(negative[0].status)
        && negative[0].status >= 200
        && negative[0].status < 400,
      `edge guard negative control failed for ${host}`,
    );
    for (const header of edgeGuard.blockedHeaders) {
      const matches = probes.filter(probe => probe?.header === header);
      assert(
        matches.length === 1
          && matches[0].passed === true
          && matches[0].cloudflareRayPresent === true
          && matches[0].status === 403,
        `edge guard ${header} block probe failed for ${host}`,
      );
    }
    const contract = probes.filter(probe => probe?.path === edgeGuard.blockedPath);
    assert(
      contract.length === 1
        && contract[0].passed === true
        && contract[0].cloudflareRayPresent === true
        && contract[0].status === 403,
      `edge guard workforce contract block probe failed for ${host}`,
    );
    assert(probes.length === 4, `edge guard probe inventory differs for ${host}`);
  }
  assert(edgeGuard.credentialsIncluded === false && edgeGuard.piiIncluded === false, "edge guard evidence contains sensitive material");
  assertSha256(edgeGuard.digest, "edgeGuard.digest");
  const { digest, ...summary } = edgeGuard;
  assert(
    crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex") === digest,
    "edge guard digest differs",
  );
}

function validateEvidence(evidence) {
  assert(evidence?.schemaVersion === 2, "evidence schemaVersion must be 2");
  assert(evidence.unit === "ponto", "evidence unit must be ponto");
  assert(STAGES.includes(evidence.stage), "invalid release stage");
  assert(SHA.test(evidence.sourceSha), "invalid sourceSha");
  assert(SHA.test(evidence.sourceTree), "invalid sourceTree");
  assert(/^[0-9]+$/.test(String(evidence.runId || "")), "invalid runId");
  assert(typeof evidence.repository === "string" && evidence.repository.includes("/"), "invalid repository");
  assert(evidence.decision === "pass", "release decision is not pass");
  if (evidence.stage === "preview") {
    assert(evidence.predecessor === null, "preview cannot have a predecessor");
  } else {
    const expected = evidence.stage === "rollback" ? ROLLBACK_PREDECESSORS : new Set([PREDECESSOR[evidence.stage]]);
    assert(expected.has(evidence.predecessor?.stage), "invalid predecessor stage");
    assert(/^[0-9]+$/.test(String(evidence.predecessor?.runId || "")), "invalid predecessor run id");
    assert(evidence.predecessor?.sourceSha === evidence.sourceSha, "predecessor source SHA differs");
    assert(evidence.predecessor?.artifactName === `ponto-release-evidence-${evidence.predecessor.stage}-${evidence.sourceSha}`, "invalid predecessor artifact name");
    assertSha256(evidence.predecessor?.artifactSha256, "predecessor.artifactSha256");
  }
  validateSurfaces(evidence.surfaces, evidence.stage, evidence.sourceSha);
  validateEdgeGuard(evidence.edgeGuard, evidence.stage, evidence.sourceSha);
  assert(Array.isArray(evidence.migrations), "migrations must be an array");
  for (const migration of evidence.migrations) {
    assert(typeof migration?.name === "string" && /^\d+.*\.sql$/.test(migration.name), "migration name is invalid");
    assert(["timekeeping", "identityWorkforce"].includes(migration?.unit), "migration unit is invalid");
    assertSha256(migration?.sha256, `migration ${migration?.name || "unknown"} sha256`);
    assert(migration?.status === "applied-or-preexisting", "migration status is invalid");
  }
  if (evidence.checkpoint !== null) {
    assert(evidence.checkpoint && typeof evidence.checkpoint === "object" && !Array.isArray(evidence.checkpoint), "checkpoint must be an object");
    for (const [unit, checkpoint] of Object.entries(evidence.checkpoint)) {
      assert(["timekeeping", "identityWorkforce"].includes(unit), `checkpoint unit ${unit} is invalid`);
      assert(typeof checkpoint?.artifactName === "string" && checkpoint.artifactName.length > 0, `${unit} checkpoint artifactName is required`);
      assertSha256(checkpoint?.sha256, `${unit} checkpoint.sha256`);
      assert(checkpoint?.releaseSha === evidence.sourceSha, `${unit} checkpoint releaseSha differs`);
    }
  }
  if (["staging", "pilot", "canary", "production", "rollback"].includes(evidence.stage)) {
    const slo = evidence.slo;
    assert(slo?.passed === true, "external SLO did not pass");
    assert(Number.isInteger(slo.samples) && slo.samples > 0, "SLO samples must be positive");
    assert(Number.isInteger(slo.errors) && slo.errors >= 0, "SLO errors must be non-negative");
    assert(Number.isFinite(slo.p95Ms) && slo.p95Ms >= 0, "SLO p95Ms is invalid");
    assert(Number.isInteger(slo.windowSeconds) && slo.windowSeconds > 0, "SLO windowSeconds must be positive");
    assertSha256(slo.digest, "slo.digest");
    for (const [key, value] of Object.entries({
      timekeepingVersionId: evidence.rollback?.timekeepingVersionId,
      coreVersionId: evidence.rollback?.coreVersionId,
      identityVersionId: evidence.rollback?.identityVersionId,
      pagesDeploymentId: evidence.rollback?.pagesDeploymentId,
    })) assertUuid(value, `rollback.${key}`);
  }
  if (evidence.stage === "staging") {
    assert(evidence.checkpoint?.timekeeping && evidence.checkpoint?.identityWorkforce, "staging requires Timekeeping and Identity checkpoints");
    assert(evidence.rollback?.executed === true, "staging requires an executed rollback drill");
    assert(evidence.rollback?.mode === "staging-drill-restored-candidate", "staging rollback drill mode is invalid");
    assert(/^[0-9]+$/.test(String(evidence.rollback?.evidenceRunId || "")), "staging rollback drill run id is invalid");
    assert(/^[0-9]+$/.test(String(evidence.rollback?.predecessorRunId || "")), "staging rollback drill predecessor is invalid");
    assert(evidence.rollback?.restoredCandidate === true, "staging rollback drill did not restore the exact candidate");
  }
  if (evidence.stage === "pilot") assert(evidence.checkpoint?.timekeeping, "pilot requires a Timekeeping checkpoint");
  if (evidence.stage === "production") assert(evidence.checkpoint?.identityWorkforce, "production requires an Identity checkpoint");
  if (evidence.stage === "rollback") assert(evidence.rollback?.executed === true, "rollback evidence must attest execution");
  assertSafeObject(evidence);
  return evidence;
}

if (mode === "write") {
  const stage = required("PONTO_RELEASE_STAGE").toLowerCase();
  const sourceSha = required("PONTO_RELEASE_SHA").toLowerCase();
  const sourceTree = required("PONTO_RELEASE_TREE").toLowerCase();
  assert(STAGES.includes(stage), "invalid PONTO_RELEASE_STAGE");
  assert(SHA.test(sourceSha), "PONTO_RELEASE_SHA must be a full SHA");
  assert(SHA.test(sourceTree), "PONTO_RELEASE_TREE must be a full tree SHA");
  let predecessor = null;
  if (stage !== "preview") {
    const predecessorFile = required("PONTO_PREDECESSOR_FILE");
    const predecessorEvidence = validateEvidence(JSON.parse(fs.readFileSync(predecessorFile, "utf8")));
    predecessor = {
      stage: required("PONTO_PREDECESSOR_STAGE").toLowerCase(),
      runId: required("PONTO_PREDECESSOR_RUN_ID"),
      sourceSha: required("PONTO_PREDECESSOR_SHA").toLowerCase(),
      artifactName: required("PONTO_PREDECESSOR_ARTIFACT"),
      artifactSha256: digestFile(predecessorFile),
    };
    assert(predecessorEvidence.stage === predecessor.stage, "predecessor file stage differs");
    assert(predecessorEvidence.sourceSha === predecessor.sourceSha, "predecessor file SHA differs");
    assert(String(predecessorEvidence.runId) === String(predecessor.runId), "predecessor file run ID differs");
  }
  const evidence = validateEvidence({
    schemaVersion: 2,
    unit: "ponto",
    stage,
    sourceSha,
    sourceTree,
    runId: required("GITHUB_RUN_ID"),
    repository: required("GITHUB_REPOSITORY"),
    createdAt: new Date().toISOString(),
    predecessor,
    surfaces: optionalJson("PONTO_RELEASE_SURFACES_JSON", {}),
    edgeGuard: optionalJson("PONTO_RELEASE_EDGE_GUARD_JSON", null),
    checkpoint: optionalJson("PONTO_RELEASE_CHECKPOINT_JSON", null),
    migrations: optionalJson("PONTO_RELEASE_MIGRATIONS_JSON", []),
    cohort: optionalJson("PONTO_RELEASE_COHORT_SUMMARY_JSON", { configured: false, grants: 0, units: 0, contexts: 0 }),
    slo: optionalJson("PONTO_RELEASE_SLO_JSON", { passed: stage === "preview" || stage === "staging" }),
    rollback: optionalJson("PONTO_RELEASE_ROLLBACK_JSON", null),
    decision: "pass",
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Ponto ${stage} evidence written for ${sourceSha}; sha256=${digestFile(file)}\n`);
} else if (mode === "verify") {
  const evidence = validateEvidence(JSON.parse(fs.readFileSync(file, "utf8")));
  const expectedStage = required("PONTO_EXPECTED_STAGE").toLowerCase();
  const expectedSha = required("PONTO_EXPECTED_SHA").toLowerCase();
  const expectedRepository = required("PONTO_EXPECTED_REPOSITORY");
  assert(evidence.stage === expectedStage, `expected ${expectedStage} evidence`);
  assert(evidence.sourceSha === expectedSha, "evidence SHA differs from requested release SHA");
  assert(evidence.repository === expectedRepository, "evidence repository differs");
  if (process.env.PONTO_PREDECESSOR_FILE && evidence.predecessor) {
    assert(digestFile(process.env.PONTO_PREDECESSOR_FILE) === evidence.predecessor.artifactSha256, "predecessor artifact digest differs");
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
      `source_sha=${evidence.sourceSha}`,
      `source_tree=${evidence.sourceTree}`,
      `stage=${evidence.stage}`,
      `artifact_sha256=${digestFile(file)}`,
      `timekeeping_candidate_version_id=${evidence.surfaces.timekeeping.candidateVersionId || ""}`,
      `timekeeping_incumbent_version_id=${evidence.surfaces.timekeeping.incumbentVersionId || ""}`,
      `core_candidate_version_id=${evidence.surfaces.coreApi.candidateVersionId || ""}`,
      `core_incumbent_version_id=${evidence.surfaces.coreApi.incumbentVersionId || ""}`,
      `identity_candidate_version_id=${evidence.surfaces.identityWorkforce.candidateVersionId || ""}`,
      `identity_incumbent_version_id=${evidence.surfaces.identityWorkforce.incumbentVersionId || ""}`,
      `identity_checkpoint_artifact=${evidence.checkpoint?.identityWorkforce?.artifactName || ""}`,
      `identity_checkpoint_sha256=${evidence.checkpoint?.identityWorkforce?.sha256 || ""}`,
      `pages_deployment_id=${evidence.surfaces.crmPages.deploymentId || ""}`,
      `pages_rollback_deployment_id=${evidence.surfaces.crmPages.rollbackDeploymentId || ""}`,
      "",
    ].join("\n"));
  }
  process.stdout.write(`Ponto ${evidence.stage} evidence verified for ${evidence.sourceSha}; sha256=${digestFile(file)}\n`);
} else {
  throw new Error("usage: ponto-release-evidence.mjs write|verify <file>");
}
