import fs from "node:fs";
import path from "node:path";
import { wrangler } from "./token-vault-native-worker.mjs";

const CONFIG = "platform/security/token-vault/wrangler.toml";
const JOURNAL = "CREATE TABLE IF NOT EXISTS token_vault_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));";
const MIGRATION = /^[0-9]{4}_[a-z0-9_-]+\.sql$/;

function environment(target) {
  if (target === "production") return { database: "skincos-token-vault", args: [] };
  if (target === "staging") return { database: "skincos-token-vault-staging", args: ["--env", "staging"] };
  throw new Error("Token Vault D1 target is invalid");
}

function json(output, label) {
  try { return JSON.parse(output); } catch { throw new Error(`${label} returned invalid JSON`); }
}

export function migrationFiles(root) {
  const directory = path.join(root, "platform", "security", "token-vault", "migrations");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  if (!names.length || names.some((name) => !MIGRATION.test(name))) throw new Error("Token Vault migration set is empty or malformed");
  return names.map((name) => ({ name, file: path.join(directory, name) }));
}

export function appliedMigrationNames(target, root, run = wrangler) {
  const { database, args } = environment(target);
  const output = run([
    "d1", "execute", database, "--remote", "--config", CONFIG, ...args,
    "--command", "SELECT name FROM token_vault_schema_migrations ORDER BY name;", "--json",
  ], root);
  const rows = json(output, "D1 migration journal")?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("D1 migration journal readback is invalid");
  return new Set(rows.map((row) => String(row?.name || "")));
}

export function confirmBookmark(target, expected, root, run = wrangler) {
  const { database, args } = environment(target);
  if (!/^[A-Za-z0-9-]{16,256}$/.test(String(expected || ""))) throw new Error("D1 recovery bookmark is invalid");
  const value = json(run(["d1", "time-travel", "info", database, "--json", "--config", CONFIG, ...args], root), "D1 Time Travel");
  const actual = String(value?.bookmark ?? value?.result?.bookmark ?? "").trim();
  if (actual !== expected) throw new Error("D1 Time Travel bookmark changed before migration");
}

export async function applyAdditiveMigrations({ target, root, transactionDirectory, expectedBookmark, authorize, run = wrangler }) {
  if (typeof authorize !== "function") throw new Error("lease authorization is required before D1 mutation");
  const { database, args } = environment(target);
  const migrationSet = migrationFiles(root);
  confirmBookmark(target, expectedBookmark, root, run);
  await authorize();
  run(["d1", "execute", database, "--remote", "--config", CONFIG, ...args, "--command", JOURNAL], root);
  const applied = appliedMigrationNames(target, root, run);
  const pending = migrationSet.filter(({ name }) => !applied.has(name));
  if (!pending.length) return { database, applied: [], alreadyApplied: migrationSet.length };
  const directoryStat = fs.statSync(transactionDirectory);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) throw new Error("D1 transaction directory must be private");
  const batchFile = path.join(transactionDirectory, "token-vault-additive-migrations.sql");
  let batch = "";
  for (const { name, file } of pending) {
    batch += `${fs.readFileSync(file, "utf8")}\nINSERT INTO token_vault_schema_migrations(name) VALUES ('${name}');\n`;
  }
  fs.writeFileSync(batchFile, batch, { mode: 0o600, flag: "wx" });
  try {
    await authorize();
    run(["d1", "execute", database, "--remote", "--config", CONFIG, ...args, "--file", batchFile], root);
  } finally {
    if (fs.existsSync(batchFile)) fs.unlinkSync(batchFile);
  }
  const after = appliedMigrationNames(target, root, run);
  if (pending.some(({ name }) => !after.has(name))) throw new Error("Token Vault D1 migration journal readback is incomplete");
  return { database, applied: pending.map(({ name }) => name), alreadyApplied: applied.size };
}
