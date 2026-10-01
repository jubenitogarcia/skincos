import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("mobile handoff keeps one rhythm, one deck anchor, and a roomier special-card geometry", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    assert.match(
        styles,
        /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding\s*\{\s*gap: var\(--bm-mobile-card-gap\);/,
    );
    assert.doesNotMatch(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding\s*\{\s*gap: 0;/);
    assert.match(styles, /--bm-mobile-deck-anchor:/);
    assert.doesNotMatch(styles, /mobileDeckStageDeal/);
    assert.doesNotMatch(styles, /translateX\(-50%\) translateY\(-32px\)/);
    assert.match(
        styles,
        /\.tableStage\[data-finale-stage="confirmation"\] \.specialCardStage,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.specialCard\s*\{\s*min-height: var\(--bm-mobile-special-card-height\);/,
    );
    assert.match(styles, /--bm-mobile-special-card-height: clamp\(300px, 100vw, 320px\);/);
    assert.match(
        styles,
        /\.specialCardModalDialog \.specialCard\s*\{\s*min-height: clamp\(460px, 149vw, 486px\);/,
    );
    assert.match(
        styles,
        /\.specialCardModalDialog \.specialCardFrontOffer\s*\{\s*justify-content: center;\s*gap: clamp\(6px, 1\.6vw, 9px\);\s*padding: 18px 18px 16px;/,
    );
    assert.match(
        styles,
        /\.specialCardModalDialog \.specialCardFrontOffer \.specialCardIllustration\s*\{\s*width: clamp\(160px, 52vw, 188px\);\s*height: clamp\(148px, 48vw, 174px\);/,
    );
    assert.match(styles, /\.specialCardModalDialog \.specialCardWithPrice\s*\{\s*min-height: clamp\(568px, 178vw, 592px\);/);
    assert.match(
        styles,
        /\.specialCardModalDialog \.specialCard:has\(\.specialCardConditions\[open\]\)\s*\{\s*min-height: clamp\(548px, 172vw, 584px\);/,
    );
    assert.match(
        styles,
        /\.specialCardModalDialog \.specialCardWithPrice:has\(\.specialCardConditions\[open\]\)\s*\{\s*min-height: clamp\(636px, 199vw, 660px\);/,
    );
    assert.match(styles, /\.specialCardModalClose\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);

    assert.match(experience, /const dealScrollSettleTimerRef = useRef<number \| null>\(null\)/);
    assert.match(experience, /function clearDealScrollSettleTimer\(\)/);
    assert.match(experience, /clearDealScrollSettleTimer\(\);\s*initialDealScrollActiveRef\.current = false;/);
    assert.match(experience, /function promptReadingDelay\(text: string, reducedMotion: boolean\): number\s*\{\s*return reducedMotion \? 0 : promptReadingDuration\(text\);/);
    assert.match(experience, /const keepFocusInDialog = \(event: KeyboardEvent\) =>/);
    assert.match(experience, /event\.key === "Escape"/);
    assert.match(experience, /specialCardModalDialogRef\.current/);
    assert.match(experience, /textarea:not\(\[disabled\]\), summary, \[tabindex\]/);

    const autoAdvanceTimer = experience.slice(
        experience.indexOf("autoAdvanceTimerRef.current = window.setTimeout"),
        experience.indexOf("function scheduleNextHand"),
    );
    assert.match(autoAdvanceTimer, /reducedMotionRef\.current/);
    assert.match(experience, /if \(!reducedMotion\) return;\s*cancelAutoAdvance\(\);/);
});
