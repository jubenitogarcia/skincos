/**
 * One source of truth for the invitation's visual choreography.
 *
 * The component also passes the durations to CSS custom properties, so a
 * logical phase cannot become interactive before its matching animation ends.
 */
export const BEAUTY_MOVEMENT_MOTION = {
    autoAdvanceMs: 5_000,
    finaleHoldMs: 5_000,
    handRevealMs: 1_500,
    handRevealFallbackMs: 1_700,
    handCollectMs: 860,
    handExpandMs: 760,
    handDealMs: 960,
    /** A short settle window keeps the freshly dealt cards fully at rest before clicks are enabled. */
    handDealSettleMs: 120,
    progressCollapseMs: 220,
    progressEnterMs: 620,
    progressTransferMs: 480,
    progressExpandMs: 260,
    progressTransitionMs: 960,
    finaleCardsEnterMs: 880,
    finaleMergeMs: 1_200,
    finaleCardMergeMs: 1_120,
    /** Let the last merge frame land before swapping the DOM. */
    finaleMergeSettleMs: 120,
    initialIntroHoldMs: 2_600,
    promptWordDelayMs: 48,
    promptWordAnimationMs: 840,
    promptReadingHoldMs: 2_600,
    promptExitBaseMs: 560,
    promptExitWordDelayMs: 16,
    promptExitBreathMs: 320,
} as const;

/**
 * Invalidates nested timer callbacks whenever the participant takes a newer
 * action. It is deliberately tiny so it can be tested without a DOM clock.
 */
export function createBeautyMovementMotionGate() {
    let generation = 0;

    return {
        start() {
            generation += 1;
            return generation;
        },
        invalidate() {
            generation += 1;
        },
        isCurrent(token: number) {
            return token === generation;
        },
    };
}
