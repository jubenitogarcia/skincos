import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED = Object.freeze({
  staging: Object.freeze({
    d1Id: "0f79d918-c11b-432a-9d0b-70f74f3347c7",
    d1Name: "skincos-timekeeping-staging",
    kvId: "e69fe06b6abc46eca4f4c00198d078f2",
    kvTitle: "SKINCOS_WORKFORCE_STAGING_FLAGS",
  }),
  production: Object.freeze({
    d1Id: "a642ee56-1d14-40f0-8237-044a12258ba9",
    d1Name: "skincos-timekeeping",
    kvId: "918e9a82ee9d4d9c9effd81f04e093f5",
    kvTitle: "skincos-module-control-production",
  }),
});

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const readCloudflareJson = async ({ fetchImpl, token, pathname, label }) => {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4${pathname}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${response.status})`);
  }
  if (!response.ok || envelope?.success !== true) {
    const codes = (envelope?.errors || [])
      .map((entry) => entry?.code)
      .filter((code) => Number.isInteger(code))
      .join(",");
    throw new Error(`${label} GET failed (HTTP ${response.status}${codes ? `, Cloudflare ${codes}` : ""})`);
  }
  return envelope.result;
};

/**
 * Fail closed unless the selected IDs resolve, in the configured account, to
 * the exact immutable Ponto resource names for the selected environment.
 *
 * At least one resource ID is required. The output intentionally hashes
 * account/resource IDs so that evidence can be retained without publishing
 * infrastructure identifiers.
 */
export async function attestPontoCloudflareResources({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const token = required(env, "CLOUDFLARE_API_TOKEN");
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID").toLowerCase();
  const target = required(env, "PONTO_RESOURCE_TARGET").toLowerCase();
  const d1Id = String(env.PONTO_TIMEKEEPING_D1_ID || "").trim().toLowerCase();
  const kvId = String(env.PONTO_MODULE_CONTROL_KV_ID || "").trim().toLowerCase();
  const oppositeD1Id = String(env.PONTO_OPPOSITE_TIMEKEEPING_D1_ID || "").trim().toLowerCase();
  const oppositeKvId = String(env.PONTO_OPPOSITE_MODULE_CONTROL_KV_ID || "").trim().toLowerCase();
  if (!HEX32.test(accountId) || !Object.hasOwn(EXPECTED, target)) {
    throw new Error("Ponto Cloudflare account or target identity is malformed");
  }
  if (!d1Id && !kvId) throw new Error("at least one Ponto Cloudflare resource ID is required");
  if (d1Id && !UUID.test(d1Id)) throw new Error("Ponto Timekeeping D1 UUID is malformed");
  if (kvId && !HEX32.test(kvId)) throw new Error("Ponto module-control KV ID is malformed");

  const expected = EXPECTED[target];
  const opposite = EXPECTED[target === "staging" ? "production" : "staging"];
  if (
    (d1Id && (d1Id !== expected.d1Id || oppositeD1Id !== opposite.d1Id || d1Id === oppositeD1Id))
    || (kvId && (kvId !== expected.kvId || oppositeKvId !== opposite.kvId || kvId === oppositeKvId))
  ) throw new Error("Ponto selected/opposite immutable resource IDs are invalid");
  const [d1, kv] = await Promise.all([
    d1Id
      ? readCloudflareJson({
        fetchImpl,
        token,
        pathname: `/accounts/${accountId}/d1/database/${encodeURIComponent(d1Id)}?fields=uuid,name`,
        label: "Ponto Timekeeping D1 inventory",
      })
      : null,
    kvId
      ? readCloudflareJson({
        fetchImpl,
        token,
        pathname: `/accounts/${accountId}/storage/kv/namespaces/${encodeURIComponent(kvId)}`,
        label: "Ponto module-control KV inventory",
      })
      : null,
  ]);

  if (
    d1
    && (
      String(d1.uuid || "").toLowerCase() !== d1Id
      || d1.name !== expected.d1Name
    )
  ) throw new Error("Ponto Timekeeping D1 exact UUID/name identity is invalid");
  if (
    kv
    && (
      String(kv.id || "").toLowerCase() !== kvId
      || kv.title !== expected.kvTitle
    )
  ) throw new Error("Ponto module-control KV exact ID/title identity is invalid");

  return {
    schemaVersion: 1,
    target,
    accountIdSha256: digest(accountId),
    d1: d1 ? {
      idSha256: digest(d1Id),
      oppositeIdSha256: digest(oppositeD1Id),
      name: expected.d1Name,
      exactAccountScopedGet: true,
      passed: true,
    } : null,
    moduleControlKv: kv ? {
      idSha256: digest(kvId),
      oppositeIdSha256: digest(oppositeKvId),
      title: expected.kvTitle,
      exactAccountScopedGet: true,
      passed: true,
    } : null,
    requestMethods: ["GET"],
    credentialsIncluded: false,
    piiIncluded: false,
    passed: true,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const report = await attestPontoCloudflareResources();
  const reportFile = String(process.env.PONTO_RESOURCE_IDENTITY_REPORT || "").trim();
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`Exact ${report.target} Ponto Cloudflare resource identity attested.\n`);
}
