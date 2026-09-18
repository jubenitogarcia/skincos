import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentSessionVersion, resolveCrmActor } from './worker.js';

test('CRM session version matches only the current user session version', () => {
  assert.equal(isCurrentSessionVersion({ sv: 2 }, { sessionVersion: 2 }), true);
  assert.equal(isCurrentSessionVersion({ sv: 1 }, { sessionVersion: 2 }), false);
  assert.equal(isCurrentSessionVersion({}, { sessionVersion: 0 }), false);
  assert.equal(isCurrentSessionVersion({ sv: 'not-a-number' }, { sessionVersion: 0 }), false);
});

test('CRM compatibility adapter accepts an existing signed session through Identity', async () => {
  const secret = 'crm-compatibility-secret';
  const payload = Buffer.from(JSON.stringify({ username: 'pilot', sv: 3, csrf: 'csrf-existing', exp: Date.now() + 60_000 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  const env = {
    SESSION_SECRET: secret,
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (sql.includes('sqlite_master')) return { type: 'table' };
            if (sql.includes('FROM crm_users')) return {
              username: 'pilot', display_name: 'Pilot User', role: 'GESTOR', ativo: 1,
              allowed_units_json: '["novo-hamburgo"]', allowed_modules_json: '["finance"]', session_version: 3,
            };
            return null;
          },
          async all() { return { results: [{ name: 'allowed_modules_json' }] }; },
        };
      },
    },
  };

  const result = await resolveCrmActor(new Request('https://api.skincos.com.br/finance', { headers: { cookie: `session=${payload}.${signature}` } }), env);

  assert.equal(result.csrf, 'csrf-existing');
  assert.equal(result.actor.subject, 'pilot');
  assert.deepEqual(result.actor.scopes.modules, ['finance']);
});
