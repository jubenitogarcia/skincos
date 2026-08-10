import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadPolicy, validatePolicy } from "../../.github/scripts/validate-cloudflare-single-writer.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function jobBlock(workflow, jobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const remainder = workflow.slice(start + 1);
  const next = remainder.search(/\n  [A-Za-z0-9_-]+:/);
  return next === -1 ? remainder : remainder.slice(0, next);
}

test("Cloudflare mutators have one fail-closed writer group and no unclassified workflow", () => {
  const policy = loadPolicy();
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(policy.authority.coordinationPlane, "global");
  assert.equal(policy.authority.mode, "fail-closed");
  assert.equal(policy.pagesGitIntegration.automaticDeploymentsMustBeDisabled, true);
  const crm = policy.coordinationGroups.find((group) => group.id === "crm-cloudflare-writer");
  assert.equal(crm.resource, "global:crm-cloudflare-writer");
  const pontoWorkers = policy.coordinationGroups.find((group) => group.id === "ponto-workers-writer");
  assert.equal(pontoWorkers.resource, "global:ponto-workers-writer");
  assert.match(read(".github/workflows/deploy-crm-pages.yml"), /resource: global:crm-cloudflare-writer/);
  assert.match(read(".github/workflows/cloudflare-pages-sync-ponto.yml"), /global_resource: global:crm-cloudflare-writer/);
  assert.match(read(".github/workflows/cloudflare-workers-sync-ponto-secrets.yml"), /global_resource: global:ponto-workers-writer/);
  const coordinator = read(".github/workflows/deploy-global-coordinator.yml");
  assert.match(coordinator, /global-coordinator-deployment-guard\.mjs/);
  assert.match(coordinator, /global:global-coordinator-writer/);
  assert.match(coordinator, /wrangler@4\.120\.0/);
  assert.match(coordinator, /COORDINATION_SHARED_SECRET/);
  assert.match(coordinator, /COORDINATION_ADMIN_SECRET/);
  assert.match(coordinator, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  assert.match(coordinator, /versions deploy/);
  assert.match(coordinator, /environment: \$\{\{ inputs\.target \}\}/);
  const coordinatorSurface = policy.surfaces.find((surface) => surface.id === "global-coordination-plane");
  assert.equal(coordinatorSurface.canonicalDeployWorkflow, ".github/workflows/deploy-global-coordinator.yml");
  assert.equal(coordinatorSurface.coordinationGroup, "global-coordinator-writer");
});

test("direct Ponto recovery jobs use remote custody at every governed boundary", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  for (const jobName of ["recovery-latch", "recovery-reconcile", "recovery-close", "recovery-rollback"]) {
    const block = jobBlock(workflow, jobName);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-release/);
    assert.match(block, /resource: release:ponto/);
    assert.match(block, /proof_file: \$\{\{ runner\.temp \}\}\/ponto-ordinary-recovery\/global-coordination-lease\.json/);
    assert.match(block, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  }
});

test("legacy recovery and WAF mutators are fail-closed through the same authority", () => {
  const waf = jobBlock(read(".github/workflows/ponto-waf-security.yml"), "apply");
  assert.match(waf, /resource: cloudflare:ponto-waf:production/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(waf.indexOf("Check global WAF mutation lease immediately before WAF mutation") < waf.indexOf("node .github/scripts/ponto-waf-security.mjs"));

  const watchdog = read(".github/workflows/ponto-release-watchdog.yml");
  for (const jobName of ["fail-close", "rollback"]) {
    const block = jobBlock(watchdog, jobName);
    assert.match(block, /resource: release:ponto/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-release/);
  }
  const watchdogRollback = jobBlock(watchdog, "rollback");
  assert.ok(watchdogRollback.indexOf("Check global Ponto recovery lease before broker-close materialization") < watchdogRollback.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(watchdogRollback.indexOf("Check global Ponto recovery lease immediately before watchdog rollback") < watchdogRollback.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));

  const coreRecovery = jobBlock(read(".github/workflows/ponto-staging-core-provenance-recovery.yml"), "rollback");
  assert.match(coreRecovery, /resource: global:ponto-workers-writer/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(coreRecovery.indexOf("Check global Core staging recovery lease immediately before materialization") < coreRecovery.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(coreRecovery.indexOf("Check global Core staging recovery lease immediately before Core rollback") < coreRecovery.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));

  const stagingRecovery = jobBlock(read(".github/workflows/ponto-staging-recovery-rollback.yml"), "rollback");
  assert.match(stagingRecovery, /resource: release:ponto/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(stagingRecovery.indexOf("Check global Ponto recovery lease immediately before staging materialization") < stagingRecovery.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(stagingRecovery.indexOf("Check global Ponto recovery lease immediately before staging rollback") < stagingRecovery.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));
});

test("the reusable check action accepts either an external proof file or an encoded proof", () => {
  const action = read(".github/actions/global-coordination-check/action.yml");
  assert.match(action, /proof_b64:[\s\S]*?required: false/);
  assert.match(action, /proof_file:[\s\S]*?required: false/);
  assert.match(action, /observed_source_sha:[\s\S]*?required: false/);
  assert.match(action, /git fetch --no-tags --force origin main:refs\/remotes\/origin\/main/);
  assert.match(action, /git fetch --no-tags origin "\$GLOBAL_SOURCE_SHA"/);
  assert.match(action, /--source "\$GLOBAL_OBSERVED_SOURCE_SHA"/);
  assert.match(action, /--candidate-source "\$GLOBAL_SOURCE_SHA"/);
  assert.match(action, /inputs\.required == 'true' \|\| github\.event\.inputs\.target == 'production'/);
  assert.match(read(".github/actions/global-coordination-acquire/action.yml"), /github\.event\.inputs\.target == 'production'/);
  assert.match(read(".github/actions/global-coordination-release/action.yml"), /github\.event\.inputs\.target == 'production'/);
  assert.match(action, /GLOBAL_PROOF_FILE_INPUT/);
  assert.match(action, /base64 -d/);
  assert.match(action, /coordination_max_attempts=3/);
  assert.match(action, /Global coordination revalidation failed after/);
});

test("the staging RBAC journey recovers synthetic teardown under a fresh lease", () => {
  const workflow = read(".github/workflows/insumos-staging-rbac-smoke.yml");
  const release = workflow.indexOf("Release staging D1 coordination lease");
  const recoveryAcquire = workflow.indexOf("Reacquire cleanup lease for an orphaned synthetic teardown");
  const recoveryCheck = workflow.indexOf("Revalidate cleanup lease before orphaned teardown");
  const recoveryTeardown = workflow.indexOf("Tear down orphaned synthetic staging identities under recovery lease");
  assert.ok(release >= 0 && recoveryAcquire > release && recoveryCheck > recoveryAcquire && recoveryTeardown > recoveryCheck);
  assert.match(workflow, /steps\.fixture\.outcome == 'success' && steps\.teardown\.outcome != 'success'/);
  assert.match(workflow, /steps\.recovery_check\.outcome == 'success'/);
  assert.match(workflow, /skincos-global-coordination-staging-d1-insumos-cleanup\.json/);
  assert.match(workflow, /refusing a non-staging D1 target/);
});

test("the Ponto composite lease starts before candidate mutation, selects the correct authority, and spans the orchestrator", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  const acquire = workflow.indexOf("Acquire the composite Ponto release lease before candidate mutation");
  const firstDispatch = workflow.indexOf("node .github/scripts/ponto-dispatch-workflow.mjs");
  const release = workflow.indexOf("Release the composite Ponto release lease");
  assert.ok(acquire >= 0 && firstDispatch > acquire && release > firstDispatch);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATOR_URL: \$\{\{ contains\(fromJSON\('\["preview","staging"\]'\)/);
  assert.match(workflow, /coordinator_url: \$\{\{ env\.SKINCOS_GLOBAL_COORDINATOR_URL \}\}/);
  assert.match(read(".github/scripts/ponto-dispatch-workflow.mjs"), /revalidatePontoCompositeLease/);
  assert.match(read(".github/scripts/ponto-dispatch-workflow.mjs"), /cancelActiveChildBestEffort/);
  assert.match(read(".github/scripts/ponto-source-closure.mjs"), /assertPontoSourceClosureUnchanged/);
  assert.match(read(".github/scripts/ponto-source-closure.mjs"), /assertDependencyClosureUnchanged/);
  for (const workflowName of [
    ".github/workflows/module-availability.yml",
    ".github/workflows/ponto-production-baseline.yml",
    ".github/workflows/ponto-production-slo.yml",
    ".github/workflows/ponto-staging-rollback-drill.yml",
    ".github/workflows/timekeeping-staging-journey.yml",
  ]) {
    assert.match(read(workflowName), /release:ponto-child/);
  }
});

test("Ponto child dispatch is pinned to the immutable release identity", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  const dispatcher = read(".github/scripts/ponto-dispatch-workflow.mjs");
  const identity = read(".github/scripts/ponto-release-identity.mjs");
  const acquire = workflow.indexOf("Acquire the composite Ponto release lease before candidate mutation");
  const establish = workflow.indexOf("Establish immutable Ponto release identity");
  const dispatch = workflow.indexOf("node .github/scripts/ponto-dispatch-workflow.mjs");
  assert.ok(acquire >= 0 && establish > acquire && dispatch > establish);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /ponto-release-identity\.mjs create/);
  assert.match(workflow, /ponto-release-identity\.mjs finalize/);
  assert.match(workflow, /release-identity\.json/);
  assert.match(workflow, /release-identity-final\.json/);
  assert.match(workflow, /PONTO_RELEASE_IDENTITY_SOURCE_JSON/);
  assert.match(dispatcher, /PONTO_RELEASE_IDENTITY_FILE/);
  assert.match(dispatcher, /verifyRemotePontoReleaseRef/);
  assert.match(dispatcher, /ref: releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /expectedHeadBranch: releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /headShaMatches: \(headSha\) => String\(headSha/);
  assert.match(dispatcher, /run\.head_branch !== releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /run\.head_sha \|\| \"\"\)\.trim\(\)\.toLowerCase\(\) !== orchestratorHeadSha/);
  assert.doesNotMatch(dispatcher, /ref: \"main\"/);
  assert.doesNotMatch(dispatcher, /runs\?event=workflow_dispatch&branch=main/);
  assert.match(identity, /releaseRefFor/);
  assert.match(identity, /RELEASE_TAG_PREFIX = "skincos\/release"/);
  assert.match(identity, /releaseIdentityDigest/);
  assert.match(identity, /sourceIdentityDigest/);
  assert.match(identity, /artifactBindingsFromSurfaces/);
  assert.match(identity, /finalizeReleaseIdentity/);
  assert.match(identity, /git\/refs/);
});

test("merge:main is a fail-closed GitHub mutation authority", () => {
  const script = read("scripts/codex-global-merge-authority.mjs");
  const workflow = read(".github/workflows/global-merge-authority.yml");
  const scheduler = read(".github/workflows/codex-keep-prs-mergeable.yml");
  const policy = JSON.parse(read("ops/governance/global-concurrency-policy.json"));
  assert.match(script, /const resource = "merge:main"/);
  assert.match(script, /expectedHeadSha/);
  assert.match(script, /checkGlobalLease/);
  assert.match(script, /acquireMergeLease/);
  assert.match(script, /incompatible-release-lease/);
  assert.match(script, /merge:main lease remained unavailable/);
  assert.match(script, /global-merge-authority/);
  assert.match(script, /setMergeAuthorityStatus/);
  assert.match(script, /loadMergeCandidate/);
  assert.match(read("scripts/codex-github-integration-candidate.mjs"), /changedPaths/);
  assert.match(read("scripts/codex-github-integration-candidate.mjs"), /previous_filename/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /skincos-integration-gate/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /loadMergeCandidateIdentity/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /pathToFileURL/);
  const integrationGate = read(".github/workflows/skincos-integration-gate.yml");
  assert.match(integrationGate, /pull_request_target/);
  assert.match(integrationGate, /ref: main/);
  assert.match(integrationGate, /Fetch the exact PR base tree used for closure admission/);
  assert.doesNotMatch(integrationGate, /ref: \$\{\{ github\.event\.pull_request\./);
  const integrationRecheck = read(".github/workflows/skincos-integration-gate-recheck.yml");
  assert.match(integrationRecheck, /schedule:/);
  assert.match(integrationRecheck, /--max-wait-ms 15000/);
  assert.match(integrationRecheck, /gh api --paginate/);
  assert.match(integrationRecheck, /gate_state/);
  assert.match(integrationRecheck, /--jq '\[\.\[\] \| select\(\.context == "skincos-integration-gate"\)\]\[0\]\.state \/\/ ""'/);
  assert.doesNotMatch(integrationRecheck, /--jq '[^\n]*\/\/ ""\)"/);
  assert.match(read("ops/cloudflare/global-coordinator/index.js"), /buildLegacyIntentV1/);
  assert.match(read("scripts/codex-global-coordination-workflow.mjs"), /admission paths are not bound/);
  assert.match(script, /\/pulls\/\$\{pullNumber\}\/merge/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /ref: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /state=failure/);
  assert.match(workflow, /run-name: Merge PR #\$\{\{ inputs\.pull_number \}\} through merge:main/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GH_TOKEN \}\}/);
  assert.match(workflow, /SKINCOS_STATUS_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(script, /SKINCOS_STATUS_TOKEN/);
  assert.doesNotMatch(scheduler, /enablePullRequestAutoMerge/);
  assert.match(scheduler, /disablePullRequestAutoMerge/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.match(scheduler, /resource: merge:main/);
  assert.match(scheduler, /Detect whether branch maintenance needs merge:main/);
  assert.match(scheduler, /steps\.maintenance_scan\.outputs\.needs_maintenance == 'true'/);
  assert.match(scheduler, /steps\.acquire_branch_maintenance\.outcome == 'success'/);
  assert.match(scheduler, /ALLOW_BRANCH_UPDATES/);
  assert.match(scheduler, /always\(\)/);
  assert.match(scheduler, /allowBranchUpdates/);
  assert.match(read(".github/actions/global-coordination-release/action.yml"), /max_attempts=5/);
  assert.match(read(".codex/hooks/skincos-supervisor-gate.py"), /resource_declaration/);
  assert.match(read("skills/skincos-project-orchestrator/references/supervisor-cycle.md"), /technical wait\/blocker/);
  assert.deepEqual(policy.releaseClosures.merge.patterns, ["**"]);
  assert.match(policy.resourceClasses.mutate, /^\^mutate:/);
  assert.equal(policy.admission.coordinationPlane, "global");
  const ruleset = JSON.parse(read(".github/governance/rulesets/main-enterprise-baseline.json"));
  const requiredContexts = ruleset.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.map((entry) => entry.context);
  assert.deepEqual(requiredContexts, ["codex-autonomy-gate", "global-merge-authority", "skincos-integration-gate"]);
  assert.ok(ruleset.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.every((entry) => entry.integration_id === 15368));
});

test("native mini-PC mutations use the common coordinator and detached closure proof", () => {
  const adapter = read("scripts/runtime/global-coordination-mini-pc.sh");
  const nativeHelper = read("scripts/runtime/global-coordination-native.sh");
  assert.match(adapter, /GLOBAL_COORDINATION_PROVIDER='mini-pc'/);
  assert.match(adapter, /SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/);
  assert.match(adapter, /proof must remain below the private mini-PC proof root/);
  assert.match(adapter, /An immutable dependency-closure attestation is required/);
  assert.match(nativeHelper, /native_coordination_init/);
  assert.match(nativeHelper, /native_coordination_check/);
  assert.match(nativeHelper, /native_coordination_renew_if_due/);
  assert.match(nativeHelper, /global-coordination-mini-pc\.sh/);
  assert.match(nativeHelper, /immutable_root=.*\/opt\/skincos\/releases/);

  const prepare = read("scripts/runtime/prepare-native-source-release.sh");
  assert.match(prepare, /--coordination-closure/);
  assert.match(prepare, /coordination closure identity or digest is invalid/);
  assert.match(prepare, /\.skincos-global-coordination-\$\{closure_module\}\.json/);
  assert.match(prepare, /coordination_native_runtime_closure/);
  assert.match(prepare, /native-runtime dependency-closure attestation is required/);

  const atendimentoPrepare = read("scripts/runtime/prepare-atendimento-staging-release.sh");
  assert.match(atendimentoPrepare, /--coordination-closure/);
  assert.match(atendimentoPrepare, /native_coordination_init release:atendimento/);
  assert.match(atendimentoPrepare, /\.skincos-global-coordination-atendimento\.json/);
  assert.match(read("scripts/runtime/prepare-atendimento-production-release.sh"), /native_coordination_init release:atendimento/);
  assert.match(read("scripts/runtime/rollback-atendimento-staging.sh"), /native_coordination_init deploy:atendimento:staging/);

  const lifecycle = read("scripts/runtime/install-lifecycle-units.sh");
  assert.match(lifecycle, /native_coordination_init global:native-runtime/);
  assert.match(lifecycle, /native-runtime\.json/);
  assert.match(read("scripts/runtime/manage-native-runtime.sh"), /native_coordination_init global:native-runtime/);
  assert.match(read("scripts/runtime/prepare-lifecycle-layout.sh"), /--coordination-closure/);
  assert.match(read("scripts/runtime/retire-clientes-source-refresh-service.sh"), /native_coordination_init global:native-runtime/);

  const mirror = read("scripts/sync-atendimento-local-mirror.sh");
  assert.match(mirror, /native_coordination_init deploy:atendimento:local/);
  assert.match(mirror, /SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE/);

  const mcp = read("scripts/runtime/mcp-gateway-release.sh");
  assert.match(mcp, /promotion:orb-mcp:local/);
  assert.match(mcp, /\.skincos-global-coordination-orb\.json/);
  assert.match(mcp, /\.skincos-release-identity-orb\.json/);
  assert.match(mcp, /native_coordination_check/);
  const backup = read("scripts/runtime/run-orb-backup-with-coordination.sh");
  assert.match(backup, /global:orb-backup/);
  assert.match(backup, /orb-backup\.service/);
  assert.match(read("scripts/runtime/publish-orb-backup.ps1"), /run-orb-backup-with-coordination\.sh/);
  const harmonia = read("scripts/runtime/run-harmonia-migration-native.sh");
  assert.match(harmonia, /deploy:atendimento:staging/);
  assert.match(harmonia, /deploy:atendimento:production/);
  assert.match(harmonia, /native_coordination_check/);
  const migration = read("scripts/run-atendimento-staging-migration.sh");
  assert.match(migration, /if \[\[ "\$ACTION" != '--dry-run' \]\]; then\s+native_coordination_check/);
  const tunnel = read("scripts/runtime/install-atendimento-production-tunnel.sh");
  assert.match(tunnel, /systemctl daemon-reload[\s\S]*coordination_run check[\s\S]*systemctl enable --now/);

  for (const [file, resource] of [
    ["scripts/provision-atendimento-staging.sh", "deploy:atendimento:staging"],
    ["scripts/set-atendimento-staging-control.sh", "deploy:atendimento:staging"],
    ["scripts/run-atendimento-staging-migration.sh", "deploy:atendimento:staging"],
    ["scripts/refresh-atendimento-staging-quality.sh", "deploy:atendimento:staging"],
    ["scripts/provision-atendimento-production-readonly.sh", "deploy:atendimento:production"],
    ["scripts/set-atendimento-production-readonly-control.sh", "deploy:atendimento:production"],
  ]) {
    const script = read(file);
    assert.match(script, new RegExp(`native_coordination_init ${resource.replaceAll(":", "\\:")}`));
    assert.match(script, /COORDINATION_CLOSURE|SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE/);
    assert.match(script, /native_coordination_check/);
  }

  const orb = read("scripts/runtime/promote-native-source-release.sh");
  assert.match(orb, /--resource release:native-runtime/);
  assert.match(orb, /\.skincos-global-coordination-native-runtime\.json/);
  assert.match(orb, /\.skincos-release-identity-native-runtime\.json/);
  assert.match(orb, /--release-identity-file/);
  assert.match(orb, /coordination_renew_if_due/);
  assert.ok(orb.includes("coordination_check >/dev/null"));

  const whatsapp = read("scripts/runtime/prepare-messaging-whatsapp-release.sh");
  assert.match(whatsapp, /--resource release:orb/);
  assert.match(whatsapp, /--coordination-closure/);

  const dns = read("scripts/runtime/route-atendimento-production-dns.sh");
  assert.match(dns, /--resource cloudflare:atendimento:production/);
  assert.match(dns, /--source-sha/);

  const rollback = read("scripts/runtime/rollback-atendimento-production.sh");
  assert.match(rollback, /--resource deploy:atendimento:production/);
  assert.match(rollback, /coordination_acquired/);
  assert.match(rollback, /--coordination-proof-file "\$coordination_proof" --coordination-reuse/);
  assert.match(read("scripts/runtime/global-coordination-native.sh"), /NATIVE_COORDINATION_OWNED/);
  assert.match(read("scripts/runtime/install-atendimento-production-service.sh"), /--coordination-reuse/);
  assert.match(read("scripts/set-atendimento-production-readonly-control.sh"), /--coordination-reuse/);
  assert.match(read("scripts/run-atendimento-staging-migration.sh"), /run_sudo_clean \/usr\/bin\/bash -p "\$RUNTIME_GRANT_LOCKDOWN" --apply/);
  assert.match(read("scripts/runtime/prepare-atendimento-staging-release.sh"), /native_coordination_cleanup\ncoordination_acquired=0\ntrap - EXIT/);
});

test("the scheduled native backup bridge carries private custody and a stable owner identity", () => {
  const publisher = read("scripts/runtime/publish-orb-backup.ps1");
  const runner = read("scripts/runtime/run-orb-backup-with-coordination.sh");
  assert.match(publisher, /SKINCOS_GLOBAL_COORDINATION_ENV_FILE=/);
  assert.match(publisher, /GLOBAL_COORDINATION_MISSION_ID=windows:skincos-orb-backup/);
  assert.match(publisher, /GLOBAL_COORDINATION_THREAD_ID=scheduled:SkincosOrbBackup/);
  assert.match(publisher, /GLOBAL_COORDINATION_ACTOR=windows-scheduled-task/);
  assert.match(runner, /COORDINATION_ENV_FILE=.*orb-backup\.env/);
  assert.match(runner, /unsupported key/);
  assert.match(runner, /mode 0600 or 0640/);
});

test("shared staging D1 custody serializes synthetic mutators before every write path", () => {
  const financeCanary = read(".github/workflows/finance-staging-canary.yml");
  const financeIdentity = read(".github/workflows/finance-staging-smoke-identity.yml");
  const timekeepingJourney = jobBlock(read(".github/workflows/timekeeping-staging-journey.yml"), "journey");

  for (const workflow of [financeCanary, financeIdentity, timekeepingJourney]) {
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-release/);
    assert.match(workflow, /resource: global:staging-d1/);
    assert.match(workflow, /proof_file: \$\{\{ runner\.temp \}\}\/skincos-global-coordination-[^\n]*staging-d1\.json/);
  }

  assert.ok(financeCanary.indexOf("Check shared staging D1 lease before opening synthetic canary") < financeCanary.indexOf("Open deterministic synthetic canary"));
  assert.ok(financeCanary.indexOf("Check shared staging D1 lease before baseline restore") < financeCanary.indexOf("Restore non-enabled staging baseline and synthetic grant"));
  assert.ok(financeIdentity.indexOf("Check shared staging D1 lease before identity lifecycle SQL") < financeIdentity.indexOf("Apply audited staging identity lifecycle SQL"));
  assert.ok(timekeepingJourney.indexOf("Check shared staging D1 lease before synthetic staging provisioning") < timekeepingJourney.indexOf("Provision only run-scoped synthetic staging records"));
  assert.ok(timekeepingJourney.indexOf("Check shared staging D1 lease before authenticated Ponto journey") < timekeepingJourney.indexOf("Execute authenticated Ponto journey"));
  assert.match(timekeepingJourney, /id: check_staging_d1_teardown/);
  assert.match(timekeepingJourney, /steps\.check_staging_d1_teardown\.outcome == 'success'/);
});

test("general CRM Pages checks out trusted local coordination actions before using them", () => {
  const workflow = read(".github/workflows/deploy-crm-pages.yml");
  const checkout = workflow.indexOf("Checkout trusted general coordination actions");
  const authorization = workflow.indexOf("uses: ./.github/actions/global-coordination-check", checkout);

  assert.ok(checkout >= 0, "general Pages deploy must prepare the local coordination action");
  assert.ok(authorization > checkout, "the coordination action must be available before authorization");
  assert.match(workflow.slice(checkout, authorization), /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow.slice(checkout, authorization), /inputs\.release_scope == 'general'/);
});

test("the reusable orchestrator gate exposes global lease outputs to callers", () => {
  const workflow = read(".github/workflows/ponto-orchestrator-gate.yml");

  assert.match(workflow, /GLOBAL_RESOURCE.*\^global:\[a-z0-9\]/s);
  assert.match(workflow, /steps\.global_enabled\.outputs\.proof_b64/);
  assert.match(workflow, /steps\.global_enabled\.outputs\.url/);
  assert.match(workflow, /id: global_enabled/);
  assert.match(workflow, /id: global_disabled/);
  assert.doesNotMatch(workflow, /steps\.global-(?:enabled|disabled)\.outputs/);
});

test("CRM Pages deploy declares coordination as a direct dependency for lease outputs", () => {
  const workflow = read(".github/workflows/deploy-crm-pages.yml");

  assert.match(workflow, /\n  deploy:\n    # The deploy job reads lease outputs from the reusable coordination job\.[\s\S]*?\n    needs: \[coordination, promotion\]/);
});
