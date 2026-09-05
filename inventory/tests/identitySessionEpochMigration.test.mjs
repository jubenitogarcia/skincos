import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrations = new URL('../migrations/', import.meta.url);

function applySchema(database) {
  for (const name of readdirSync(migrations).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()) {
    database.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
}

function insertUser(database, username, sessionVersion) {
  database.prepare(`
    INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, ativo, created_at, updated_at, session_version)
    VALUES (?, ?, ?, 'hash', 'CONSULTOR', '[]', 1, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z', ?)
  `).run(username, `${username}@staging.invalid`, username, sessionVersion);
}

test('session epochs survive username replacement, restore-style recreation, and rename reuse', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applySchema(database);

    insertUser(database, 'restore-user', 7);
    database.prepare(`
      INSERT INTO crm_identity_sessions (id, username, session_version, created_at, last_seen_at)
      VALUES ('restore-session', 'restore-user', 7, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')
    `).run();
    database.prepare('DELETE FROM crm_users WHERE username=?').run('restore-user');
    const retired = database.prepare(
      'SELECT session_version FROM crm_identity_session_epochs WHERE username=?',
    ).get('restore-user');
    assert.equal(retired.session_version, 7);
    const revoked = database.prepare(
      'SELECT revoked_at, revoke_reason FROM crm_identity_sessions WHERE id=?',
    ).get('restore-session');
    assert.ok(revoked.revoked_at);
    assert.equal(revoked.revoke_reason, 'USERNAME_RETIRED');

    insertUser(database, 'restore-user', 0);
    assert.equal(database.prepare('SELECT session_version FROM crm_users WHERE username=?').get('restore-user').session_version, 8);

    insertUser(database, 'rename-source', 2);
    insertUser(database, 'rename-target', 4);
    database.prepare('DELETE FROM crm_users WHERE username=?').run('rename-target');
    database.prepare('UPDATE crm_users SET username=? WHERE username=?').run('rename-target', 'rename-source');
    assert.equal(database.prepare('SELECT session_version FROM crm_users WHERE username=?').get('rename-target').session_version, 5);
    assert.equal(database.prepare('SELECT session_version FROM crm_identity_session_epochs WHERE username=?').get('rename-source').session_version, 2);

    insertUser(database, 'case-user', 3);
    database.prepare('DELETE FROM crm_users WHERE username=?').run('case-user');
    insertUser(database, 'CASE-USER', 0);
    assert.equal(database.prepare('SELECT session_version FROM crm_users WHERE LOWER(username)=LOWER(?)').get('case-user').session_version, 4);
  } finally {
    database.close();
  }
});
