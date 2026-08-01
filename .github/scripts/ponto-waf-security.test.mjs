import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PONTO_WAF_RULES,
  attestContract,
  buildDesiredRules,
  captureSnapshot,
  execute,
  publicSnapshot,
  writableRule,
} from "./ponto-waf-security.mjs";

const zoneId = "1".repeat(32);
const rulesetId = "2".repeat(32);
const headerRuleId = "3".repeat(32);
const contractRuleId = "4".repeat(32);
const skipRuleId = "5".repeat(32);
const releaseSha = "a".repeat(40);
const workflow = fs.readFileSync(
  ".github/workflows/ponto-waf-security.yml",
  "utf8",
);

test("standalone WAF apply proves split custody before write-token hydration", () => {
  const custodyIndex = workflow.indexOf(
    "Attest split WAF token custody before hydrating write authority",
  );
  const writeIndex = workflow.indexOf(
    "PONTO_WAF_WRITE_API_TOKEN: ${{ secrets.PONTO_WAF_WRITE_API_TOKEN }}",
  );
  assert(custodyIndex >= 0 && writeIndex > custodyIndex);
  assert.match(
    workflow.slice(custodyIndex, writeIndex),
    /actions\/secrets\?per_page=100/,
  );
  assert.match(
    workflow.slice(custodyIndex, writeIndex),
    /environments\/staging\/secrets\?per_page=100/,
  );
  assert.match(
    workflow.slice(custodyIndex, writeIndex),
    /environments\/production\/secrets\?per_page=100/,
  );
  assert.match(
    workflow.slice(custodyIndex, writeIndex),
    /orgs\/\$owner_login\/actions\/secrets\?per_page=100/,
  );
  assert.match(
    workflow.slice(custodyIndex, writeIndex),
    /!repository\.has\(read\)[\s\S]*repository\.has\(write\)[\s\S]*owner\.has\(read\)[\s\S]*owner\.has\(write\)[\s\S]*staging\.has\(read\)[\s\S]*staging\.has\(write\)[\s\S]*production\.has\(read\)[\s\S]*!production\.has\(write\)/,
  );
});

test("standalone WAF probe refuses organization or environment secret fallback", () => {
  const custodyIndex = workflow.indexOf(
    "Attest read-only WAF token custody before hydrating probe authority",
  );
  const readIndex = workflow.indexOf(
    "PONTO_WAF_READ_API_TOKEN: ${{ secrets.PONTO_WAF_READ_API_TOKEN }}",
  );
  const block = workflow.slice(custodyIndex, readIndex);
  assert(custodyIndex >= 0 && readIndex > custodyIndex);
  for (const required of [
    "actions/secrets?per_page=100",
    "environments/staging/secrets?per_page=100",
    "environments/production/secrets?per_page=100",
    "orgs/$owner_login/actions/secrets?per_page=100",
    "!repository.has(read)",
    "repository.has(write)",
    "owner.has(read)",
    "owner.has(write)",
    "staging.has(read)",
    "staging.has(write)",
    "production.has(read)",
  ]) {
    assert(block.includes(required), `missing probe custody check: ${required}`);
  }
});

const skipRule = () => ({
  id: skipRuleId,
  version: "1",
  last_updated: "2026-07-30T00:00:00.000Z",
  ref: "existing_skip",
  description: "Existing reviewed skip",
  expression: 'http.host eq "unrelated.example"',
  action: "skip",
  action_parameters: { ruleset: "current" },
  logging: { enabled: true },
  enabled: true,
});

const desiredRule = (index) => ({
  ...PONTO_WAF_RULES[index],
  id: index === 0 ? headerRuleId : contractRuleId,
  version: "1",
  last_updated: "2026-07-30T00:00:00.000Z",
});

const entrypoint = (rules = [desiredRule(0), desiredRule(1), skipRule()], version = "7") => ({
  id: rulesetId,
  name: "default",
  description: "existing entrypoint",
  kind: "zone",
  phase: "http_request_firewall_custom",
  version,
  last_updated: "2026-07-30T00:00:00.000Z",
  rules,
});

function envelope(result, status = 200) {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    result,
    errors: status >= 400 ? [{ code: 1000, message: "not found" }] : [],
    messages: [],
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cloudflareHarness(initialEntrypoint = null) {
  const state = {
    entrypoint: initialEntrypoint ? structuredClone(initialEntrypoint) : null,
    methods: [],
    sequence: 6,
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = String(init.method || "GET").toUpperCase();
    if (parsed.origin === "https://api.cloudflare.com") {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer security-token");
      state.methods.push({ method, pathname: parsed.pathname });
      if (parsed.pathname === "/client/v4/accounts/" + "6".repeat(32) + "/tokens/verify") {
        return envelope({ status: "active" });
      }
      if (parsed.pathname === `/client/v4/zones/${zoneId}`) {
        return envelope({
          id: zoneId,
          name: "skincos.com.br",
          status: "active",
          account: { id: "6".repeat(32) },
        });
      }
      if (parsed.pathname === "/client/v4/filters/validate-expr") {
        assert(PONTO_WAF_RULES.some((rule) => rule.expression === parsed.searchParams.get("expression")));
        return envelope(null);
      }
      if (
        parsed.pathname
        === `/client/v4/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`
      ) {
        if (method === "GET") {
          return state.entrypoint ? envelope(state.entrypoint) : envelope(null, 404);
        }
        assert.equal(method, "PUT");
        const body = JSON.parse(init.body);
        state.sequence += 1;
        state.entrypoint = entrypoint(
          body.rules.map((rule, index) => ({
            ...rule,
            id: rule.id || (index === 0 ? headerRuleId : contractRuleId),
            version: String(state.sequence),
            last_updated: "2026-07-30T00:01:00.000Z",
          })),
          String(state.sequence),
        );
        state.entrypoint.description = body.description;
        return envelope(state.entrypoint);
      }
      if (parsed.pathname === `/client/v4/zones/${zoneId}/rulesets` && method === "POST") {
        const body = JSON.parse(init.body);
        state.sequence += 1;
        state.entrypoint = entrypoint(
          body.rules.map((rule, index) => ({
            ...rule,
            id: index === 0 ? headerRuleId : contractRuleId,
            version: String(state.sequence),
            last_updated: "2026-07-30T00:01:00.000Z",
          })),
          String(state.sequence),
        );
        state.entrypoint.description = body.description;
        return envelope(state.entrypoint);
      }
      if (
        parsed.pathname === `/client/v4/zones/${zoneId}/rulesets/${rulesetId}`
        && method === "DELETE"
      ) {
        state.entrypoint = null;
        return envelope(null);
      }
      throw new Error(`unexpected Cloudflare request: ${method} ${parsed.pathname}`);
    }

    const headers = new Headers(init.headers);
    const forbiddenHeader = headers.has("cloudflare-workers-version-overrides")
      || headers.has("cloudflare-workers-version-key");
    const blockedPath = [
      "/insumos/health/workforce-contract",
      "/%69nsumos/health/workforce-contract",
      "/%2569nsumos/health/workforce-contract",
      "/INSUMOS/HEALTH/WORKFORCE-CONTRACT",
    ].includes(parsed.pathname);
    const status = forbiddenHeader || blockedPath ? 403 : 200;
    return new Response("{}", {
      status,
      headers: { "cf-ray": "test-ray", server: "cloudflare" },
    });
  };
  return { state, fetchImpl };
}

const envFor = (mode, artifactDir) => ({
  PONTO_WAF_MODE: mode,
  CLOUDFLARE_ZONE_ID: zoneId,
  [mode === "probe" ? "PONTO_WAF_READ_API_TOKEN" : "PONTO_WAF_WRITE_API_TOKEN"]: "security-token",
  GITHUB_SHA: releaseSha,
  GITHUB_RUN_ID: mode === "probe" ? "100" : "101",
  PONTO_WAF_ARTIFACT_DIR: artifactDir,
});

test("contract uses supported fail-closed Cloudflare Rules language primitives", () => {
  assert.match(PONTO_WAF_RULES[0].expression, /http\.request\.headers\.truncated/);
  assert.match(PONTO_WAF_RULES[0].expression, /has_key\(http\.request\.headers,/);
  assert.match(PONTO_WAF_RULES[1].expression, /lower\(url_decode\(http\.request\.uri\.path, "r"\)\)/);
  assert.equal(PONTO_WAF_RULES.every((rule) => rule.action === "block" && rule.enabled === true), true);
});

test("reconciliation places both exact blocks first and preserves every supported field of unrelated rules", () => {
  const existing = [skipRule(), desiredRule(1), desiredRule(0)];
  const desired = buildDesiredRules(existing);
  assert.deepEqual(desired.slice(0, 2).map((rule) => rule.id), [headerRuleId, contractRuleId]);
  assert.deepEqual(desired[2], writableRule(skipRule()));
  const attested = attestContract(entrypoint(desired));
  assert.equal(attested.headerRuleId, headerRuleId);
  assert.equal(attested.contractRuleId, contractRuleId);
});

test("a preceding skip, duplicate identity, or unknown field fails closed", () => {
  assert.throws(
    () => attestContract(entrypoint([skipRule(), desiredRule(0), desiredRule(1)])),
    /position 0/,
  );
  assert.throws(
    () => buildDesiredRules([desiredRule(0), { ...desiredRule(0), id: "7".repeat(32) }]),
    /ambiguous/,
  );
  assert.throws(
    () => captureSnapshot(entrypoint([{ ...skipRule(), future_unknown_field: true }])),
    /unsupported fields/,
  );
});

test("expression identity preserves literal case after whitespace normalization", () => {
  const wrongLiteralCase = {
    ...desiredRule(1),
    expression: PONTO_WAF_RULES[1].expression.replace(
      '"/insumos/health/workforce-contract"',
      '"/INSUMOS/HEALTH/WORKFORCE-CONTRACT"',
    ),
  };
  assert.throws(
    () => attestContract(entrypoint([desiredRule(0), wrongLiteralCase])),
    /position 1/,
  );
  const reconciled = buildDesiredRules([desiredRule(0), wrongLiteralCase]);
  assert.equal(reconciled[1].expression, PONTO_WAF_RULES[1].expression);
  assert.equal(reconciled[1].id, contractRuleId);
  assert.equal(reconciled.length, 2);
});

test("release edge attestation also preserves literal case", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "ponto-edge-override-guard.mjs"),
    "utf8",
  );
  const normalization = source.match(
    /const normalizeExpression = value =>[\s\S]*?\.replace\(\/\\s\+\/g, " "\);/,
  )?.[0] || "";
  assert.match(normalization, /\.trim\(\)/);
  assert.doesNotMatch(normalization, /\.toLowerCase\(\)/);
});

test("sanitized snapshots retain rollback identity and hashes without expressions", () => {
  const snapshot = publicSnapshot(captureSnapshot(entrypoint()));
  assert.equal(snapshot.rulesetId, rulesetId);
  assert.equal(snapshot.rulesetVersion, "7");
  assert.match(snapshot.snapshotDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(snapshot.contentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(snapshot).includes("unrelated.example"), false);
  assert.equal(snapshot.credentialsIncluded, false);
  assert.equal(snapshot.piiIncluded, false);
});

test("probe is GET-only, proves exact zone/read scope and validates both expressions", async () => {
  const harness = cloudflareHarness(null);
  const report = await execute({
    env: envFor("probe", "unused"),
    fetchImpl: harness.fetchImpl,
    writeFiles: false,
  });
  assert.equal(report.passed, true);
  assert.equal(report.mutated, false);
  assert.equal(report.custody.customRulesetPresent, false);
  assert.equal(report.custody.expressionDialectValidated, true);
  assert.equal(report.custody.expressionDigests.length, 2);
  assert.equal(harness.state.methods.every((request) => request.method === "GET"), true);
  assert.equal(JSON.stringify(report).includes("security-token"), false);
});

test("apply requires an exact probe preimage, atomically prefixes the rules and preserves unrelated rules", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-waf-test-"));
  try {
    const harness = cloudflareHarness(entrypoint([skipRule()]));
    const probe = await execute({
      env: envFor("probe", directory),
      fetchImpl: harness.fetchImpl,
      writeFiles: false,
    });
    const probeFile = path.join(directory, "probe.json");
    fs.writeFileSync(probeFile, JSON.stringify(probe));
    const report = await execute({
      env: {
        ...envFor("apply", directory),
        PONTO_WAF_PROBE_REPORT: probeFile,
      },
      fetchImpl: harness.fetchImpl,
      writeFiles: false,
    });
    assert.equal(report.passed, true);
    assert.equal(report.mutated, true);
    assert.deepEqual(
      harness.state.entrypoint.rules.slice(0, 2).map((rule) => rule.id),
      [headerRuleId, contractRuleId],
    );
    assert.deepEqual(writableRule(harness.state.entrypoint.rules[2]), writableRule(skipRule()));
    assert.equal(report.requiredRepositoryVariables.automaticallyWritten, false);
    assert.equal(report.probes.every((probe) => probe.passed), true);
    assert.equal(JSON.stringify(report).includes("security-token"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("apply refuses live drift before PUT", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-waf-drift-"));
  try {
    const harness = cloudflareHarness(entrypoint([skipRule()]));
    const probe = await execute({
      env: envFor("probe", directory),
      fetchImpl: harness.fetchImpl,
      writeFiles: false,
    });
    const probeFile = path.join(directory, "probe.json");
    fs.writeFileSync(probeFile, JSON.stringify(probe));
    harness.state.entrypoint.rules[0].description = "drifted";
    await assert.rejects(
      execute({
        env: {
          ...envFor("apply", directory),
          PONTO_WAF_PROBE_REPORT: probeFile,
        },
        fetchImpl: harness.fetchImpl,
        writeFiles: false,
      }),
      /probe predecessor is invalid or live state drifted/,
    );
    assert.equal(harness.state.methods.some((request) => request.method === "PUT"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed post-apply block probe restores the exact prior rule content", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-waf-rollback-"));
  try {
    const before = entrypoint([skipRule()]);
    const harness = cloudflareHarness(before);
    let failBlockProbe = false;
    const fetchImpl = async (url, init = {}) => {
      const parsed = new URL(url);
      const headers = new Headers(init.headers);
      if (
        failBlockProbe
        && parsed.origin !== "https://api.cloudflare.com"
        && headers.has("cloudflare-workers-version-overrides")
      ) {
        return new Response("{}", {
          status: 200,
          headers: { "cf-ray": "test-ray", server: "cloudflare" },
        });
      }
      return harness.fetchImpl(url, init);
    };
    const probe = await execute({
      env: envFor("probe", directory),
      fetchImpl,
      writeFiles: false,
    });
    const probeFile = path.join(directory, "probe.json");
    fs.writeFileSync(probeFile, JSON.stringify(probe));
    failBlockProbe = true;
    await assert.rejects(
      execute({
        env: {
          ...envFor("apply", directory),
          PONTO_WAF_PROBE_REPORT: probeFile,
        },
        fetchImpl,
        writeFiles: false,
      }),
      /automatic rollback passed/,
    );
    assert.deepEqual(
      harness.state.entrypoint.rules.map(writableRule),
      captureSnapshot(before).rules,
    );
    assert.equal(
      harness.state.methods.filter((request) => request.method === "PUT").length,
      2,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed post-apply probe refuses to overwrite concurrent live WAF drift", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-waf-probe-drift-"));
  try {
    const harness = cloudflareHarness(entrypoint([skipRule()]));
    let failBlockProbe = false;
    let drifted = false;
    const fetchImpl = async (url, init = {}) => {
      const parsed = new URL(url);
      const headers = new Headers(init.headers);
      if (
        failBlockProbe
        && !drifted
        && parsed.origin !== "https://api.cloudflare.com"
        && headers.has("cloudflare-workers-version-overrides")
      ) {
        drifted = true;
        harness.state.entrypoint.rules[2].description =
          "Concurrent reviewed operator edit";
        return new Response("{}", {
          status: 200,
          headers: { "cf-ray": "test-ray", server: "cloudflare" },
        });
      }
      return harness.fetchImpl(url, init);
    };
    const probe = await execute({
      env: envFor("probe", directory),
      fetchImpl,
      writeFiles: false,
    });
    const probeFile = path.join(directory, "probe.json");
    fs.writeFileSync(probeFile, JSON.stringify(probe));
    failBlockProbe = true;
    await assert.rejects(
      execute({
        env: {
          ...envFor("apply", directory),
          PONTO_WAF_PROBE_REPORT: probeFile,
        },
        fetchImpl,
        writeFiles: false,
      }),
      /ownership-conflict|not the exact owned desired postimage/,
    );
    assert.equal(
      harness.state.entrypoint.rules[2].description,
      "Concurrent reviewed operator edit",
    );
    assert.equal(
      harness.state.methods.filter((request) => request.method === "PUT").length,
      1,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  { name: "PUT", before: () => entrypoint([skipRule()]) },
  { name: "POST", before: () => null },
]) {
  test(`${scenario.name} applied on the server then transport failure restores the exact preimage`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-waf-indeterminate-"));
    try {
      const before = scenario.before();
      const harness = cloudflareHarness(before);
      let failMutation = false;
      let failedOnce = false;
      const fetchImpl = async (url, init = {}) => {
        const method = String(init.method || "GET").toUpperCase();
        if (failMutation && !failedOnce && method === scenario.name) {
          const response = await harness.fetchImpl(url, init);
          failedOnce = true;
          throw new Error(`${scenario.name} transport failed after server apply`);
        }
        return harness.fetchImpl(url, init);
      };
      const probe = await execute({
        env: envFor("probe", directory),
        fetchImpl,
        writeFiles: false,
      });
      const probeFile = path.join(directory, "probe.json");
      fs.writeFileSync(probeFile, JSON.stringify(probe));
      failMutation = true;
      await assert.rejects(
        execute({
          env: {
            ...envFor("apply", directory),
            PONTO_WAF_PROBE_REPORT: probeFile,
          },
          fetchImpl,
          writeFiles: false,
        }),
        /automatic rollback passed/,
      );
      if (before) {
        assert.deepEqual(
          harness.state.entrypoint.rules.map(writableRule),
          captureSnapshot(before).rules,
        );
        assert.equal(
          harness.state.methods.filter((request) => request.method === "PUT").length,
          2,
        );
      } else {
        assert.equal(harness.state.entrypoint, null);
        assert.equal(
          harness.state.methods.filter((request) => request.method === "POST").length,
          1,
        );
        assert.equal(
          harness.state.methods.filter((request) => request.method === "DELETE").length,
          1,
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
