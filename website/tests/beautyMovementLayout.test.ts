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
    const finishDeal = experience.slice(
        experience.indexOf("function finishDealScroll"),
        experience.indexOf("function startInitialDealScroll"),
    );

    assert.match(nextHand, /setCurrentHandStage\("collect"\);[\s\S]*startInitialDealScroll\(\);/);
    assert.match(nextHand, /window\.requestAnimationFrame\(finishDealScroll\)/);
    assert.match(finishDeal, /function finishDealScroll\(\)[\s\S]*window\.setTimeout\([\s\S]*stopInitialDealScroll\(\)/);
    assert.doesNotMatch(finishDeal, /scrollToTable\(\)/);
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
    assert.match(styles, /--bm-mobile-deck-prompt-anchor: var\(--bm-mobile-deck-anchor\);/);
    assert.match(styles, /--bm-mobile-deck-anchor: -88px;/);
    assert.match(styles, /\.page \{[\s\S]*padding-top: 0;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
    assert.match(globalStyles, /body:has\(\.beautyMovementPage\) \.header[\s\S]*border-bottom-color: transparent/);
    assert.match(styles, /\.hero \{[\s\S]*width: 100vw;[\s\S]*margin-left: calc\(50% - 50vw\)/);
    assert.match(styles, /inset: -1px 0 0 0;[\s\S]*background: linear-gradient\(180deg, #ffffff 0%, #ffffff 10%, #fbfaf5 28%, #f4eedf 60%, #f1e2b7 100%\)/);
    const visualHandoffStyles = styles.slice(styles.lastIndexOf("/* Visual handoff refinements"));
    assert.doesNotMatch(visualHandoffStyles, /\.hero::before\s*\{[^}]*radial-gradient/);
    assert.doesNotMatch(styles, /linear-gradient\(102deg, #ffffff 0%, #fbfaf5 32%, #f4eedf 68%, #f1e2b7 100%\)/);
    assert.match(styles, /@media \(min-width: 721px\) \{[\s\S]*\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardButton \{[\s\S]*min-height: clamp\(280px, 24\.3vw, 292px\)/);
    assert.match(styles, /\.progressItemCurrent \.autoAdvance \{[\s\S]*transform: translateY\(-3px\)/);
    assert.match(styles, /@keyframes deckStageCollect[\s\S]*translateX\(-50%\) translateY\(0\) scale\(1\.04\)/);
    assert.match(experience, /function finishDealScroll\(\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.tableSurface,[\s\S]*\.tableStage\[data-finale-stage="confirmation"\] \.tableSurface,[\s\S]*isolation: isolate[\s\S]*border-color: transparent[\s\S]*background: transparent[\s\S]*box-shadow: none/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.tableSurface::before,[\s\S]*\.tableStage\[data-finale-stage="confirmation"\] \.tableSurface::before[\s\S]*background:[\s\S]*var\(--bm-bg\)[\s\S]*content: ""/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\]\[data-finale-stage="merging"\] \.tableSurface::before[\s\S]*finaleSurfaceChromeDissolve/);
    assert.match(styles, /@keyframes finaleSurfaceChromeDissolve[\s\S]*opacity: 0[\s\S]*filter: blur\(8px\)/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.tableSurface::before,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.tableSurface::before[\s\S]*opacity: 0/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*data-finale-stage="merging"\] \.tableSurface::before[\s\S]*opacity: 0/);
    assert.match(styles, /\.specialCardBackWithAction \{[\s\S]*justify-content: flex-start[\s\S]*gap: 0[\s\S]*padding: 34px 24px 24px/);
    assert.match(styles, /\.specialCardBackWithAction \.specialCardRevealContent \{[\s\S]*margin-top: clamp\(24px, 3vw, 34px\)[\s\S]*gap: 0/);
    assert.match(styles, /\.specialCardBackWithAction \.specialCardRevealAction \{[\s\S]*margin-top: clamp\(24px, 3\.6vw, 38px\)[\s\S]*gap: 8px/);
    assert.match(styles, /\.specialCardBackWithAction \.specialCardSeal \{[\s\S]*margin-top: auto/);
    assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.specialCardBackWithAction \{[\s\S]*padding: 28px 20px 20px/);
    assert.match(styles, /@media \(min-width: 721px\)[\s\S]*\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \{[\s\S]*justify-content: center[\s\S]*gap: clamp\(6px, 0\.7vw, 9px\)[\s\S]*padding: clamp\(14px, 1\.4vw, 18px\)/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardIllustration \{[\s\S]*width: clamp\(88px, 7\.2vw, 96px\)[\s\S]*height: clamp\(88px, 7\.2vw, 96px\)/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack strong \{[\s\S]*font-size: clamp\(1\.35rem, 2\.35vw, 2rem\)[\s\S]*line-height: 0\.92/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.tableSurface,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.tableSurface \{[\s\S]*padding-bottom: clamp\(10px, 1\.4vw, 16px\)/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.specialCardStage,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.specialCardStage \{[\s\S]*transform: translateY\(clamp\(-48px, -3\.6vw, -22px\)\)/);
    assert.match(styles, /--bm-mobile-prompt-height: clamp\(140px, 44vw, 160px\)/);
    assert.match(styles, /\.tableSurface\[data-deck-state="prompt"\] \.deckStage,[\s\S]*bottom: var\(--bm-mobile-deck-prompt-anchor\)/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \{[\s\S]*grid-template-columns: clamp\(50px, 15\.5vw, 62px\) minmax\(0, 1fr\)[\s\S]*column-gap: clamp\(2px, 0\.8vw, 4px\)[\s\S]*padding-inline: clamp\(10px, 2\.6vw, 14px\)/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardIllustration \{[\s\S]*width: clamp\(50px, 15\.5vw, 62px\)[\s\S]*height: clamp\(50px, 15\.5vw, 62px\)/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardCopy \{[\s\S]*grid-column: 2;[\s\S]*margin-left: 0/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardActLabel \{[\s\S]*margin-left: 0/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardCopy strong \{[\s\S]*display: inline/);
    assert.match(styles, /\.tableStage\[data-hand-stage="held"\] \.cardGrid \.cardButtonSelected,[\s\S]*animation: none[\s\S]*transform: none/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.specialCardStage,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.specialCard \{[\s\S]*min-height: var\(--bm-mobile-special-card-height\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding \.finaleCard \{[\s\S]*--finale-y: var\(--bm-mobile-deal-origin\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding \{[\s\S]*gap: var\(--bm-mobile-card-gap\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.tableSurface \{[\s\S]*height: auto;[\s\S]*padding-bottom: var\(--bm-mobile-card-gap\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding \{[\s\S]*align-content: start;[\s\S]*grid-auto-rows: var\(--bm-mobile-card-height\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridHolding \.finaleCardFace \{[\s\S]*box-sizing: border-box;[\s\S]*height: 100%/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \.cardIllustration \{[\s\S]*opacity: 1;[\s\S]*transform: none/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardCopy \{[\s\S]*font-size: clamp\(0\.82rem, 3\.4vw, 0\.96rem\)[\s\S]*line-height: 1\.16/);
    assert.match(styles, /\.tableStage:not\(\[data-hand-stage="finale"\]\) \.cardBack \.cardCopy strong \{[\s\S]*font-size: clamp\(1\.28rem, 6\.6vw, 1\.56rem\)[\s\S]*line-height: 0\.94/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \{[\s\S]*grid-template-columns: clamp\(50px, 15\.5vw, 62px\) minmax\(0, 1fr\)[\s\S]*column-gap: clamp\(2px, 0\.8vw, 4px\)[\s\S]*padding-inline: clamp\(10px, 2\.6vw, 14px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \.cardIllustration \{[\s\S]*width: clamp\(50px, 15\.5vw, 62px\)[\s\S]*height: clamp\(50px, 15\.5vw, 62px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \.cardActLabel \{[\s\S]*margin-left: 0/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \.cardCopy \{[\s\S]*margin-left: 0[\s\S]*font-size: clamp\(0\.82rem, 3\.4vw, 0\.96rem\)[\s\S]*line-height: 1\.16/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardFace \.cardCopy strong \{[\s\S]*font-size: clamp\(1\.28rem, 6\.6vw, 1\.56rem\)[\s\S]*line-height: 0\.94/);
    assert.doesNotMatch(styles, /mobileDeckStageDeal/);
    assert.match(styles, /\.tableStage\[data-hand-stage="deal"\] \.deckStage,[\s\S]*bottom: var\(--bm-mobile-deck-anchor\)/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.specialCardBackWithAction,[\s\S]*\.tableStage\[data-finale-stage="result"\] \.specialCardBackWithAction \{[\s\S]*justify-content: center[\s\S]*padding: 20px 16px 14px/);
    assert.match(styles, /\.specialCardModalDialog \.specialCard \{[\s\S]*min-height: clamp\(448px, 145vw, 474px\)/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardFrontOffer \{[\s\S]*justify-content: center[\s\S]*gap: clamp\(6px, 1\.6vw, 9px\)[\s\S]*padding: 18px 18px 16px/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardFrontOffer \.specialCardWhatsappAction \{[\s\S]*margin-top: 4px[\s\S]*margin-bottom: 0/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardFrontOffer \.specialCardIllustration \{[\s\S]*width: clamp\(160px, 52vw, 188px\)[\s\S]*height: clamp\(148px, 48vw, 174px\)/);
    assert.match(styles, /\.specialCardGiftNote \{[\s\S]*font-size: clamp\(0\.66rem, 2\.6vw, 0\.78rem\)/);
    assert.match(experience, /styles\.specialCardWithPrice/);
    assert.match(experience, /function renderRevealedCardContent\(card: BeautyMovementCard, actLabel: string\)/);
    assert.match(experience, /renderRevealedCardContent\(card, tableDefinition\.label\)/);
    assert.match(experience, /renderRevealedCardContent\(card, line\.actLabel\)/);
    assert.match(experience, /className=\{`\$\{styles\.finaleCardFace\} \$\{styles\.cardBack\}`\}/);
    assert.match(experience, /Você também leva o squeeze e a ecobag da Espaço Facial, além de mais mimos da celebração\./);
    assert.match(experience, /styles\.specialCardGiftNote/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardWithPrice \{[\s\S]*min-height: clamp\(568px, 178vw, 592px\)/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardFrontOffer \.specialCardConditions \{[\s\S]*position: static[\s\S]*width: 100%/);
    assert.match(styles, /\.specialCardModalDialog \.specialCardWithPrice \.specialCardConditions \{[\s\S]*position: static[\s\S]*width: 100%/);
    assert.match(experience, /renderSpecialCard\(false, "reopen", true\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.tableSurface > \.deckStage,[\s\S]*position: absolute[\s\S]*z-index: 2/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.deckStage \{[\s\S]*animation: deckStageFinaleVanish var\(--bm-finale-merge-ms\)/);
    assert.match(styles, /@keyframes deckStageFinaleVanish[\s\S]*100% \{[\s\S]*opacity: 0[\s\S]*visibility: hidden/);
    assert.match(styles, /\.cardButton \{[\s\S]*cursor: pointer/);
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
    assert.match(styles, /\.tableStage\[data-special-modal="open"\] \.tableSurface::before[\s\S]*opacity: 0/);
    assert.match(styles, /@keyframes finaleSurfaceChromeDissolve/);
    assert.match(styles, /\.finaleCountdownBar \{\s*transform: scaleX\(0\.35\);/m);
    assert.match(styles, /data-hand-stage="prompt-out"/);
    assert.match(styles, /data-hand-stage="deal"/);
    assert.doesNotMatch(experience, /cancelOnReadingIntent|cancelWhenBackgrounded/);
});
