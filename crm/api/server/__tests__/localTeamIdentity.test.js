import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLocalCrmAccountLink } from '../../localTeamIdentity.js'

test('requires confirmed status and explicit username before exposing a CRM link', () => {
    assert.deepEqual(normalizeLocalCrmAccountLink({ crmAccountLinked: true }), {
        username: null,
        reviewStatus: 'CONFIRMED',
        linked: false,
        inconsistent: true,
    })
    assert.deepEqual(normalizeLocalCrmAccountLink({ crmAccountUsername: 'ana', crmAccountReviewStatus: 'CONFIRMED' }), {
        username: 'ana',
        reviewStatus: 'CONFIRMED',
        linked: true,
        inconsistent: false,
    })
})

test('keeps pending and rejected proposals explicit without granting access', () => {
    assert.equal(normalizeLocalCrmAccountLink({ crmAccountUsername: 'legacy', crmAccountReviewStatus: 'PENDING_REVIEW' }).linked, false)
    assert.equal(normalizeLocalCrmAccountLink({ crmAccountUsername: 'legacy', crmAccountReviewStatus: 'REJECTED' }).linked, false)
})
