import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

const { getPlatformProxy } = wrangler;
const migrationsUrl = new URL('../migrations/', import.meta.url);

function splitMigrationSql(sql) {
  const statements = [];
  let buffer = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let compound = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] || '';
    if (lineComment) {
      if (char === '\n') { buffer += char; lineComment = false; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (!quote && char === '-' && next === '-') { lineComment = true; buffer += '\n'; index += 1; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (quote) {
      buffer += char;
      if (char === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; buffer += char; continue; }
    buffer += char;
    if (!compound && /CREATE\s+TRIGGER[\s\S]*\bBEGIN\s*$/i.test(buffer)) compound = true;
    if (char === ';' && (!compound || /\bEND\s*;\s*$/i.test(buffer))) {
      const statement = buffer.slice(0, -1).trim();
      if (statement) statements.push(statement);
      buffer = '';
      compound = false;
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function applyMigration(db, name) {
  const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
  for (const statement of splitMigrationSql(sql)) await db.prepare(statement).run();
}

let proxy;
let db;

before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    persist: false,
    remoteBindings: false,
  });
  db = proxy.env.DB;
  const names = (await readdir(migrationsUrl))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0029_crm_users_identity_subject.sql')
    .sort();
  for (const name of names) await applyMigration(db, name);
  const now = '2026-09-02T00:00:00.000Z';
  await db.batch([
    db.prepare(`INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind('legacy-subject-a', 'legacy-subject-a@staging.invalid', 'Legacy Subject A', 'hash', 'GESTOR', '["novo-hamburgo"]', '["finance"]', now, now, 5),
    db.prepare(`INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind('legacy-subject-b', 'legacy-subject-b@staging.invalid', 'Legacy Subject B', 'hash', 'CONSULTOR', '["barra-shopping-sul"]', '["insumos"]', now, now, 8),
  ]);
  await applyMigration(db, '0029_crm_users_identity_subject.sql');
  await applyMigration(db, '0030_crm_identity_session_epochs.sql');
});

after(async () => {
  await proxy?.dispose?.();
});

test('the additive migration backfills unique opaque subjects without changing legacy usernames or session versions', async () => {
  const rows = await db.prepare(
    `SELECT username, identity_subject, session_version
     FROM crm_users
     WHERE username IN ('legacy-subject-a', 'legacy-subject-b')
     ORDER BY username`,
  ).all();
  assert.deepEqual(rows.results.map((row) => row.username), ['legacy-subject-a', 'legacy-subject-b']);
  assert.deepEqual(rows.results.map((row) => Number(row.session_version)), [5, 8]);
  const subjects = rows.results.map((row) => String(row.identity_subject || ''));
  assert.ok(subjects.every((subject) => /^idn:[A-Za-z0-9_-]{16,160}$/.test(subject)));
  assert.equal(new Set(subjects).size, 2);
});

test('the session epoch migration backfills every existing username without resetting its version', async () => {
  const rows = await db.prepare(
    `SELECT username, session_version
     FROM crm_identity_session_epochs
     WHERE username IN ('legacy-subject-a', 'legacy-subject-b')
     ORDER BY username`,
  ).all();
  assert.deepEqual(rows.results, [
    { username: 'legacy-subject-a', session_version: 5 },
    { username: 'legacy-subject-b', session_version: 8 },
  ]);
});
