import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAliasNormalizationSql, planAliasNormalization } from '../scripts/unitScopeRepair.mjs';
import { planExplicitUserUnitRepair } from '../scripts/repairUserInsumosUnits.mjs';

test('alias repair only canonicalizes recognized aliases and reports empty or unknown rows', () => {
  const plan = planAliasNormalization([
    { username: 'alias', allowed_units_json: '["NH","Barra Shopping Sul"]' },
    { username: 'empty', allowed_units_json: '[]' },
    { username: 'unknown', allowed_units_json: '["unidade-estranha"]' },
  ]);
  assert.equal(plan.normalize.length, 1);
  assert.equal(plan.review.length, 2);
  const sql = buildAliasNormalizationSql(plan.normalize[0], '2026-07-24T00:00:00.000Z');
  assert.match(sql, /IDENTITY_UNIT_SCOPE_NORMALIZED/);
  assert.match(sql, /audit_log/);

  const delimited = planAliasNormalization([{ username: 'delimited', allowed_units_json: 'NH;BSS' }]).normalize[0];
  assert.match(buildAliasNormalizationSql(delimited), /COALESCE\(allowed_units_json, ''\)='NH;BSS'/);
});

test('explicit repair is limited to an empty known scope and is auditable', () => {
  const plan = planExplicitUserUnitRepair({ username: 'target', allowed_units_json: '[]' });
  assert.deepEqual(plan, { ok: true, subject: plan.subject, before: '[]', after: '["novo-hamburgo","barra-shopping-sul"]' });
  assert.equal(planExplicitUserUnitRepair({ username: 'other', allowed_units_json: '["novo-hamburgo"]' }).reason, 'NON_EMPTY_SCOPE_REQUIRES_REVIEW');
  assert.equal(planExplicitUserUnitRepair({ username: 'other', allowed_units_json: '["unknown"]' }).reason, 'UNKNOWN_UNIT_SCOPE');
});
