import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONFIG = "platform/security/token-vault/wrangler.toml";
const WRANGLER = "wrangler@4.120.0";
const VERSION = /^[0-9a-fA-F-]{36}$/;
const PREVIEW_SUFFIX = {
  staging: "-skincos-token-vault-staging.skincos.workers.dev",
  production: "-skincos-token-vault.skincos.workers.dev",
};

export function cloudflareCliEnvironment(env = process.env) {
  const allowed = ["PATH", "HOME", "LANG", "WSL_DISTRO_NAME", "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
    "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"];
  return Object.fromEntries(allowed.filter((name) => env[name]).map((name) => [name, env[name]]));
}

function requiredVersion(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!VERSION.test(normalized)) throw new Error(`${label} is not an immutable Worker version ID`);
  return normalized;
}

export function wrangler(args, root) {
  const result = spawnSync("npx", ["--yes", WRANGLER, ...args], {
    cwd: root,
    env: cloudflareCliEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Wrangler ${args[0]} failed (${result.status ?? "start"}); inspect private provider diagnostics before retrying`);
  }
  return String(result.stdout || "");
}

function envArgs(target) {
  if (target !== "staging" && target !== "production") throw new Error("Token Vault Worker target is invalid");
  return target === "staging" ? ["--env", "staging"] : [];
}

export function candidateSecrets(target, env, { analyticsBindingPresent, seedBearer }) {
  envArgs(target);
  const config = String(env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN || "");
  if (!/^[\x21-\x7e]+$/.test(config)) throw new Error("Token Vault config bearer is unavailable or malformed");
  const secrets = { TOKEN_VAULT_META_ADS_CONFIG_TOKEN: config };
  if (analyticsBindingPresent !== true) {
    // The analytics bearer is also consumed by the private service. Generating
    // it only for this upload would make that consumer lose access permanently.
    const analytics = String(env.TOKEN_VAULT_ANALYTICS_API_TOKEN || "");
    if (analytics.length < 32 || analytics === config) {
      throw new Error("Token Vault analytics bearer requires distinct canonical custody before upload");
    }
    secrets.TOKEN_VAULT_ANALYTICS_API_TOKEN = analytics;
  }
  if (target === "staging") {
    const operational = String(env.TOKEN_VAULT_N8N_API_TOKEN || "");
    if (operational.length < 32 || operational === config) throw new Error("staging operational bearer is invalid or reused");
    if (!/^[A-Za-z0-9_-]{64,}$/.test(String(seedBearer || "")) || seedBearer === config || seedBearer === operational) {
      throw new Error("staging synthetic-seed bearer is invalid or reused");
    }
    secrets.TOKEN_VAULT_N8N_API_TOKEN = operational;
    secrets.TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN = seedBearer;
  }
  return secrets;
}

export function parseCandidateUpload(output, target) {
  const suffix = PREVIEW_SUFFIX[target];
  if (!suffix) throw new Error("Token Vault target has no trusted preview hostname");
  const versionLine = String(output).split(/\r?\n/).filter((line) => line.startsWith("Worker Version ID: ")).at(-1);
  const versionId = requiredVersion(versionLine?.slice("Worker Version ID: ".length), "candidate");
  const expectedPreviewUrl = `https://${versionId.split("-")[0]}${suffix}`;
  const previewLine = String(output).split(/\r?\n/).find((line) => line.startsWith("Version Preview URL: "));
  const previewUrl = String(previewLine?.slice("Version Preview URL: ".length) || "").replace(/\/+$/, "");
  if (previewUrl !== expectedPreviewUrl) throw new Error("candidate preview URL differs from its exact immutable version");
  return { versionId, previewUrl };
}

function privateFile(directory, name) {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new Error("Token Vault transaction directory must be private");
  return path.join(directory, name);
}

export async function uploadCandidate({ target, sourceSha, root, transactionDirectory, analyticsBindingPresent, authorize, markAttempt, run = wrangler, env = process.env }) {
  if (typeof authorize !== "function" || typeof markAttempt !== "function") {
    throw new Error("lease authorization and durable attempt journal are required before candidate upload");
  }
  if (!/^[0-9a-f]{40}$/.test(String(sourceSha || ""))) throw new Error("candidate source SHA is invalid");
  const seedFile = target === "staging" ? privateFile(transactionDirectory, "staging-seed-bearer") : null;
  const seedBearer = target === "staging" ? randomBytes(48).toString("base64url") : null;
  if (seedFile) fs.writeFileSync(seedFile, seedBearer, { mode: 0o600, flag: "wx" });
  const secretsFile = privateFile(transactionDirectory, "candidate-secrets.json");
  let uploadAttempted = false;
  try {
    const secrets = candidateSecrets(target, env, { analyticsBindingPresent, seedBearer });
    fs.writeFileSync(secretsFile, `${JSON.stringify(secrets)}\n`, { mode: 0o600, flag: "wx" });
    await authorize();
    await markAttempt();
    uploadAttempted = true;
    const output = run([
      "versions", "upload", "--config", CONFIG, "--keep-vars", "--strict",
      "--secrets-file", secretsFile, "--message", `token-vault:deploy:${sourceSha}`,
      ...envArgs(target),
    ], root);
    return { ...parseCandidateUpload(output, target), seedFile };
  } finally {
    // The candidate version retains its own secrets. Keep only the ephemeral
    // seed bearer under private transaction custody for bounded reconciliation.
    if (fs.existsSync(secretsFile)) fs.unlinkSync(secretsFile);
    if (!uploadAttempted && seedFile && fs.existsSync(seedFile)) fs.unlinkSync(seedFile);
  }
}

export function activeVersion(status) {
  const versions = status?.versions || status?.latest?.versions || [];
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
    throw new Error("Token Vault has no single 100-percent active Worker version");
  }
  return requiredVersion(versions[0]?.version_id || versions[0]?.id, "active");
}

export function readActiveVersion(target, root, run = wrangler) {
  const output = run(["deployments", "status", "--json", "--config", CONFIG, ...envArgs(target)], root);
  try { return activeVersion(JSON.parse(output)); } catch {
    throw new Error("Token Vault active Worker version readback is invalid");
  }
}

export async function activateCandidate({ target, candidateVersionId, incumbentVersionId, root, authorize, run = wrangler }) {
  if (typeof authorize !== "function") throw new Error("lease authorization is required before Worker activation");
  const candidate = requiredVersion(candidateVersionId, "candidate");
  const incumbent = requiredVersion(incumbentVersionId, "incumbent");
  if (candidate === incumbent) throw new Error("candidate and incumbent Worker versions are identical");
  if (readActiveVersion(target, root, run) !== incumbent) throw new Error("Token Vault incumbent changed before activation");
  await authorize();
  run(["versions", "deploy", `${candidate}@100%`, "--yes", "--config", CONFIG, ...envArgs(target)], root);
  if (readActiveVersion(target, root, run) !== candidate) throw new Error("Token Vault candidate activation readback differs from the selected version");
  return candidate;
}

export async function compensateWorker({ target, candidateVersionId, incumbentVersionId, root, authorize, run = wrangler }) {
  if (typeof authorize !== "function") throw new Error("lease authorization is required before Worker compensation");
  const candidate = requiredVersion(candidateVersionId, "candidate");
  const incumbent = requiredVersion(incumbentVersionId, "incumbent");
  const active = readActiveVersion(target, root, run);
  if (active === incumbent) return "already_restored";
  if (active !== candidate) throw new Error("another Worker version owns traffic; refusing compensation");
  await authorize();
  run(["versions", "deploy", `${incumbent}@100%`, "--yes", "--config", CONFIG, ...envArgs(target)], root);
  if (readActiveVersion(target, root, run) !== incumbent) throw new Error("Token Vault incumbent compensation readback failed");
  return "restored";
}
