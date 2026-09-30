#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./codex-autonomy-lib.mjs";
import {
  releaseInputDigest,
  sourceIdentity,
  verifyPreviewEvidence,
} from "./token-vault-native-preview.mjs";

const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9a-fA-F-]{36}$/;
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
const WRANGLER = "wrangler@4.120.0";
const CONFIG = "platform/security/token-vault/wrangler.toml";

function command(args, cwd) {
  const result = spawnSync("npx", ["--yes", WRANGLER, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Wrangler may include account details in diagnostics. Keep this gate's
    // output bounded and free of any provider response body.
    throw new Error(`read-only Wrangler ${args[0]} check failed (${result.status ?? "start"})`);
  }
  try { return JSON.parse(result.stdout); } catch {
    throw new Error(`read-only Wrangler ${args[0]} returned invalid JSON`);
  }
}

export function validateEnvironment(target, env = process.env) {
  if (target !== "staging" && target !== "production") throw new Error("target must be staging or production");
  const get = (name) => String(env[name] || "");
  const configToken = get("TOKEN_VAULT_META_ADS_CONFIG_TOKEN");
  if (!/^[\x21-\x7e]+$/.test(configToken)) throw new Error("Token Vault config bearer must be printable ASCII without BOM or control characters");
  const baseName = target === "staging" ? "TOKEN_VAULT_STAGING_BASE_URL" : "TOKEN_VAULT_PRODUCTION_BASE_URL";
  const base = get(baseName);
  if (!/^https:\/\/[^/]+$/.test(base)) throw new Error(`${baseName} must be an HTTPS origin`);
  const enabledName = target === "staging" ? "ENABLE_TOKEN_VAULT_DEPLOY_STAGING" : "ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY";
  if (get(enabledName) !== "true") throw new Error(`${enabledName} must be true`);
  if (target === "staging") {
    if (get("CONFIRM_STAGING_TRACKING_FIXTURE") !== "true") throw new Error("isolated staging tracking fixture must be confirmed");
    const first = get("META_ADS_NOVOHAMBURGO_PAGE_ID");
    const second = get("META_ADS_BARRASHOPPPINGSUL_PAGE_ID");
    if (!/^[0-9]{5,30}$/.test(first) || !/^[0-9]{5,30}$/.test(second) || first === second) {
      throw new Error("staging Page selectors must be distinct numeric identities");
    }
    if (!/^v(2[5-9]|[3-9][0-9])\.0$/.test(get("META_ADS_API_VERSION"))) {
      throw new Error("META_ADS_API_VERSION must be v25.0 or newer");
    }
    if (!get("META_ADS_ACCESS_TOKEN") || !/^[0-9]{5,30}$/.test(get("META_PIXEL_ID"))
      || !/^(?:act_)?[0-9]{5,30}$/.test(get("META_ADS_ACCOUNT_ID"))) {
      throw new Error("staging synthetic Meta source custody is unavailable or malformed");
    }
    const operationalToken = get("TOKEN_VAULT_N8N_API_TOKEN");
    if (operationalToken.length < 32 || operationalToken === configToken) {
      throw new Error("staging operational bearer is absent, short or reused");
    }
  }
  return { target, base };
}

export function readRemoteFacts(target, root, run = command) {
  const envArgs = target === "staging" ? ["--env", "staging"] : [];
  const database = target === "staging" ? "skincos-token-vault-staging" : "skincos-token-vault";
  const databases = run(["d1", "list", "--json"], root);
  if (!Array.isArray(databases) || !databases.some((row) => row?.name === database)) {
    throw new Error("configured Token Vault D1 is absent");
  }
  const secrets = run(["secret", "list", "--format", "json", "--config", CONFIG, ...envArgs], root);
  if (!Array.isArray(secrets)) throw new Error("remote Worker secret inventory is invalid");
  const names = new Set(secrets.map((row) => typeof row === "string" ? row : row?.name));
  const required = ["TOKEN_VAULT_API_TOKEN", "TOKEN_VAULT_ENCRYPTION_KEY"];
  if (target === "production") required.push("TOKEN_VAULT_N8N_API_TOKEN");
  for (const name of required) if (!names.has(name)) throw new Error(`required inherited Worker secret is absent: ${name}`);
  const deployment = run(["deployments", "status", "--json", "--config", CONFIG, ...envArgs], root);
  const versions = deployment?.versions || deployment?.latest?.versions || [];
  const incumbent = String(versions[0]?.version_id || versions[0]?.id || "");
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100 || !VERSION.test(incumbent)) {
    throw new Error("Token Vault must have exactly one 100-percent incumbent");
  }
  const info = run(["d1", "info", database, "--json", "--config", CONFIG, ...envArgs], root);
  if (String(info?.version ?? info?.result?.version ?? "").trim().toLowerCase() === "alpha") {
    throw new Error("Token Vault D1 Time Travel is unavailable for the legacy alpha backend");
  }
  const travel = run(["d1", "time-travel", "info", database, "--json", "--config", CONFIG, ...envArgs], root);
  const bookmark = String(travel?.bookmark ?? travel?.result?.bookmark ?? "").trim();
  if (!BOOKMARK.test(bookmark)) throw new Error("D1 Time Travel did not return a valid recovery bookmark");
  return {
    database,
    incumbentVersionId: incumbent.toLowerCase(),
    d1TimeTravelBookmark: bookmark,
    analyticsBindingPresent: names.has("TOKEN_VAULT_ANALYTICS_API_TOKEN"),
  };
}

export function verifyReadinessEvidence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("readiness evidence is invalid");
  const { evidenceDigest, ...body } = value;
  if (value.schemaVersion !== 1 || value.kind !== "skincos-token-vault-native-readiness"
    || value.producer !== "codex-ubuntu-24.04" || !["staging", "production"].includes(value.target)
    || value.readOnly !== true || value.mutationAuthorized !== false
    || !VERSION.test(String(value.incumbentVersionId || ""))
    || typeof value.analyticsBindingPresent !== "boolean"
    || !BOOKMARK.test(String(value.d1TimeTravelBookmark || ""))) {
    throw new Error("readiness evidence has an invalid gate result");
  }
  if (!/^[0-9a-f]{64}$/.test(String(evidenceDigest || ""))
    || createHash("sha256").update(canonicalJson(body)).digest("hex") !== evidenceDigest) {
    throw new Error("readiness evidence digest does not match its contents");
  }
  for (const key of ["target", "sourceSha", "sourceTree", "releaseInputDigest", "previewEvidenceDigest"]) {
    if (value[key] !== expected[key]) throw new Error(`readiness evidence ${key} differs from the requested release`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--target", "--source-sha", "--preview-evidence", "--file"].includes(key) || !value || options[key]) {
      throw new Error("usage: token-vault-native-readiness.mjs --target staging|production --source-sha <sha> --preview-evidence <private file> [--file <private output>]");
    }
    options[key] = value;
  }
  if (!options["--target"] || !options["--preview-evidence"] || !SHA.test(String(options["--source-sha"] || "").toLowerCase())) {
    throw new Error("target, preview evidence and a full source SHA are required");
  }
  return {
    target: options["--target"],
    sourceSha: options["--source-sha"].toLowerCase(),
    previewFile: path.resolve(options["--preview-evidence"]),
    outputFile: options["--file"],
  };
}

function outputPath(requested, target, sourceSha, root) {
  const file = path.resolve(requested || path.join(os.homedir(), ".local", "state", "skincos", "token-vault", `${sourceSha}-${target}-readiness.json`));
  const lexicalRelative = path.relative(root, file);
  if (!lexicalRelative.startsWith("..") && !path.isAbsolute(lexicalRelative)) throw new Error("readiness evidence must live outside the repository");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error("readiness directory may not be a symlink");
  if ((fs.statSync(path.dirname(file)).mode & 0o077) !== 0) throw new Error("readiness directory must be private to the operator");
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(path.dirname(file)));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("readiness evidence must live outside the repository");
  if (fs.existsSync(file)) throw new Error("readiness evidence already exists; preserve immutable observations");
  return file;
}

function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04") {
    throw new Error("Token Vault native readiness must run in Ubuntu-24.04 through the typed WSL boundary");
  }
  const options = parseArgs(process.argv.slice(2));
  validateEnvironment(options.target);
  const root = process.cwd();
  const source = sourceIdentity(options.sourceSha, root);
  const digest = releaseInputDigest(options.sourceSha, root);
  const preview = verifyPreviewEvidence(JSON.parse(fs.readFileSync(options.previewFile, "utf8")), {
    ...source,
    releaseInputDigest: digest,
  });
  const file = outputPath(options.outputFile, options.target, options.sourceSha, root);
  const facts = readRemoteFacts(options.target, root);
  if (!facts.analyticsBindingPresent) {
    const analytics = String(process.env.TOKEN_VAULT_ANALYTICS_API_TOKEN || "");
    if (analytics.length < 32 || analytics === process.env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN) {
      throw new Error("missing analytics binding requires a distinct bearer in canonical native custody");
    }
  }
  const body = {
    schemaVersion: 1,
    kind: "skincos-token-vault-native-readiness",
    producer: "codex-ubuntu-24.04",
    target: options.target,
    sourceSha: source.sourceSha,
    sourceTree: source.sourceTree,
    releaseInputDigest: digest,
    previewEvidenceDigest: preview.evidenceDigest,
    ...facts,
    readOnly: true,
    mutationAuthorized: false,
    createdAt: new Date().toISOString(),
  };
  const evidence = { ...body, evidenceDigest: createHash("sha256").update(canonicalJson(body)).digest("hex") };
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Token Vault ${options.target} read-only readiness passed for ${source.sourceSha}\nEvidence: ${file}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
