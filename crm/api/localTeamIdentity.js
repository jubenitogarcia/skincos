/**
 * Keep the local preview aligned with the hosted identity invariant:
 * a CRM account is linked only when the review is confirmed and an explicit
 * CRM username is present. Legacy preview rows may contain only one side of
 * that state; they must fail closed and remain repairable by an explicit link
 * proposal.
 */
export function normalizeLocalCrmAccountLink(member = {}) {
    const username = String(member.crmAccountUsername || '').trim() || null
    const reviewStatus = String(
        member.crmAccountReviewStatus || (member.crmAccountLinked === false ? '' : 'CONFIRMED'),
    ).trim().toUpperCase() || null

    return {
        username,
        reviewStatus,
        linked: reviewStatus === 'CONFIRMED' && Boolean(username),
        inconsistent: reviewStatus === 'CONFIRMED' && !username,
    }
}
