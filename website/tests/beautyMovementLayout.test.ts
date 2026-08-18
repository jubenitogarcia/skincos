import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("the table handoff follows the deck and keeps the title in the compact viewport", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    const nextHand = experience.slice(
        experience.indexOf("function moveToNextHand"),
        experience.indexOf("function startAutoAdvance"),
    );

    assert.match(nextHand, /setCurrentHandStage\("collect"\);[\s\S]*startInitialDealScroll\(\);/);
    assert.match(nextHand, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*stopInitialDealScroll\)/);
    assert.match(experience, /const titleFits = titleRect\.height <= window\.innerHeight - headerOffset - 16/);
    assert.match(experience, /const isStackedLayout = window\.matchMedia\("\(max-width: 720px\)"\)\.matches/);
    assert.match(experience, /if \(titleFits && !isStackedLayout\)/);
    assert.match(experience, /const interruptOnUserIntent = \(\) => stopInitialDealScroll\(\);/);
    assert.match(
        experience,
        /window\.requestAnimationFrame\(\(\) => \{[\s\S]*window\.addEventListener\("keydown", interruptOnUserIntent/,
    );
    assert.match(experience, /initialDealScrollInterruptCleanupRef\.current = removeFollowInterrupts/);
    assert.match(experience, /const titleTarget = Math\.max\(0, titleTop - headerOffset - 12\)/);
    assert.match(experience, /const isStackedLayout = window\.matchMedia\("\(max-width: 720px\)"\)\.matches;[\s\S]*titleTarget === null \|\| isStackedLayout/);
    assert.match(styles, /\.hero \{[\s\S]*min-height: clamp\(196px, 16vw, 224px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="collect"\] \.deckStage,[\s\S]*\.tableStage\[data-hand-stage="ready"\] \.deckStage \{[\s\S]*bottom: -56px/);
});

test("the finale exposes a non-cancellable five-second merge countdown", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    assert.match(experience, /"--bm-finale-hold-ms": `\$\{BEAUTY_MOVEMENT_MOTION\.finaleHoldMs\}ms`/);
    assert.match(experience, /finaleStage === "collecting"/);
    assert.match(experience, /styles\.finaleCountdownSlot/);
    assert.match(experience, /className=\{styles\.finaleCountdown\}/);
    assert.match(experience, /Sua leitura está se reunindo · 5 segundos/);
    assert.match(experience, /deferRevealContent \? styles\.specialCardRevealContent : undefined/);
    assert.match(styles, /\.finaleCountdownBar \{[\s\S]*animation: finaleCountdownFill var\(--bm-finale-hold-ms\) linear both/);
    assert.match(styles, /\.finaleCountdownSlot \{[\s\S]*min-height: 43px/);
    assert.match(styles, /@keyframes finaleCountdownFill/);
    assert.match(styles, /\.finaleSpecialCardTransform \.specialCardRevealContent,[\s\S]*\.specialCardStage:not\(\.specialCardStageReopen\) \.specialCardRevealContent[\s\S]*animation-delay: calc\(var\(--bm-special-enter-ms\) \+ 40ms\)/);
    assert.match(styles, /\.finaleCountdownBar \{\s*transform: scaleX\(0\.35\);/m);
    assert.doesNotMatch(experience, /cancelOnReadingIntent|cancelWhenBackgrounded/);
});
