#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDetachedRelease } from "../token-vault-native-release-identity.mjs";

const SHA = /^[0-9a-f]{40}$/;
const ROOT = path.resolve(import.meta.dirname, "../..");
const CUSTODY_ROOT = "/etc/skincos/token-vault";
const COMMON = new Set(["TOKEN_VAULT_META_ADS_CONFIG_TOKEN", "TOKEN_VAULT_ANALYTICS_API_TOKEN"]);
const TARGET_KEYS = {
  staging: new Set([
    "TOKEN_VAULT_STAGING_BASE_URL", "ENABLE_TOKEN_VAULT_DEPLOY_STAGING",
    "CONFIRM_STAGING_TRACKING_FIXTURE", "TOKEN_VAULT_N8N_API_TOKEN",
    "META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID", "META_PIXEL_ID",
    "META_ADS_API_VERSION", "META_ADS_NOVOHAMBURGO_PAGE_ID",
    "META_ADS_BARRASHOPPPINGSUL_PAGE_ID", "TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST",
    "TOKEN_VAULT_CONFIG_BEARER_MODE",
  ]),
  production: new Set(["TOKEN_VAULT_PRODUCTION_BASE_URL", "ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY"]),
};

function rootMetadata(file, { directory, mode, group = 0 }) {
  const stat = fs.lstatSync(file);
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()
    || stat.uid !== 0 || (group !== null && stat.gid !== group) || (stat.mode & 0o777) !== mode) {
    throw new Error("native Token Vault credential custody metadata is unsafe");
  }
  return stat;
}

export function parseNativeCredentials(raw, target) {
  const allowed = TARGET_KEYS[target];
  if (!allowed || typeof raw !== "string" || Buffer.byteLength(raw) > 256 * 1024) {
    throw new Error("native Token Vault credential document is invalid");
  }
  const values = {};
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 1 || !/^[A-Z][A-Z0-9_]*$/.test(name)
      || !(COMMON.has(name) || allowed.has(name)) || Object.hasOwn(values, name)
      || !value || value !== value.trim() || !/^[\x20-\x7e]+$/.test(value)) {
      throw new Error("native Token Vault credential document contains an unsafe record");
    }
    values[name] = value;
  }
  const required = target === "staging" ? [
    "TOKEN_VAULT_META_ADS_CONFIG_TOKEN", "TOKEN_VAULT_STAGING_BASE_URL", "ENABLE_TOKEN_VAULT_DEPLOY_STAGING",
    "CONFIRM_STAGING_TRACKING_FIXTURE", "TOKEN_VAULT_N8N_API_TOKEN", "META_ADS_ACCESS_TOKEN",
    "META_ADS_ACCOUNT_ID", "META_PIXEL_ID", "META_ADS_API_VERSION",
    "META_ADS_NOVOHAMBURGO_PAGE_ID", "META_ADS_BARRASHOPPPINGSUL_PAGE_ID",
  ] : ["TOKEN_VAULT_META_ADS_CONFIG_TOKEN", "TOKEN_VAULT_PRODUCTION_BASE_URL", "ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY"];
  if (required.some((name) => !Object.hasOwn(values, name))) {
    throw new Error("native Token Vault credential custody is incomplete for its target");
  }
  if (Object.hasOwn(values, "TOKEN_VAULT_CONFIG_BEARER_MODE")
    && values.TOKEN_VAULT_CONFIG_BEARER_MODE !== "overlap") {
    throw new Error("native Token Vault config bearer mode must be staging overlap");
  }
  return values;
}

function privateCredentials(target) {
  rootMetadata("/etc/skincos", { directory: true, mode: 0o750, group: null });
  rootMetadata(CUSTODY_ROOT, { directory: true, mode: 0o700 });
  const file = `${CUSTODY_ROOT}/native-${target}.env`;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o777) !== 0o600
      || before.size > 256 * 1024) throw new Error("native Token Vault credential file is unsafe");
    const raw = fs.readFileSync(fd, "utf8");
    const after = fs.fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      throw new Error("native Token Vault credential file changed during readback");
    }
    return parseNativeCredentials(raw, target);
  } finally { fs.closeSync(fd); }
}

function boundedStdin() {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(16 * 1024);
  let size = 0;
  while (true) {
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    size += count;
    if (size > 256 * 1024) throw new Error("native Token Vault credential input exceeds the private limit");
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function provisionCredentials(target) {
  const raw = boundedStdin();
  const values = parseNativeCredentials(raw, target);
  rootMetadata("/etc/skincos", { directory: true, mode: 0o750, group: null });
  if (!fs.existsSync(CUSTODY_ROOT)) fs.mkdirSync(CUSTODY_ROOT, { mode: 0o700 });
  rootMetadata(CUSTODY_ROOT, { directory: true, mode: 0o700 });
  const destination = `${CUSTODY_ROOT}/native-${target}.env`;
  if (fs.existsSync(destination)) {
    throw new Error("native Token Vault credential target already exists; use a governed rotation with rollback");
  }
  const temporary = `${CUSTODY_ROOT}/.native-${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, raw.endsWith("\n") ? raw : `${raw}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { fs.linkSync(temporary, destination); } finally { fs.unlinkSync(temporary); }
  const directoryFd = fs.openSync(CUSTODY_ROOT, "r");
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  process.stdout.write(`Token Vault ${target} native credential custody created (${Object.keys(values).length} approved keys)\n`);
}

function optionsFor(argv) {
  const [mode, ...rest] = argv;
  if (!["provision", "readiness", "publish"].includes(mode)) throw new Error("usage: native secret custody provision|readiness|publish ...");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!["--source-sha", "--target", "--preview-evidence", "--observation-file", "--readiness-evidence",
      "--transaction-id", "--checkout-root", "--staging-evidence"].includes(key) || !value || options[key]) {
      throw new Error("native Token Vault secret custody arguments are invalid");
    }
    options[key] = value;
  }
  if (!SHA.test(String(options["--source-sha"] || "")) || !TARGET_KEYS[options["--target"]]
    || (mode === "provision" && Object.keys(options).length !== 2)
    || (mode !== "provision" && !options["--preview-evidence"])
    || (mode === "readiness" && (!options["--observation-file"] || Object.keys(options).length !== 4))
    || (mode === "publish" && (!options["--readiness-evidence"] || !options["--transaction-id"]
      || !options["--checkout-root"] || options["--observation-file"]
      || (options["--target"] === "production" && !options["--staging-evidence"])))) {
    throw new Error("native Token Vault secret custody request is incomplete");
  }
  return { mode, options };
}

function assertRootRelease(sourceSha) {
  if (process.platform !== "linux" || process.getuid() !== 0
    || ROOT !== `/opt/skincos/releases/${sourceSha}/source`
    || !fs.readFileSync("/proc/sys/kernel/osrelease", "utf8").toLowerCase().includes("microsoft")
    || !/^ID=ubuntu$/m.test(fs.readFileSync("/etc/os-release", "utf8"))
    || !/^VERSION_ID="24\.04"$/m.test(fs.readFileSync("/etc/os-release", "utf8"))) {
    throw new Error("native Token Vault secret custody requires the selected root-owned Ubuntu-24.04 release");
  }
  verifyDetachedRelease({ root: ROOT, sourceSha });
}

function main() {
  const { mode, options } = optionsFor(process.argv.slice(2));
  assertRootRelease(options["--source-sha"]);
  if (mode === "provision") { provisionCredentials(options["--target"]); return; }
  const secrets = privateCredentials(options["--target"]);
  const script = mode === "readiness" ? "scripts/token-vault-native-readiness.mjs"
    : "scripts/token-vault-native-release.mjs";
  const args = mode === "readiness" ? [
    "--target", options["--target"], "--source-sha", options["--source-sha"],
    "--preview-evidence", options["--preview-evidence"],
    "--observation-file", options["--observation-file"],
  ] : [
    "--target", options["--target"], "--source-sha", options["--source-sha"],
    "--preview-evidence", options["--preview-evidence"],
    "--readiness-evidence", options["--readiness-evidence"],
    "--transaction-id", options["--transaction-id"],
    "--checkout-root", options["--checkout-root"],
    ...(options["--staging-evidence"] ? ["--staging-evidence", options["--staging-evidence"]] : []),
  ];
  const environment = { PATH: "/usr/bin:/bin", HOME: "/home/admin", LANG: "C",
    WSL_DISTRO_NAME: "Ubuntu-24.04", ...secrets };
  const result = spawnSync("/usr/bin/setpriv", ["--reuid=admin", "--regid=admin", "--init-groups",
    "/usr/bin/node", path.join(ROOT, script), ...args], { cwd: ROOT, env: environment, stdio: "inherit" });
  if (result.error) throw new Error("native Token Vault credential-bound operator process failed to start");
  process.exitCode = result.status ?? 78;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 78; }
}
