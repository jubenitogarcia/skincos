import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { updateIdentityProfile } from '../store/d1.js';

const migrationUrl = new URL('../../inventory/migrations/0029_crm_users_identity_subject.sql', import.meta.url);
const identityStoreUrl = new URL('../store/d1.js', import.meta.url);
const actorContractUrl = new URL('../../shared/identity-contract/index.js', import.meta.url);

function createRenameEnvironment() {
  const state = {
    user: {
      username: 'identity-legacy',
      email: 'identity-legacy@staging.invalid',
      display_name: 'Identity Legacy',
      password_hash: 'hash',
      role: 'GESTOR',
      photo_url: '',
      allowed_units_json: '["novo-hamburgo"]',
      allowed_modules_json: '["finance"]',
      ativo: 1,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
      session_version: 6,
      identity_subject: 'idn:identity_legacy_0001',
    },
    accountLinkUsername: 'identity-legacy',
    prefsUsername: 'identity-legacy',
  };

  const statement = (sql, params = []) => ({
    sql,
    params,
    bind(...values) { return statement(sql, values); },
    async first() {
      if (sql.includes('sqlite_master')) {
        const name = String(params[0] || '');
        return ['crm_users', 'crm_invites', 'crm_password_resets', 'crm_user_prefs', 'crm_employee_account_links'].includes(name)
          ? { type: 'table' }
          : null;
      }
      if (sql.includes('FROM crm_users')) {
        const requested = String(params[0] || '').toLowerCase();
        return state.user.username.toLowerCase() === requested ? { ...state.user } : null;
      }
      return null;
    },
    async all() {
      if (sql.startsWith('PRAGMA table_info(crm_users)')) {
        return { results: [{ name: 'allowed_modules_json' }, { name: 'identity_subject' }] };
      }
      return { results: [] };
    },
    async run() {
      if (sql.includes('UPDATE crm_users')) {
        state.user = {
          ...state.user,
          username: params[0],
          email: params[1],
          display_name: params[2],
          photo_url: params[3],
          password_hash: params[4],
          updated_at: params[5],
        };
      } else if (sql.includes('UPDATE crm_employee_account_links')) {
        state.accountLinkUsername = params[0];
      } else if (sql.includes('UPDATE crm_user_prefs')) {
        state.prefsUsername = params[0];
      }
      return { meta: { changes: 1 } };
    },
  });

  const DB = {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      for (const item of statements) await item.run();
    },
  };
  return { env: { DB }, state };
}

test('the CRM identity subject migration is additive, opaque, and uniquely indexed', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /ALTER TABLE crm_users ADD COLUMN identity_subject TEXT;/);
  assert.match(migration, /SET identity_subject = 'idn:' \|\| lower\(hex\(randomblob\(16\)\)\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_users_identity_subject/);
  assert.match(migration, /ON crm_users\(identity_subject\)\s+WHERE identity_subject IS NOT NULL;/);
  assert.doesNotMatch(migration, /\b(?:DROP|RENAME)\s+(?:TABLE|COLUMN)\b/i);
  assert.doesNotMatch(migration, /identity_subject\s+TEXT\s+NOT\s+NULL/i);
});

test('identity persistence renames in place while v1 actor.subject remains username-based', async () => {
  const [store, contract] = await Promise.all([
    readFile(identityStoreUrl, 'utf8'),
    readFile(actorContractUrl, 'utf8'),
  ]);

  assert.match(store, /identitySubjectColumn && !current\.identitySubject/);
  assert.match(store, /error: 'IDENTITY_SUBJECT_REQUIRED'/);
  const renameBlock = store.match(/if \(nextUsername !== current\.username\) \{([\s\S]*?)\n  \} else \{/);
  assert.ok(renameBlock, 'expected a dedicated username rename branch');
  assert.match(renameBlock[1], /UPDATE \$\{usersTable\}[\s\S]*SET username=\?/);
  assert.doesNotMatch(renameBlock[1], /\b(?:INSERT|DELETE)\b/i);
  assert.match(contract, /identitySubject: isOpaqueIdentitySubject\(user\.identitySubject\) \? user\.identitySubject : null/);
  assert.match(contract, /subject: String\(user\.username\)/);
});

test('the mounted Identity store preserves the opaque subject, team link, and preferences through an in-place rename', async () => {
  const { env, state } = createRenameEnvironment();
  const renamed = await updateIdentityProfile(env, 'identity-legacy', {
    newUsername: 'identity-renamed',
    displayName: 'Identity Renamed',
  });

  assert.equal(renamed.ok, true);
  assert.equal(renamed.user.username, 'identity-renamed');
  assert.equal(renamed.user.identitySubject, 'idn:identity_legacy_0001');
  assert.equal(renamed.user.sessionVersion, 6);
  assert.equal(state.accountLinkUsername, 'identity-renamed');
  assert.equal(state.prefsUsername, 'identity-renamed');
});
