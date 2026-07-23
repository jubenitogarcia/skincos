import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentityD1Store, handleAuthRoutes } from '../src/routes/auth.js';
import {
  createIdentityD1Store as runtimeStore,
  handleAuthRoutes as runtimeAuthRoutes,
} from '../../shared/identity-runtime/inventory-auth.js';

test('Inventory keeps the existing auth mount through the registered Identity adapter', async () => {
  assert.equal(handleAuthRoutes, runtimeAuthRoutes);
  assert.equal(createIdentityD1Store, runtimeStore);

  const store = createIdentityD1Store({
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (sql.includes('sqlite_master')) return { type: 'table' };
            if (sql.includes('FROM crm_users')) return {
              username: 'existing-user', display_name: 'Existing User', role: 'CONSULTOR', ativo: 1,
              allowed_units_json: '["novo-hamburgo"]', allowed_modules_json: '["inventory"]', session_version: 0,
            };
            return null;
          },
          async all() { return { results: [{ name: 'allowed_modules_json' }] }; },
        };
      },
    },
  });

  const user = await store.getUserByUsername('existing-user');
  assert.equal(user.username, 'existing-user');
  assert.deepEqual(user.allowedModules, ['inventory']);
});
