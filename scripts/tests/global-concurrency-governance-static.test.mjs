import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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
  assert.match(coreRecovery, /resource: deploy:core-api:staging/);
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
  assert.match(action, /GLOBAL_PROOF_FILE_INPUT/);
  assert.match(action, /base64 -d/);
});

test("merge:main is a fail-closed GitHub mutation authority", () => {
  const script = read("scripts/codex-global-merge-authority.mjs");
  const workflow = read(".github/workflows/global-merge-authority.yml");
  const scheduler = read(".github/workflows/codex-keep-prs-mergeable.yml");
  const policy = JSON.parse(read("ops/governance/global-concurrency-policy.json"));
  assert.match(script, /const resource = "merge:main"/);
  assert.match(script, /expectedHeadSha/);
  assert.match(script, /checkGlobalLease/);
  assert.match(script, /global-merge-authority/);
  assert.match(script, /setMergeAuthorityStatus/);
  assert.match(script, /\/pulls\/\$\{pullNumber\}\/merge/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /state=failure/);
  assert.match(workflow, /run-name: Merge PR #\$\{\{ inputs\.pull_number \}\} through merge:main/);
  assert.doesNotMatch(scheduler, /enablePullRequestAutoMerge/);
  assert.match(scheduler, /disablePullRequestAutoMerge/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.match(scheduler, /resource: merge:main/);
  assert.deepEqual(policy.releaseClosures.merge.patterns, ["**"]);
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
  assert.match(orb, /--resource release:orb/);
  assert.match(orb, /\.skincos-release-identity-orb\.json/);
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
