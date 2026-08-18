import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("the table handoff follows the deck and keeps the title in the compact viewport", async () => {
    const [experience, styles, globalStyles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
        readFile(sourceUrl("src/styles/globals.css"), "utf8"),
    ]);

    const nextHand = experience.slice(
        experience.indexOf("function moveToNextHand"),
        experience.indexOf("function startAutoAdvance"),
    );

    assert.match(nextHand, /setCurrentHandStage\("collect"\);[\s\S]*startInitialDealScroll\(\);/);
    assert.match(nextHand, /window\.requestAnimationFrame\(finishDealScroll\)/);
    assert.match(experience, /function finishDealScroll\(\)[\s\S]*scrollToTable\(\)/);
    assert.match(experience, /const titleFits = titleRect\.height <= window\.innerHeight - headerOffset - 16/);
    assert.match(experience, /const isStackedLayout = window\.matchMedia\("\(max-width: 720px\)"\)\.matches/);
    assert.match(experience, /const headerCollapseTarget =/);
    assert.match(experience, /const anchorTarget = Math\.max\(Math\.min\(fittedTarget, titleTarget\), headerCollapseTarget\)/);
    assert.match(experience, /const handBottomAtAnchor = handBottom - \(anchorTarget - window\.scrollY\)/);
    assert.match(experience, /const handFitsAtAnchor = handBottomAtAnchor <= window\.innerHeight \+ 24/);
    assert.match(experience, /if \(handFitsAtAnchor\) return anchorTarget/);
    assert.match(experience, /function animateTableScroll\(targetTop: number \| null\)/);
    assert.match(experience, /animateTableScroll\(getTableScrollTarget\(\)\)/);
    assert.match(experience, /data-scroll-aware-header=/);
    assert.match(experience, /classList\.add\("header--hidden"\)/);
    assert.match(experience, /The follow loop is part of the reading transition/);
    assert.doesNotMatch(experience, /addEventListener\("(?:wheel|touchstart|pointerdown|keydown)", interruptOnUserIntent/);
    assert.doesNotMatch(experience, /scrollInterruptCleanupRef|initialDealScrollInterruptCleanupRef/);
    assert.doesNotMatch(experience, /removeScrollInterrupts/);
    assert.match(experience, /const titleTarget = Math\.max\(0, titleTop - headerOffset - 12\)/);
    assert.match(styles, /\.hero \{[\s\S]*min-height: clamp\(196px, 16vw, 224px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="collect"\] \.deckStage,[\s\S]*\.tableStage\[data-hand-stage="ready"\] \.deckStage \{[\s\S]*bottom: -79px/);
    assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.tableStage\[data-hand-stage="collect"\] \.deckStage,[\s\S]*\.tableStage\[data-hand-stage="ready"\] \.deckStage \{[\s\S]*bottom: -56px/);
    assert.match(styles, /\.page \{[\s\S]*padding-top: 0;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
    assert.match(globalStyles, /body:has\(\.beautyMovementPage\) \.header[\s\S]*border-bottom-color: transparent/);
    assert.match(styles, /\.hero \{[\s\S]*width: 100vw;[\s\S]*margin-left: calc\(50% - 50vw\)/);
    assert.match(styles, /inset: -1px 0 0 0;[\s\S]*background: linear-gradient\(180deg, #ffffff 0%, #ffffff 10%, #fbfaf5 28%, #f4eedf 60%, #f1e2b7 100%\)/);
    const visualHandoffStyles = styles.slice(styles.lastIndexOf("/* Visual handoff refinements"));
    assert.doesNotMatch(visualHandoffStyles, /\.hero::before[\s\S]*radial-gradient/);
    assert.doesNotMatch(styles, /linear-gradient\(102deg, #ffffff 0%, #fbfaf5 32%, #f4eedf 68%, #f1e2b7 100%\)/);
    assert.match(styles, /@media \(min-width: 721px\) \{[\s\S]*\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardButton \{[\s\S]*min-height: clamp\(280px, 24\.3vw, 292px\)/);
    assert.match(styles, /\.progressItemCurrent \.autoAdvance \{[\s\S]*transform: translateY\(-3px\)/);
    assert.match(styles, /@keyframes deckStageCollect[\s\S]*translateX\(-50%\) translateY\(0\) scale\(1\.04\)/);
    assert.match(experience, /function finishDealScroll\(\)/);
});

test("the finale exposes a non-cancellable five-second merge countdown", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    assert.match(experience, /"--bm-finale-hold-ms": `\$\{BEAUTY_MOVEMENT_MOTION\.finaleHoldMs\}ms`/);
    assert.match(experience, /finaleStage === "collecting"/);
    assert.match(experience, /styles\.finaleCountdownSlot/);
    assert.match(experience, /const finaleFlowActive =/);
    assert.match(experience, /styles\.progressRowFinale/);
    assert.match(experience, /finaleFlowActive \? \(/);
    assert.match(experience, /className=\{styles\.finaleCountdown\}/);
    assert.match(experience, /className=\{styles\.finaleCountdown\}[\s\S]*aria-hidden="true"/);
    assert.match(experience, /className=\{styles\.srOnly\} role="status" aria-live="polite"[\s\S]*Sua leitura está se reunindo/);
    assert.match(experience, /Sua leitura está se reunindo · 5 segundos/);
    assert.match(experience, /const revealContentClass = deferRevealContent \|\| showRevealAction \? styles\.specialCardRevealContent : undefined/);
    assert.match(experience, /<div className=\{revealContentClass\}>/);
    assert.match(styles, /\.finaleCountdownBar \{[\s\S]*animation: finaleCountdownFill var\(--bm-finale-hold-ms\) linear both/);
    assert.match(styles, /\.finaleCountdownSlot \{[\s\S]*min-height: 43px/);
    assert.match(styles, /\.progressRowFinale \{[\s\S]*min-height: 52px[\s\S]*align-items: center/);
    assert.match(styles, /@keyframes finaleCountdownFill/);
    assert.match(styles, /\.finaleSpecialCardTransform \.specialCardRevealContent \{[\s\S]*opacity: 0/);
    assert.match(styles, /\.specialCardStage:not\(\.specialCardStageReopen\) \.specialCardRevealContent[\s\S]*animation-delay: calc\(var\(--bm-special-enter-ms\) \+ 40ms\)/);
    assert.match(experience, /data-special-modal=\{isSpecialCardModalOpen \? "open" : "closed"\}/);
    assert.match(styles, /\.tableStage\[data-special-modal="open"\] \.tableSurface[\s\S]*specialTableSurfaceDissolve/);
    assert.match(styles, /@keyframes specialTableSurfaceDissolve/);
    assert.match(styles, /\.finaleCountdownBar \{\s*transform: scaleX\(0\.35\);/m);
    assert.match(styles, /data-hand-stage="prompt-out"/);
    assert.match(styles, /data-hand-stage="deal"/);
    assert.doesNotMatch(experience, /cancelOnReadingIntent|cancelWhenBackgrounded/);
});
