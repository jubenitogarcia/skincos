import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("continuous experience reuses the real shell and keeps the inline finale flow", async () => {
    const [page, localPage, experience, styles, campaignStyles, illustrations, header, headerScrollBehavior, globalStyles, cards] = await Promise.all([
        readFile(sourceUrl("src/app/beleza-em-movimento/page.tsx"), "utf8"),
        readFile(sourceUrl("src/app/beleza-em-movimento/local-preview/page.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementCampaign.module.css"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementCardIllustration.tsx"), "utf8"),
        readFile(sourceUrl("src/components/Header.tsx"), "utf8"),
        readFile(sourceUrl("src/components/HeaderScrollBehavior.tsx"), "utf8"),
        readFile(sourceUrl("src/styles/globals.css"), "utf8"),
        readFile(sourceUrl("src/lib/beautyMovementCards.ts"), "utf8"),
    ]);

    for (const route of [page, localPage]) {
        assert.match(route, /import Header from "@\/components\/Header"/);
        assert.match(route, /<Header(?:\s+[^>]*)? \/>/);
        assert.match(route, /preferredUnitSlug="novo-hamburgo"/);
        assert.match(route, /fixedUnitSlug="novo-hamburgo"/);
        assert.match(route, /scrollAware/);
        assert.match(route, /<Footer \/>/);
    }

    assert.match(experience, /className=\{styles\.tableStage\}/);
    assert.match(experience, /id="mesa-de-cartas"/);
    assert.match(experience, /data-hand-stage=\{handStage\}/);
    assert.match(experience, /beauty_movement_act_view/);
    assert.match(experience, /requestAnimationFrame\(animate\)/);
    assert.match(experience, /scrollIntoView\(\{ behavior: "auto"/);
    assert.match(experience, /prefers-reduced-motion/);
    assert.match(experience, /import \{ BEAUTY_MOVEMENT_MOTION, createBeautyMovementMotionGate \}/);
    assert.match(experience, /AUTO_ADVANCE_SECONDS = BEAUTY_MOVEMENT_MOTION\.autoAdvanceMs \/ 1_000/);
    assert.match(experience, /type IntroStage = "hidden" \| "entering" \| "holding" \| "exiting"/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.initialIntroHoldMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.promptWordDelayMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.promptWordAnimationMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.promptReadingHoldMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.promptExitBaseMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.promptExitBreathMs/);
    assert.match(experience, /function promptEntryDuration\(text: string\)/);
    assert.match(experience, /function promptReadingDuration\(text: string\)/);
    assert.match(experience, /function promptExitTransitionDuration\(text: string\)/);
    assert.match(experience, /function renderPromptWords\(text: string, wordOffset = 0\)/);
    assert.match(experience, /onKeyDown=\{\(event\) => \{/);
    assert.match(experience, /event\.key === "Enter" \|\| event\.key === " "/);
    assert.match(experience, /event\.preventDefault\(\);\s*void handleReveal\(displayedActIndex, card\)/);
    assert.match(experience, /function motionDuration\(durationMs: number, reducedMotion: boolean, preserveTiming = false\)/);
    assert.match(experience, /function promptReadingDelay\(text: string, reducedMotion: boolean\)/);
    assert.match(experience, /motionDuration\(delayMs, reducedMotionRef\.current, preserveTiming\)/);
    assert.match(experience, /if \(reducedMotion\) return;/);
    assert.match(experience, /handleSelectedCardAnimationEnd/);
    assert.match(experience, /handRevealFallbackMs/);
    assert.match(experience, /autoAdvanceActive/);
    assert.match(experience, /function beginFinale\(\)/);
    assert.match(experience, /function handleProgressClick\(index: number\)/);
    assert.match(experience, /revealInFlightRef/);
    assert.match(experience, /transitionInFlightRef/);
    assert.match(experience, /confirmInFlightRef/);
    assert.match(experience, /setCurrentFinaleStage\("collecting"\)/);
    assert.match(experience, /setCurrentFinaleStage\("merging"\)/);
    assert.match(experience, /FINALE_HOLD_SECONDS = BEAUTY_MOVEMENT_MOTION\.finaleHoldMs \/ 1_000/);
    assert.match(experience, /finaleHoldRemaining/);
    assert.match(experience, /setCurrentFinaleStage\("assembling"\)/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.finaleCardsEnterMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.finaleMergeMs/);
    assert.match(experience, /className=\{styles\.inlineFinale\}/);
    assert.match(experience, /renderConfirmationAction/);
    assert.match(experience, /renderResultStage/);
    assert.match(experience, /automática em \{AUTO_ADVANCE_SECONDS\} segundos/);
    assert.doesNotMatch(experience, /confirmationTriggerRef/);
    assert.match(experience, /className=\{styles\.progressButton\}/);
    assert.match(experience, /disabled=\{!isCurrent \|\| Boolean\(progressMotion\)\}/);
    assert.match(experience, /onClick=\{\(\) => handleProgressClick\(index\)\}/);
    assert.match(experience, /className=\{styles\.progressCopy\}/);
    assert.match(
        experience,
        /<\/span>\s*\{isCurrent && !progressMotion && autoAdvanceActive \? \(\s*<span className=\{styles\.autoAdvance\}/,
    );
    assert.doesNotMatch(experience, /<\/button>\s*\{isCurrent && autoAdvanceActive/);
    assert.doesNotMatch(experience, /<\/ol>\s*\{autoAdvanceActive \? \(/);
    assert.doesNotMatch(experience, /className=\{styles\.progressCopy\}>\s*<small>/);
    assert.match(experience, /className=\{styles\.progressRow\}/);
    assert.match(experience, /className=\{styles\.progressGroup\}/);
    assert.match(experience, /\$\{styles\.tablePrompt\}/);
    assert.match(experience, /key=\{introStage !== "hidden" \? "experience-intro" : tableDefinition\.id\}/);
    assert.match(experience, /waitingForInitialDeal \? \(/);
    assert.doesNotMatch(experience, /className=\{styles\.autoAdvanceLabel\}/);
    assert.doesNotMatch(experience, /className=\{styles\.autoAdvanceHint\}/);
    assert.doesNotMatch(experience, /className=\{styles\.brandLine\}/);
    assert.doesNotMatch(experience, /id="table-stage-title"/);
    assert.match(experience, /aria-label=\{tableDefinition\.label\}/);
    assert.match(experience, /3 anos\. 3 cartas\. Um novo movimento/);
    assert.match(experience, /className=\{styles\.specialCardStage\}/);
    assert.match(experience, /role="group" aria-label=\{`Cartas da etapa \$\{tableDefinition\.label\}`\}/);
    assert.doesNotMatch(experience, /role="list" aria-label="Cartas finais"/);
    assert.doesNotMatch(experience, /className=\{styles\.progressNumber\}/);
    assert.match(experience, /scrollToTable/);
    assert.doesNotMatch(experience, /preparedNote/);
    assert.doesNotMatch(experience, /choiceInstruction/);
    assert.match(experience, /Continuar para confirmação/);
    assert.match(experience, /finaleStage === "hidden" \? \(/);
    assert.doesNotMatch(experience, /className=\{styles\.actAdvance\}/);
    assert.doesNotMatch(experience, /className=\{styles\.continueButton\}/);
    assert.match(experience, /Garanta seu presente e confirme presença/);
    assert.doesNotMatch(experience, /Seu presente será revelado após a confirmação/);
    assert.match(experience, /email: null/);
    assert.doesNotMatch(experience, /E-mail e telefone já estão vinculados/);
    assert.doesNotMatch(experience, /beauty-movement-inline-email|E-mail <em>opcional|voce@email\.com/);
    assert.doesNotMatch(experience, /benefitPreview/);
    assert.doesNotMatch(experience, /Ver minha leitura/);
    assert.doesNotMatch(experience, /actsStack|revealedStrip/);
    assert.doesNotMatch(experience, /BeautyMovementModalReading/);
    assert.doesNotMatch(experience, /finaleCardGridSettled/);
    assert.match(experience, /aria-label=\{finaleStage === "result" \? "Carta especial do benefício"/);
    assert.match(experience, /className=\{styles\.cardSparkles\}/);
    assert.match(experience, /className=\{styles\.deckStage\}/);
    assert.match(experience, /type HandStage =\s*\|\s*"waiting"/);
    assert.match(experience, /"expand"\s*\|\s*"deal"/);
    assert.match(experience, /function scheduleDealSequence\(token: number, onReady: \(\) => void\)/);
    assert.match(experience, /tableSurfaceRef/);
    assert.match(experience, /setCurrentHandStage\("expand"\)/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.handExpandMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.handDealSettleMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.finaleMergeSettleMs/);
    assert.match(experience, /if \(handStage !== "expand"\) return;/);
    assert.match(experience, /window\.addEventListener\("resize", syncExpansionHeight\)/);
    assert.match(experience, /new ResizeObserver\(syncExpansionHeight\)/);
    assert.match(experience, /setTableExpansionHeight\(Math\.max\(220, surface\.scrollHeight\)\)/);
    assert.match(experience, /getBoundingClientRect\(\)\.height/);
    assert.match(experience, /setTableExpansionHeight\(startHeight\)/);
    assert.match(experience, /const targetHeight = Math\.max\(\s*startHeight,/);
    assert.match(experience, /"held"/);
    assert.match(experience, /function startInitialDeal\(\)/);
    assert.match(experience, /function handleDeckKeyDown\(event: ReactKeyboardEvent<HTMLButtonElement>\)/);
    assert.match(experience, /event\.key !== "Enter" && event\.key !== " " && event\.key !== "Spacebar"/);
    assert.match(experience, /onKeyDown=\{handleDeckKeyDown\}/);
    assert.match(experience, /className=\{styles\.heroDeckPrompt\}/);
    assert.match(experience, /id="beauty-movement-deck-prompt"/);
    assert.match(experience, /onClick=\{scrollToTable\}/);
    assert.match(experience, /Ir ao baralho e começar sua leitura/);
    assert.match(experience, /Começar a leitura/);
    assert.match(experience, /className=\{styles\.heroDeckPromptArrow\}/);
    assert.doesNotMatch(experience, /Clique no baralho <span aria-hidden="true">↗<\/span>/);
    assert.doesNotMatch(experience, /className=\{styles\.deckPrompt\}/);
    assert.ok(experience.indexOf("className={styles.heroDeckPrompt}") < experience.indexOf('<h1 id="beauty-movement-title">'));
    assert.match(experience, /data-deck-state=\{/);
    assert.match(experience, /finaleStage === "confirmation" \|\| finaleStage === "result"/);
    assert.match(experience, /const isCurrent = introStage === "hidden" && !waitingForInitialDeal && index === displayedActIndex/);
    assert.match(experience, /key=\{introStage !== "hidden" \? "experience-intro" : tableDefinition\.id\}/);
    assert.match(experience, /styles\.tablePromptIntro/);
    assert.match(experience, /styles\.tablePromptIntroHolding/);
    assert.match(experience, /styles\.tablePromptIntroExit/);
    assert.match(experience, /styles\.tablePromptExit/);
    assert.match(experience, /styles\.promptTitle/);
    assert.match(experience, /styles\.promptSubtitle/);
    assert.match(experience, /handStage === "prompt" \|\| handStage === "prompt-out"/);
    assert.match(experience, /setCurrentHandStage\("prompt"\)/);
    assert.doesNotMatch(experience, /className=\{styles\.actCount\}/);
    assert.match(experience, /styles\.deckCardTop/);
    assert.doesNotMatch(experience, /role="dialog"/);
    assert.doesNotMatch(experience, /aria-modal="true"/);

    assert.match(styles, /--bm-bg: #fafafa/i);
    assert.match(styles, /--bm-ink: #303030/i);
    assert.match(styles, /--bm-muted: #505050/i);
    assert.match(styles, /--bm-line: #d0d0d0/i);
    assert.match(styles, /--bm-yellow: #f5b301/i);
    assert.doesNotMatch(styles, /Georgia|--bm-plum|--bm-coral|linear-gradient/i);
    assert.doesNotMatch(styles, /\.autoAdvanceNumber/);
    assert.match(styles, /@keyframes autoAdvanceProgress/);
    assert.match(styles, /@keyframes cardIllustrationDraw/);
    assert.match(styles, /@keyframes cardIllustrationFloat/);
    assert.match(styles, /@keyframes cardLiftAndSettle/);
    assert.match(styles, /@keyframes cardFlipAndSettle/);
    assert.match(styles, /@keyframes cardSparkle/);
    assert.match(styles, /@keyframes deckDealPulse/);
    assert.match(styles, /@keyframes deckReceivePulse/);
    assert.match(styles, /@keyframes deckStageDeal/);
    assert.match(styles, /@keyframes deckStageExpand/);
    assert.match(styles, /@keyframes deckStageCollect/);
    assert.match(styles, /@keyframes deckStageReceive/);
    assert.match(styles, /@keyframes cardReturnToDeck/);
    assert.match(styles, /@keyframes cardSelectedReturnToDeck/);
    assert.match(styles, /@keyframes cardFlipToDeck/);
    assert.match(styles, /@keyframes cardDealFromDeck/);
    assert.match(
        styles,
        /\.tableStage\[data-hand-stage="reveal"\] \.cardButton:not\(\.cardButtonSelected\)\s*\{\s*pointer-events: none;\s*\}/,
    );
    assert.match(
        styles,
        /\.tableStage\[data-hand-stage="held"\] \.cardButton:not\(\.cardButtonSelected\)\s*\{\s*pointer-events: none;\s*\}/,
    );
    assert.doesNotMatch(
        styles,
        /\.tableStage\[data-hand-stage="reveal"\] \.cardButton:not\(\.cardButtonSelected\)[^}]*animation:\s*cardReturnToDeck/,
    );
    assert.doesNotMatch(
        styles,
        /\.tableStage\[data-hand-stage="held"\] \.cardButton:not\(\.cardButtonSelected\)[^}]*(?:opacity:\s*0|transform:\s*translate3d\(var\(--deal-x\))/,
    );
    assert.doesNotMatch(styles, /\.tableStage\[data-hand-stage="deal"\] \.cardButton:nth-child\(2\)[^}]*animation-delay/);
    assert.doesNotMatch(styles, /\.tableStage\[data-hand-stage="deal"\] \.cardButton:nth-child\(3\)[^}]*animation-delay/);
    assert.doesNotMatch(styles, /@keyframes finaleReturnToDeck/);
    assert.match(styles, /@keyframes finaleCardsMerge/);
    assert.match(styles, /@keyframes finaleCardsHold/);
    assert.match(styles, /finaleCardGridHolding/);
    assert.match(styles, /data-finale-stage="assembling"/);
    assert.match(styles, /animation: finaleCardsHold var\(--bm-finale-enter-ms\)/);
    assert.match(styles, /animation: finaleCardsMerge var\(--bm-finale-card-merge-ms\)/);
    assert.match(
        styles,
        /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridMerging \.finaleCard\s*\{\s*animation: finaleCardsMerge/,
    );
    assert.doesNotMatch(styles, /\.finaleCardGridSettled/);
    assert.match(styles, /@keyframes finaleIllustrationPulse/);
    assert.match(styles, /@keyframes finaleIllustrationPulse[\s\S]*100%[\s\S]*opacity: 1/);
    assert.match(styles, /\.finaleCardGrid/);
    assert.match(styles, /\.specialCardStage/);
    assert.match(styles, /\.specialCardConfirmation/);
    assert.match(styles, /\.finaleHoldStatus/);
    assert.match(styles, /\.specialCard/);
    assert.match(styles, /@keyframes specialCardFlip/);
    assert.match(styles, /@keyframes specialCardIconFloat/);
    assert.match(styles, /\.inlineFinale/);
    assert.match(styles, /\.heroDeckPrompt \{[\s\S]*cursor: pointer/);
    assert.match(styles, /\.heroDeckPromptArrow[\s\S]*font-size: 1\.15rem/);
    assert.doesNotMatch(styles, /\.deckPrompt|\.deckPromptArrow/);
    assert.match(styles, /\.deckStage[\s\S]*bottom: 14px/);
    assert.match(styles, /\.deckStage \.(?:deckCard|deckBrandLogo)[\s\S]*cursor: pointer/);
    assert.match(styles, /\.deckStage:disabled,[\s\S]*\.deckStage:disabled \.deckBrandLogo[\s\S]*cursor: default/);
    assert.match(styles, /--deal-y: 106px/);
    assert.match(styles, /\.progressItemCurrent \.progressButton[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.progressRow \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
    assert.match(styles, /\.progressGroup \{[\s\S]*width: max-content/);
    assert.match(styles, /\.tablePrompt \{[\s\S]*font-size: clamp\(0\.9rem/);
    assert.match(styles, /\.promptWord \{[\s\S]*animation: promptWordMaterialize/);
    assert.match(styles, /\.promptTitle,[\s\S]*\.promptSubtitle \{[\s\S]*display: block/);
    assert.match(styles, /@keyframes promptWordMaterialize/);
    assert.match(styles, /@keyframes promptWordDissolve/);
    assert.match(styles, /\.tablePromptIntroHolding \{[\s\S]*animation: none/);
    assert.match(styles, /\.tablePromptIntroExit,[\s\S]*\.tablePromptExit/);
    assert.match(styles, /\.tablePromptIntro \.promptTitle,[\s\S]*\.tablePromptIntroHolding \.promptTitle,[\s\S]*\.tablePromptIntroExit \.promptTitle[\s\S]*font-weight: 400/);
    assert.match(styles, /\.progressItemCurrent \.progressButton strong \{[\s\S]*font-size: clamp\(1rem/);
    assert.doesNotMatch(styles, /\.tableStage\s*\{[^}]*border-top/);
    assert.match(styles, /\.progressButton \{[\s\S]*min-height: 44px/);
    assert.match(styles, /\.progressItem \{[\s\S]*display: grid[\s\S]*justify-items: stretch/);
    assert.match(styles, /\.progressButton \{[\s\S]*width: 100%/);
    assert.match(styles, /\.autoAdvance \{[\s\S]*width: 100%[\s\S]*height: 4px[\s\S]*margin-top: 8px/);
    assert.match(styles, /\.autoAdvance::after \{[\s\S]*background: var\(--bm-ink\)/);
    assert.match(styles, /animation: autoAdvanceProgress var\(--bm-auto-advance-ms\)/);
    assert.match(styles, /animation: cardLiftAndSettle var\(--bm-hand-reveal-ms\)/);
    assert.match(styles, /animation: deckStageDeal var\(--bm-hand-deal-ms\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="expand"\] \.tableSurface[\s\S]*height: var\(--bm-table-expand-height, 220px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="expand"\] \.cardGrid[\s\S]*visibility: hidden/);
    assert.match(styles, /transition: height var\(--bm-hand-expand-ms\)/);
    assert.match(styles, /@keyframes deckStageExpand[\s\S]*0%\s*\{[\s\S]*translateX\(-50%\) translateY\(-24px\)[\s\S]*100%\s*\{[\s\S]*translateX\(-50%\) translateY\(0\)/);
    assert.match(styles, /animation: deckStageCollect var\(--bm-hand-collect-ms\)/);
    assert.match(styles, /@keyframes finaleCardsMerge[\s\S]*0% \{[\s\S]*opacity: 1[\s\S]*translate3d\(0, 0, 0\)/);
    assert.doesNotMatch(styles, /\.brandLine|\.brandDivider|\.partnerName/);
    assert.match(styles, /cardIllustration svg > \*/);
    assert.match(styles, /\.cardBrandMark/);
    assert.doesNotMatch(styles, /\.actsStack|\.revealedStrip|\.reopenReading/);
    assert.match(experience, /<BrandMark/);
    assert.ok(experience.indexOf("className={styles.tableStage}") < experience.indexOf("${styles.progress}"));
    assert.match(experience, /aria-hidden=\{!isSelected\}/);
    assert.match(experience, /BeautyMovementCardIllustration/);
    assert.match(experience, /function renderSpecialCard/);
    assert.match(experience, /className=\{styles\.specialCardConfirmation\}/);
    assert.match(experience, /Garantir presente e confirmar presença/);
    assert.match(experience, /finaleCardGridMerging/);
    assert.match(experience, /Carta especial do benefício/);
    assert.doesNotMatch(experience, /aria-label="Cartas finais"/);
    assert.match(experience, /function drawStoryCardIllustration/);
    assert.match(experience, /drawStoryCardIllustration\(context, line\.cardId/);
    assert.match(experience, /createStoryBlob\(reading, initialState\.campaign\.partnerName\)/);
    assert.match(experience, /getStoryCanvasFont\("--font-brand-ui"/);
    assert.match(illustrations, /case "reward-reserved"/);
    assert.match(illustrations, /case "reward-procedure"/);
    assert.match(illustrations, /case "reward-discount"/);
    assert.match(illustrations, /case "reward-velocity"/);
    assert.doesNotMatch(experience, /Arial, sans-serif/);
    assert.match(illustrations, /beleza-presenca/);
    assert.match(illustrations, /celebracao-encontro/);
    assert.match(campaignStyles, /background: #fafafa/i);
    assert.doesNotMatch(campaignStyles, /Georgia|coral|plum|linear-gradient|#fffaf2/i);
    assert.doesNotMatch(experience, /confirmationStage|confirmationIntro|contactSummary|confirmationForm/);
    assert.doesNotMatch(styles, /confirmationStage|confirmationIntro|contactSummary|confirmationForm/);

    assert.match(header, /scrollAware\?: boolean/);
    assert.match(header, /data-scroll-aware-header/);
    assert.match(header, /HeaderScrollBehavior/);
    assert.match(headerScrollBehavior, /addEventListener\("scroll"/);
    assert.match(headerScrollBehavior, /addEventListener\("focusin"/);
    assert.match(headerScrollBehavior, /addEventListener\("keydown"/);
    assert.match(headerScrollBehavior, /revealHeader/);
    assert.match(headerScrollBehavior, /header--hidden/);
    assert.match(headerScrollBehavior, /requestAnimationFrame/);
    assert.match(globalStyles, /\.header\[data-scroll-aware-header="true"\]\.header--hidden/);
    assert.match(cards, /promptTitle: "O que merece mais presença no seu ritual\?"/);
    assert.match(cards, /promptSubtitle: "O gesto que faz você se reconhecer no agora\."/);
    assert.match(cards, /promptTitle: "O que sustenta o seu ritmo\?"/);
    assert.match(cards, /promptSubtitle: "A energia que transforma pequenos gestos em movimento\."/);
    assert.match(cards, /promptTitle: "O que você quer celebrar neste encontro\?"/);
    assert.match(cards, /promptSubtitle: "A presença, a conexão e o próximo ciclo\."/);
    assert.doesNotMatch(cards, /prompt: "[^"]*—/);
});
