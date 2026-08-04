import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_CONTACT_MIGRATION_ID,
    commercialContactMigrationPlan,
} from '../commercialContactMigration.js'

test('defines an additive and non-destructive commercial contact migration', () => {
    const plan = commercialContactMigrationPlan()
    assert.equal(plan.id, COMMERCIAL_CONTACT_MIGRATION_ID)
    assert.deepEqual(plan.tables, ['commercial_contact_permissions', 'commercial_contact_permission_events'])
    assert.equal(plan.indexes.some((sql) => /concurrently/i.test(sql)), true)
    assert.match(plan.rollback, /non-destructive/i)
})
