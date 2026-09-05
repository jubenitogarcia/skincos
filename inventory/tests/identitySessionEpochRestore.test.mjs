import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { resolveIdentityActor } from '../../shared/identity-runtime/session.js';
import { buildBackupPayload, restoreBackupPayload } from '../src/services/backup.js';

const migrations = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes || 0) } };
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }
}

function environment(database) {
  return {
    DB: {
      prepare(sql) {
        return new D1Statement(database, sql);
      },
      async batch(statements) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    },
  };
}

function applySchema(database, through = null) {
  for (const name of readdirSync(migrations).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()) {
    if (through && name > through) break;
    database.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
}

function seedIdentity(database) {
  database.prepare(`
    INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, ativo, created_at, updated_at, session_version, identity_subject)
    VALUES ('restore-user', 'restore-user@staging.invalid', 'Restore User', 'hash', 'GESTOR', '[]', 1, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z', 7, 'idn:restore_user_00000001')
  `).run();
  database.prepare(`
    INSERT INTO crm_identity_sessions (id, username, session_version, created_at, last_seen_at)
    VALUES ('restore-session', 'restore-user', 7, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')
  `).run();
}

async function sidLessSessionToken({ username, sessionVersion, secret }) {
  const payload = Buffer.from(JSON.stringify({
    username,
    sv: sessionVersion,
    csrf: 'test-csrf',
    exp: Date.now() + 60_000,
  })).toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return `${payload}.${signature}`;
}

async function resolveSidLessActor(env, token) {
  return resolveIdentityActor(
    new Request('https://identity.test/finance', { headers: { cookie: `session=${token}` } }),
    env,
  );
}

test('backup restore revokes tracked sessions and advances the durable sid-less epoch', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    applySchema(database);
    seedIdentity(database);
    const env = environment(database);
    const sessionSecret = 'session-epoch-restore-test-secret';
    const oldToken = await sidLessSessionToken({ username: 'restore-user', sessionVersion: 7, secret: sessionSecret });
    assert.equal((await resolveSidLessActor({ ...env, SESSION_SECRET: sessionSecret }, oldToken)).actor?.username, 'restore-user');
    const payload = await buildBackupPayload({ env });
    await restoreBackupPayload({ env, payload });

    const restored = database.prepare(
      'SELECT session_version, identity_subject FROM crm_users WHERE username=?',
    ).get('restore-user');
    assert.equal(restored.session_version, 8);
    assert.equal(restored.identity_subject, 'idn:restore_user_00000001');
    const revoked = database.prepare(
      'SELECT revoked_at, revoke_reason FROM crm_identity_sessions WHERE id=?',
    ).get('restore-session');
    assert.ok(revoked.revoked_at);
    assert.equal(revoked.revoke_reason, 'BACKUP_RESTORE');
    const epoch = database.prepare(
      'SELECT session_version, reason FROM crm_identity_session_epochs WHERE username=?',
    ).get('restore-user');
    assert.equal(epoch.session_version, 8);
    assert.equal(epoch.reason, 'BACKUP_RESTORE');
    assert.equal((await resolveSidLessActor({ ...env, SESSION_SECRET: sessionSecret }, oldToken)).actor, null);
    const freshToken = await sidLessSessionToken({ username: 'restore-user', sessionVersion: 8, secret: sessionSecret });
    assert.equal((await resolveSidLessActor({ ...env, SESSION_SECRET: sessionSecret }, freshToken)).actor?.username, 'restore-user');
  } finally {
    database.close();
  }
});

test('backup restore advances a sid-less epoch even on a clean migrated target', async () => {
  const sourceDatabase = new DatabaseSync(':memory:');
  const targetDatabase = new DatabaseSync(':memory:');
  try {
    applySchema(sourceDatabase);
    applySchema(targetDatabase);
    seedIdentity(sourceDatabase);
    const sourceEnv = environment(sourceDatabase);
    const targetEnv = environment(targetDatabase);
    const sessionSecret = 'session-epoch-clean-target-test-secret';
    const oldToken = await sidLessSessionToken({ username: 'restore-user', sessionVersion: 7, secret: sessionSecret });
    const payload = await buildBackupPayload({ env: sourceEnv });

    assert.equal((await resolveSidLessActor({ ...targetEnv, SESSION_SECRET: sessionSecret }, oldToken)).actor, null);
    await restoreBackupPayload({ env: targetEnv, payload });

    const restored = targetDatabase.prepare(
      'SELECT session_version FROM crm_users WHERE username=?',
    ).get('restore-user');
    assert.equal(restored.session_version, 8);
    const epoch = targetDatabase.prepare(
      'SELECT session_version, reason FROM crm_identity_session_epochs WHERE username=?',
    ).get('restore-user');
    assert.equal(epoch.session_version, 8);
    assert.equal(epoch.reason, 'BACKUP_RESTORE');
    assert.equal((await resolveSidLessActor({ ...targetEnv, SESSION_SECRET: sessionSecret }, oldToken)).actor, null);
    const freshToken = await sidLessSessionToken({ username: 'restore-user', sessionVersion: 8, secret: sessionSecret });
    assert.equal((await resolveSidLessActor({ ...targetEnv, SESSION_SECRET: sessionSecret }, freshToken)).actor?.username, 'restore-user');
  } finally {
    sourceDatabase.close();
    targetDatabase.close();
  }
});

test('backup restore fails closed when the durable subject schema lacks the epoch migration', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    applySchema(database);
    seedIdentity(database);
    const env = environment(database);
    const payload = await buildBackupPayload({ env });
    database.exec('DROP TABLE crm_identity_session_epochs');
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
        .get('crm_identity_session_epochs'),
      undefined,
    );
    await assert.rejects(() => restoreBackupPayload({ env, payload }), /IDENTITY_SESSION_EPOCH_REQUIRED/);
    assert.equal(database.prepare('SELECT session_version FROM crm_users WHERE username=?').get('restore-user').session_version, 7);
  } finally {
    database.close();
  }
});
