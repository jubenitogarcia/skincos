import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnitScopeAccess, normalizeAllowedUnits, normalizeUnitScope, toAuthenticatedActor } from '../../shared/identity-contract/index.js';
import { isCurrentSessionVersion, resolveIdentityActor } from '../session/actor.js';

test('Identity publishes a stable actor with scoped permissions and compatibility aliases', () => {
  const actor = toAuthenticatedActor({
    username: 'pilot', displayName: 'Pilot User', role: 'gestor',
    allowedUnits: ['novo-hamburgo'], allowedModules: ['finance'], permissions: ['finance:read'],
  });
  assert.equal(actor.subject, 'pilot');
  assert.equal(actor.role, 'GESTOR');
  assert.deepEqual(actor.scopes, { units: ['novo-hamburgo'], modules: ['finance'], permissions: ['finance:read'] });
  assert.deepEqual(actor.allowedModules, ['finance']);
  assert.equal(isCurrentSessionVersion({ sv: 4 }, { sessionVersion: 4 }), true);
  assert.equal(isCurrentSessionVersion({ sv: 3 }, { sessionVersion: 4 }), false);
});

test('Identity canonicalizes known unit aliases and keeps unknown or empty scopes fail-closed', () => {
  assert.equal(normalizeUnitScope('NH'), 'novo-hamburgo');
  assert.equal(normalizeUnitScope('Novo Hamburgo'), 'novo-hamburgo');
  assert.equal(normalizeUnitScope('novohamburgo'), 'novo-hamburgo');
  assert.equal(normalizeUnitScope('BSS'), 'barra-shopping-sul');
  assert.equal(normalizeUnitScope('Barra Shopping Sul'), 'barra-shopping-sul');
  assert.equal(normalizeUnitScope('BarraShoppingSul'), 'barra-shopping-sul');
  assert.equal(normalizeUnitScope('unidade-invalida'), '');
  assert.deepEqual(normalizeAllowedUnits(['NH', 'novo-hamburgo', 'BSS']), ['novo-hamburgo', 'barra-shopping-sul']);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['NH'] }, 'novo-hamburgo'), true);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['BSS'] }, 'novo-hamburgo'), false);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: [] }, 'novo-hamburgo'), false);
  assert.equal(hasUnitScopeAccess({ role: 'ADMIN', allowedUnits: [] }, 'barra-shopping-sul'), true);
  assert.equal(hasUnitScopeAccess({ role: 'ADMIN', allowedUnits: [] }, 'unidade-invalida'), false);
});

test('Identity accepts the existing signed session payload without changing its cookie format', async () => {
  const secret = 'compatibility-secret';
  const encode = (value) => Buffer.from(value).toString('base64url');
  const payload = encode(JSON.stringify({ username: 'pilot', sv: 4, csrf: 'csrf-existing', exp: Date.now() + 60_000 }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = encode(Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
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
              allowed_units_json: '["novo-hamburgo"]', allowed_modules_json: '["finance"]', session_version: 4,
            };
            return null;
          },
          async all() { return { results: [{ name: 'allowed_modules_json' }] }; },
        };
      },
    },
  };

  const result = await resolveIdentityActor(new Request('https://api.skincos.com.br/finance', { headers: { cookie: `session=${payload}.${signature}` } }), env);

  assert.equal(result.csrf, 'csrf-existing');
  assert.equal(result.actor.subject, 'pilot');
  assert.deepEqual(result.actor.scopes.modules, ['finance']);
});
