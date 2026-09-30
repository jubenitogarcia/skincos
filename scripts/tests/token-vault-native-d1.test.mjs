import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyAdditiveMigrations, confirmBookmark } from "../token-vault-native-d1.mjs";

const bookmark = "abcde12345abcde12345";

test("native D1 migration uses a private additive batch and reads back its journal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-d1-test-"));
  const directory = path.join(root, "platform", "security", "token-vault", "migrations");
  const transaction = path.join(root, "private-transaction");
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(transaction, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, "0001_initial.sql"), "CREATE TABLE IF NOT EXISTS sample (id TEXT);\n");
  let applied = false;
  let authorizations = 0;
  const run = (args) => {
    if (args[0] !== "d1") throw new Error("unexpected command");
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args.includes("--file")) {
      const sql = fs.readFileSync(args[args.indexOf("--file") + 1], "utf8");
      assert.match(sql, /CREATE TABLE IF NOT EXISTS sample/);
      assert.match(sql, /INSERT INTO token_vault_schema_migrations/);
      applied = true;
      return "";
    }
    const statement = args[args.indexOf("--command") + 1];
    if (statement.startsWith("SELECT")) return JSON.stringify([{ results: applied ? [{ name: "0001_initial.sql" }] : [] }]);
    if (statement.startsWith("CREATE TABLE")) return "";
    throw new Error("unexpected D1 statement");
  };
  try {
    const result = await applyAdditiveMigrations({
      target: "staging", root, transactionDirectory: transaction, expectedBookmark: bookmark,
      authorize: async () => { authorizations += 1; }, run,
    });
    assert.deepEqual(result.applied, ["0001_initial.sql"]);
    assert.equal(authorizations, 2);
    assert.equal(fs.existsSync(path.join(transaction, "token-vault-additive-migrations.sql")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native D1 migration refuses changed recovery bookmark before writing", () => {
  assert.throws(() => confirmBookmark("production", bookmark, "/repo", () => JSON.stringify({ bookmark: "f".repeat(20) })), /changed before migration/);
});
