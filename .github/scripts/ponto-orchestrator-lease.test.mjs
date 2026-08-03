import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalizeGovernedIntent,
  acceptsWorkflowRunPath,
  createCapabilityCheck,
  expectedGovernedRunName,
  transitionCapabilityDocument,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

const script = fileURLToPath(new URL("./ponto-orchestrator-lease.mjs", import.meta.url));
const repositoryRoot = path.resolve(path.dirname(script), "../..");
const repository = "skincos/example";
const releaseSha = "a".repeat(40);
const orchestratorRunId = "12345";
const stage = "staging";
const target = "staging";
const stagingPair = crypto.generateKeyPairSync("ed25519");
const productionPair = crypto.generateKeyPairSync("ed25519");
const stagingPrivateKey = stagingPair.privateKey.export({ type: "pkcs8", format: "pem" });
const stagingPublicKey = stagingPair.publicKey.export({ type: "spki", format: "pem" });
const publicKeysJson = JSON.stringify({
  staging: { keyId: "staging-2026-07", publicKeyPem: stagingPublicKey },
  production: {
    keyId: "production-2026-07",
    publicKeyPem: productionPair.publicKey.export({ type: "spki", format: "pem" }),
  },
});
const repositoryId = "42";
const childRunId = "67890";
const dispatchNonce = "b".repeat(32);

const execute = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: releaseSha,
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_REPOSITORY_ID: repositoryId,
      GITHUB_TOKEN: "test-token",
      PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON: publicKeysJson,
      ...env,
    },
  }, (error, stdout, stderr) => {
    resolve({ code: error?.code ?? 0, stdout, stderr });
  });
});

const canonicalRun = (overrides = {}) => ({
  id: Number(orchestratorRunId),
  workflow_id: 77,
  path: ".github/workflows/ponto-progressive-release.yml",
  run_attempt: 1,
  status: "in_progress",
  conclusion: null,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: releaseSha,
  name: `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`,
  repository: { id: Number(repositoryId), full_name: repository },
  head_repository: { id: Number(repositoryId), full_name: repository },
  display_title: `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`,
  ...overrides,
});

const withApi = async ({ run = canonicalRun(), artifact }, callback) => {
  let deleted = false;
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    response.setHeader("content-type", "application/json");
    if (request.url === `/repos/${repository}/actions/workflows/ponto-progressive-release.yml`) {
      response.end(JSON.stringify({
        id: 77,
        state: "active",
        path: ".github/workflows/ponto-progressive-release.yml",
      }));
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/${orchestratorRunId}`) {
      response.end(JSON.stringify(run));
      return;
    }
    if (request.url?.startsWith(`/repos/${repository}/actions/runs/${orchestratorRunId}/artifacts?`)) {
      response.end(JSON.stringify({ artifacts: deleted || !artifact ? [] : [artifact] }));
      return;
    }
    if (request.url === `/repos/${repository}/actions/artifacts/${artifact?.id}` && request.method === "DELETE") {
      deleted = true;
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await callback({
      apiUrl: `http://127.0.0.1:${address.port}`,
      getRequestCount: () => requestCount,
      wasDeleted: () => deleted,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

const workflow = name => fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", name), "utf8");
const job = (source, name) => {
  const marker = `  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `job ${name} is absent`);
  const remaining = source.slice(start + marker.length);
  const next = /\n  [a-zA-Z0-9_-]+:\n/.exec(remaining);
  return source.slice(start, next ? start + marker.length + next.index : source.length);
};

test("assert-active accepts only the exact live first-attempt coordinator", async () => {
  await withApi({}, async ({ apiUrl }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /active first-attempt Ponto coordinator/);
  });
});

test("workflow run provenance accepts both live GitHub REST path forms", () => {
  const workflowPath = ".github/workflows/deploy-timekeeping.yml";
  assert.equal(acceptsWorkflowRunPath(workflowPath, workflowPath), true);
  assert.equal(acceptsWorkflowRunPath(workflowPath, `${workflowPath}@refs/heads/main`), true);
  assert.equal(acceptsWorkflowRunPath(workflowPath, ".github/workflows/other.yml"), false);
  assert.equal(acceptsWorkflowRunPath(workflowPath, `${workflowPath}@refs/heads/feature`), false);
});

test("Ponto workflow REST provenance gates accept both live path forms", () => {
  const workflowNames = [
    "cloudflare-pages-sync-ponto.yml",
    "cloudflare-workers-sync-ponto-secrets.yml",
    "deploy-timekeeping.yml",
    "ponto-production-baseline.yml",
    "ponto-progressive-release.yml",
    "ponto-release-gate.yml",
    "ponto-staging-rollback-drill.yml",
  ];
  for (const workflowName of workflowNames) {
    const source = fs.readFileSync(
      path.join(repositoryRoot, ".github", "workflows", workflowName),
      "utf8",
    );
    assert.match(
      source,
      /\[\s*(?:expectedPath|workflow\.path),\s*`\$\{(?:expectedPath|workflow\.path)\}@refs\/heads\/main`\s*\]\.includes\(run\.path\)/,
      `${workflowName} must accept both GitHub REST workflow path forms`,
    );
    assert.doesNotMatch(
      source,
      /run\.path\s*!==\s*(?:expectedPath|workflow\.path)|run\.path\s*===\s*workflow\.path/,
      `${workflowName} must not require one REST path spelling`,
    );
  }
});

test("Pages custody journals no mutation before any precondition can fail", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "cloudflare-pages-sync-ponto.yml"),
    "utf8",
  );
  const journalIndex = source.indexOf("- name: Initialize Pages mutation journal before checkout, setup, and preconditions");
  const verifyIndex = source.indexOf("- name: Verify immutable source and production predecessor");
  const journalBlock = source.slice(journalIndex, verifyIndex);
  assert.ok(journalIndex >= 0, "Pages custody must initialize its mutation journal");
  assert.ok(verifyIndex > journalIndex, "Pages custody must journal before immutable preconditions");
  assert.match(journalBlock, /pages-release-probe-evidence\.json/);
  assert.match(journalBlock, /mutationStarted: false/);
  assert.match(journalBlock, /credentialsIncluded: false/);
  assert.match(journalBlock, /piiIncluded: false/);
  assert.match(journalBlock, /- name: Initialize Pages mutation journal before checkout, setup, and preconditions[\s\S]+- uses: actions\/checkout@/);
  assert.ok(
    journalBlock.indexOf("[[ -n \"$PROJECT\" ]]") > journalBlock.indexOf("pages-release-probe-evidence.json"),
    "Pages project validation must follow journal creation",
  );
});

test("Ponto root custody provenance uses workflow metadata for the static workflow name", () => {
  for (const workflowName of [
    "cloudflare-pages-sync-ponto.yml",
    "deploy-timekeeping.yml",
  ]) {
    const source = fs.readFileSync(
      path.join(repositoryRoot, ".github", "workflows", workflowName),
      "utf8",
    );
    assert.match(source, /workflow\.name !== "Attest Ponto Worker secret custody"/);
    assert.doesNotMatch(source, /run\.name !== "Attest Ponto Worker secret custody"/);
  }
});

test("Pages custody uses structured Cloudflare project env_vars for inventory checks", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "cloudflare-pages-sync-ponto.yml"),
    "utf8",
  );
  assert.match(source, /pages\/projects\/\$PROJECT/);
  assert.match(source, /deployment_configs\?\.production\?\.env_vars/);
  assert.match(source, /Object\.keys\(envVars\)/);
  const journalWriterStart = source.indexOf('node - "$before_project_file" "$evidence_file" <<\'NODE\'');
  const journalWriterEnd = source.indexOf("\n          NODE", journalWriterStart);
  assert.ok(journalWriterStart >= 0, "Pages custody must have a before-inventory journal writer");
  assert.ok(journalWriterEnd > journalWriterStart, "Pages journal writer heredoc must terminate");
  assert.match(
    source.slice(journalWriterStart, journalWriterEnd),
    /fs\.writeFileSync\(process\.argv\[3\]/,
  );
  assert.doesNotMatch(source, /pages secret list/);
  assert.doesNotMatch(source, /normalize_wrangler_array/);
});

test("Pages deploy gates use trusted inline API attestation instead of promoted checkout scripts", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "deploy-crm-pages.yml"),
    "utf8",
  );
  assert.match(source, /pages\/projects\/\$PAGES_PROJECT/);
  assert.match(source, /pages\/projects\/\$PROJECT/);
  assert.match(source, /deployment_configs\?\.production\?\.env_vars/);
  assert.match(source, /node - "\$pages_project" "\$DEPLOY_TARGET" <<'NODE'/);
  assert.match(source, /node - "\$pages_project" "\$TARGET" <<'NODE'/);
  for (const command of [
    'node - "$pages_project" "$DEPLOY_TARGET" <<\'NODE\'',
    'node - "$pages_project" "$TARGET" <<\'NODE\'',
  ]) {
    const start = source.indexOf(command);
    assert.ok(start >= 0, `missing Pages attestation command: ${command}`);
    const delimiter = source.slice(start).match(/\n([ \t]+)NODE\n/);
    assert.ok(delimiter, `missing heredoc delimiter after: ${command}`);
    assert.equal(delimiter[1].length, 10, `heredoc delimiter indentation drifted after: ${command}`);
  }
  assert.match(source, /binding\.type !== "secret_text"/);
  assert.doesNotMatch(source, /pages secret list/);
  assert.doesNotMatch(source, /ponto-pages-environment-attestation\.mjs/);
});

test("assert-active rejects a rerun of the privileged child before any API access", async () => {
  await withApi({}, async ({ apiUrl, getRequestCount }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl, GITHUB_RUN_ATTEMPT: "2" },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refuse workflow reruns/);
    assert.equal(getRequestCount(), 0);
  });
});

test("assert-active rejects a full rerun of the coordinator", async () => {
  await withApi({ run: canonicalRun({ run_attempt: 2 }) }, async ({ apiUrl }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /exact active first-attempt issuer/);
  });
});

const timekeepingIntent = (overrides = {}) => ({
  target: "staging",
  release_sha: releaseSha,
  release_scope: "ponto",
  orchestrator_run_id: orchestratorRunId,
  orchestrator_stage: stage,
  orchestrator_issuer_run_id: orchestratorRunId,
  orchestrator_nonce: dispatchNonce,
  ...overrides,
});

const issuedCapability = () => {
  const canonical = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent(),
  );
  const check = createCapabilityCheck({
    privateKey: stagingPrivateKey,
    keyId: "staging-2026-07",
    repositoryId,
    repository,
    parentWorkflowId: 77,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: orchestratorRunId,
    issuerWorkflowId: 77,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: orchestratorRunId,
    childWorkflowId: 88,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId,
    leaseKey: "timekeeping",
    stage,
    target,
    releaseSha,
    dispatchNonce,
    intentDigest: canonical.digest,
  });
  return { canonical, check, document: JSON.parse(check.output.summary) };
};

test("typed intent binds every dispatch input and derives the exact nonce run name", () => {
  const base = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent(),
  );
  const changed = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent({ predecessor_run_id: "9001" }),
  );
  assert.notEqual(base.digest, changed.digest);
  assert.equal(
    expectedGovernedRunName(".github/workflows/deploy-timekeeping.yml", base.normalizedInputs),
    `Timekeeping staging ${releaseSha} orchestrator=${orchestratorRunId} nonce=${dispatchNonce}`,
  );
  assert.throws(() => canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    { ...timekeepingIntent(), unexpected: "confused-deputy" },
  ), /unknown inputs/);
});

test("issued capability is Ed25519-bound to target, root, issuer, child, nonce, and typed intent", () => {
  const { canonical, check, document } = issuedCapability();
  assert.equal(check.status, "in_progress");
  assert.equal(check.conclusion, undefined);
  assert.match(check.name, new RegExp(`/${childRunId}/${dispatchNonce}$`));
  const expected = {
    publicKey: stagingPublicKey,
    keyId: "staging-2026-07",
    repositoryId,
    repository,
    parentWorkflowId: 77,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: orchestratorRunId,
    issuerWorkflowId: 77,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: orchestratorRunId,
    childWorkflowId: 88,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId,
    leaseKey: "timekeeping",
    stage,
    target,
    releaseSha,
    dispatchNonce,
    intentDigest: canonical.digest,
  };
  assert.equal(verifyCapabilityDocument(document, expected).target, target);
  assert.equal(document.transition.state, "issued");
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, intentDigest: "c".repeat(64) }),
    /claims or Ed25519 signature differ/,
  );
  const consumed = transitionCapabilityDocument(document, {
    state: "consumed",
  });
  assert.equal(consumed.signature.valueBase64url, document.signature.valueBase64url);
  assert.deepEqual(consumed.claims, document.claims);
  assert.equal(verifyCapabilityDocument(consumed, { ...expected, state: "consumed" }).target, target);
  assert.equal(consumed.transition.state, "consumed");
  const wrong = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, publicKey: wrong }),
    /Ed25519 signature differ/,
  );
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, target: "production" }),
    /Ed25519 signature differ/,
  );
});

test("consume-check rejects a child rerun before any API access", async () => {
  await withApi({}, async ({ apiUrl, getRequestCount }) => {
    const result = await execute(
      ["consume-check", "timekeeping", stage, target, releaseSha, orchestratorRunId],
      {
        GITHUB_API_URL: apiUrl,
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: childRunId,
        GITHUB_EVENT_PATH: "unused",
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refuse workflow reruns/);
    assert.equal(getRequestCount(), 0);
  });
});

test("every orchestrated secret or mutation job revalidates the coordinator after checkout and before secrets", () => {
  const guardedJobs = [
    ["deploy-timekeeping.yml", "release"],
    ["deploy-core-workers.yml", "ponto-identity-staging"],
    ["deploy-core-workers.yml", "deploy"],
    ["deploy-core-workers.yml", "ponto-progressive-release"],
    ["deploy-core-workers.yml", "ponto-identity-progressive-release"],
    ["deploy-crm-pages.yml", "deploy"],
    ["deploy-crm-pages.yml", "ponto-progressive-release"],
    ["cloudflare-workers-sync-ponto-secrets.yml", "provision"],
    ["cloudflare-pages-sync-ponto.yml", "provision"],
    ["module-availability.yml", "set-state"],
    ["ponto-production-baseline.yml", "capture"],
    ["ponto-production-slo.yml", "consultor-journey"],
    ["ponto-production-slo.yml", "rollback-observation"],
    ["timekeeping-staging-journey.yml", "journey"],
    ["ponto-staging-rollback-drill.yml", "drill"],
  ];
  for (const [file, jobName] of guardedJobs) {
    const source = job(workflow(file), jobName);
    const checkout = source.indexOf("actions/checkout@");
    const assertion = source.indexOf("ponto-orchestrator-lease.mjs assert-active");
    const firstEnvironmentSecret = source.indexOf("${{ secrets.");
    assert.ok(checkout >= 0, `${file}:${jobName} must checkout trusted code`);
    assert.ok(assertion > checkout, `${file}:${jobName} must assert after checkout`);
    assert.ok(firstEnvironmentSecret < 0 || assertion < firstEnvironmentSecret, `${file}:${jobName} must assert before environment secrets`);
  }
});

test("every privileged Ponto mutation job refuses workflow reruns without blocking preview or general paths", () => {
  const firstAttemptJobs = [
    ["ponto-progressive-release.yml", "orchestrate"],
    ["deploy-timekeeping.yml", "release"],
    ["deploy-core-workers.yml", "ponto-identity-staging"],
    ["deploy-core-workers.yml", "deploy"],
    ["deploy-core-workers.yml", "ponto-progressive-release"],
    ["deploy-core-workers.yml", "ponto-identity-progressive-release"],
    ["deploy-crm-pages.yml", "deploy"],
    ["deploy-crm-pages.yml", "ponto-progressive-release"],
    ["cloudflare-workers-sync-ponto-secrets.yml", "provision"],
    ["cloudflare-pages-sync-ponto.yml", "provision"],
    ["module-availability.yml", "set-state"],
    ["module-availability.yml", "emergency-reconciliation"],
    ["ponto-emergency-latch-reset.yml", "reset-mutate"],
    ["ponto-emergency-close.yml", "close"],
    ["ponto-emergency-close.yml", "materialize"],
    ["ponto-production-baseline.yml", "capture"],
    ["ponto-production-slo.yml", "consultor-journey"],
    ["ponto-production-slo.yml", "rollback-observation"],
    ["timekeeping-staging-journey.yml", "journey"],
    ["ponto-staging-rollback-drill.yml", "drill"],
    ["ponto-core-baseline-publisher.yml", "staging"],
    ["ponto-core-baseline-publisher.yml", "production"],
  ];
  for (const [file, jobName] of firstAttemptJobs) {
    assert.match(job(workflow(file), jobName), /github\.run_attempt == 1/, `${file}:${jobName} lacks an attempt-one job guard`);
  }

  assert.doesNotMatch(job(workflow("deploy-timekeeping.yml"), "preview"), /github\.run_attempt == 1/);
  assert.match(
    job(workflow("deploy-core-workers.yml"), "deploy"),
    /inputs\.release_scope != 'ponto' \|\| github\.run_attempt == 1/,
  );
  assert.match(
    job(workflow("deploy-crm-pages.yml"), "deploy"),
    /inputs\.release_scope != 'ponto' \|\| github\.run_attempt == 1/,
  );
  assert.match(workflow("ponto-orchestrator-gate.yml"), /Governed Ponto capabilities cannot be consumed from a workflow rerun/);
  assert.match(workflow("module-availability.yml"), /Historical emergency-stop reruns are forbidden/);
  assert.match(workflow("ponto-emergency-latch-reset.yml"), /Historical latch-reset reruns are forbidden/);
});

test("latch reset accepts only a fresh manual close reattestation title", () => {
  const reset = workflow("ponto-emergency-latch-reset.yml");
  assert.match(reset, /\.github\/workflows\/ponto-emergency-close\.yml/);
  assert.match(reset, /run\?\.display_title !== `Ponto emergency close \$\{process\.env\.TARGET\}`/);
  assert.match(reset, /ponto-emergency-close-\$TARGET-\$EMERGENCY_RUN_ID/);
  assert.match(reset, /maintenance\?\.passed !== true/);
  assert.match(reset, /String\(run\?\.id \|\| ""\) !== process\.env\.EMERGENCY_RUN_ID/);
  assert.match(reset, /run\?\.run_attempt !== 1/);
  assert.match(reset, /Automatic watchdog\/ordinary latches are intentionally not reset/);
});

test("recovery artifact downloads isolate extraction before merging attested evidence", () => {
  for (const file of ["ponto-release-watchdog.yml", "ponto-progressive-release.yml"]) {
    const source = workflow(file);
    assert.match(
      source,
      /download_dir="\$\(mktemp -d "\$PONTO_RECOVERY_ARTIFACT_ROOT\/\.artifact-download\.XXXXXX"\)"/,
      `${file} must isolate each artifact extraction`,
    );
    assert.match(source, /--dir "\$download_dir"/, `${file} must download into the isolated directory`);
    assert.match(
      source,
      /cp -a "\$download_dir"\/\. "\$PONTO_RECOVERY_ARTIFACT_ROOT\/\$destination\/"/,
      `${file} must merge the isolated artifact after extraction`,
    );
    assert.doesNotMatch(
      source,
      /--dir "\$PONTO_RECOVERY_ARTIFACT_ROOT\/\$destination"/,
      `${file} must not extract directly into a pre-populated evidence directory`,
    );
  }
});

test("staging Pages incumbent capture retries and requires exact terminal provenance", () => {
  const source = workflow("deploy-crm-pages.yml");
  const start = source.indexOf("- name: Capture Ponto staging Pages rollback deployment");
  const end = source.indexOf("- name: Deploy to Cloudflare Pages (wrangler)", start);
  assert.ok(start >= 0 && end > start, "staging Pages incumbent capture block is absent");
  const block = source.slice(start, end);
  assert.match(block, /for attempt in \{1\.\.12\}; do/);
  assert.match(block, /deployments\?env=production&page=\$page&per_page=25/);
  assert.match(block, /PAGES_STAGING_ALIAS: crm-staging\.skincos\.com\.br/);
  assert.match(block, /result_info\?\.total_pages/);
  assert.match(block, /totalPages > 100/);
  assert.match(block, /item\?\.environment === "production" \|\| item\?\.environment == null/);
  assert.match(block, /inventory_ok=false/);
  assert.match(block, /--retry-all-errors/);
  assert.match(block, /\.sort\(\(a, b\) => Date\.parse\(String\(b\?\.created_on/);
  assert.match(block, /const expectedAlias = process\.env\.PAGES_STAGING_ALIAS/);
  assert.match(block, /aliases\.has\(expectedAlias\)/);
  assert.match(block, /deployments\.length === 1/);
  assert.match(block, /metadata\.branch === "staging"/);
  assert.match(block, /String\(selected\.deployment_trigger\?\.metadata\?\.commit_hash \|\| ""\)\.toLowerCase\(\)/);
  assert.match(block, /stage\?\.status === "success"/);
  assert.match(block, /Number\.isFinite\(Date\.parse\(String\(stage\?\.ended_on/);
  assert.match(block, /if \[\[ "\$attempt" != 12 \]\]; then sleep 5; fi/);
  assert.doesNotMatch(block, /Unable to resolve staging Pages rollback deployment/);
});

test("Pages configs keep remote secrets out of Wrangler Pages configuration", () => {
  for (const relativePath of ["crm/console/wrangler.toml", "crm/console/.wrangler-staging/wrangler.toml"]) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /^\[secrets\]/m, `${relativePath} must not declare unsupported Pages secrets`);
    assert.doesNotMatch(source, /^\[env\.(?:production|preview)\.secrets\]/m, `${relativePath} must not declare unsupported environment secrets`);
  }
});

test("staging Pages compensation fails closed when an owned candidate cannot be attested", () => {
  const source = workflow("deploy-crm-pages.yml");
  const start = source.indexOf("- name: Restore Ponto staging Pages incumbent after failure or cancellation");
  const end = source.indexOf("- name: Write Ponto staging Pages mutation journal", start);
  assert.ok(start >= 0 && end > start, "staging Pages compensation block is absent");
  const block = source.slice(start, end);
  assert.match(block, /candidate_id="\$\{PAGES_STAGING_CANDIDATE_DEPLOYMENT_ID:-\}"/);
  assert.match(block, /resolved=false/);
  assert.match(block, /--pending/);
  assert.match(block, /Unable to attest the exact staging Pages candidate/);
  assert.match(block, /deployments\/\$candidate_id/);
  assert.match(block, /String\(deployment\?\.id \|\| ""\)\.toLowerCase\(\)/);
  assert.match(block, /deployment\?\.production_branch !== "staging"/);
  assert.match(block, /restored staging Pages deployment identity or alias differs/);
  assert.doesNotMatch(block, /restored Pages deployment is not latest/);
  assert.match(block, /exit 1/);
  assert.doesNotMatch(block, /preserving the incumbent without a rollback mutation/);
});

test("Ponto staging Pages resolves and compensates candidates from the API inventory", () => {
  const source = workflow("deploy-crm-pages.yml");
  const deployStart = source.indexOf("- name: Deploy to Cloudflare Pages (wrangler)");
  const restoreEnd = source.indexOf("- name: Write Ponto staging Pages mutation journal", deployStart);
  assert.ok(deployStart >= 0 && restoreEnd > deployStart, "Ponto Pages deployment block is absent");
  const block = source.slice(deployStart, restoreEnd);
  assert.match(block, /ponto-pages-candidate\.mjs/);
  assert.match(source, /Preserve trusted Ponto Pages candidate resolver before release checkout/);
  assert.match(source, /node "\$RUNNER_TEMP\/ponto-pages-candidate\.mjs"/);
  assert.match(block, /PAGES_STAGING_DEPLOYMENT_STARTED_AT/);
  assert.match(block, /env=production&page=\$page&per_page=25/);
  assert.match(block, /inventory_ok=false/);
  assert.match(block, /--retry-all-errors/);
  assert.doesNotMatch(block, /ponto-wrangler-output\.mjs/);
  assert.match(block, /PAGES_STAGING_CANDIDATE_DEPLOYMENT_ID=\$candidate_id/);
});
