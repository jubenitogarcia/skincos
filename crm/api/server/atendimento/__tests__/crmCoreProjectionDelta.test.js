import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
    CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT,
    reconcileAtendimentoProjectionMembershipRows,
} from '../crmCoreProjectionDelta.js'

const IDENTITY_A = '11111111-1111-4111-8111-111111111111'
const IDENTITY_B = '22222222-2222-4222-8222-222222222222'
const FIRST = '2026-09-08T12:00:00.000Z'
const SECOND = '2026-09-08T12:01:00.000Z'
const OBSERVED = '2026-09-08T12:02:00.000Z'

test('bootstraps one revision-1 upsert per canonical multi-unit membership', () => {
    const plan = reconcileAtendimentoProjectionMembershipRows({
        current: [
            { identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: FIRST },
            { identity_id: IDENTITY_A, unit_slug: 'pinheiros', observed_at: FIRST },
        ],
        existing: [],
        observedAt: OBSERVED,
    })

    assert.equal(plan.upsertCount, 2)
    assert.equal(plan.revokeCount, 0)
    assert.deepEqual(plan.changes.map(({ identityId, unitSlug, revision, operation }) => ({ identityId, unitSlug, revision, operation })), [
        { identityId: IDENTITY_A, unitSlug: 'jardins', revision: 1, operation: CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT },
        { identityId: IDENTITY_A, unitSlug: 'pinheiros', revision: 1, operation: CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT },
    ])
})

test('emits one revoke tombstone for a removed unit and does not repeat it', () => {
    const existing = [{ identity_id: IDENTITY_A, unit_slug: 'jardins', active: true, revision: 3, observed_at: FIRST }]
    const removed = reconcileAtendimentoProjectionMembershipRows({ current: [], existing, observedAt: OBSERVED })
    assert.equal(removed.revokeCount, 1)
    assert.deepEqual(removed.changes[0], {
        identityId: IDENTITY_A,
        unitSlug: 'jardins',
        revision: 4,
        operation: CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
        observedAt: OBSERVED,
        reason: 'membership_removed',
    })

    const alreadyRevoked = reconcileAtendimentoProjectionMembershipRows({
        current: [],
        existing: [{ ...existing[0], active: false, revision: 4, observed_at: OBSERVED }],
        observedAt: '2026-09-08T12:03:00.000Z',
    })
    assert.equal(alreadyRevoked.changes.length, 0)
})

test('increments revision when evidence changes, restores a tombstone, and leaves unchanged rows quiet', () => {
    const existing = [
        { identity_id: IDENTITY_A, unit_slug: 'jardins', active: true, revision: 2, observed_at: FIRST },
        { identity_id: IDENTITY_B, unit_slug: 'pinheiros', active: false, revision: 5, observed_at: FIRST },
    ]
    const plan = reconcileAtendimentoProjectionMembershipRows({
        current: [
            { identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: SECOND },
            { identity_id: IDENTITY_B, unit_slug: 'pinheiros', observed_at: SECOND },
        ],
        existing,
        observedAt: OBSERVED,
    })
    assert.deepEqual(plan.changes.map(({ identityId, revision, reason }) => ({ identityId, revision, reason })), [
        { identityId: IDENTITY_A, revision: 3, reason: 'membership_changed' },
        { identityId: IDENTITY_B, revision: 6, reason: 'membership_restored' },
    ])

    const quiet = reconcileAtendimentoProjectionMembershipRows({
        current: [
            { identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: SECOND },
        ],
        existing: [
            { identity_id: IDENTITY_A, unit_slug: 'jardins', active: true, revision: 3, observed_at: SECOND },
        ],
        observedAt: OBSERVED,
    })
    assert.equal(quiet.changes.length, 0)
    assert.equal(quiet.unchangedCount, 1)
})

test('rejects wildcard units, duplicate memberships, and PII-shaped source rows', () => {
    assert.throws(() => reconcileAtendimentoProjectionMembershipRows({ current: [{ identity_id: IDENTITY_A, unit_slug: 'all', observed_at: FIRST }], existing: [] }), /MEMBERSHIP_ROW_INVALID/)
    assert.throws(() => reconcileAtendimentoProjectionMembershipRows({ current: [{ identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: FIRST }, { identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: FIRST }], existing: [] }), /SOURCE_INVALID/)
    assert.throws(() => reconcileAtendimentoProjectionMembershipRows({ current: [{ identity_id: IDENTITY_A, unit_slug: 'jardins', observed_at: FIRST, email: 'forbidden@example.invalid' }], existing: [] }), /MEMBERSHIP_ROW_INVALID/)
})
