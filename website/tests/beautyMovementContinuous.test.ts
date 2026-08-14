import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("continuous experience reuses the real shell and keeps the special-card finale flow", async () => {
    const [page, localPage, experience, styles, campaignStyles, illustrations, header, headerScrollBehavior, globalStyles, cards, brandMark] = await Promise.all([
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
        readFile(sourceUrl("src/components/BrandMark.tsx"), "utf8"),
    ]);

    for (const route of [page, localPage]) {
        assert.match(route, /import Header from "@\/components\/Header"/);
        assert.match(route, /<Header(?:\s+[^>]*)? \/>/);
        assert.match(route, /preferredUnitSlug="novo-hamburgo"/);
        assert.match(route, /fixedUnitSlug="novo-hamburgo"/);
        assert.match(route, /scrollAware/);
        assert.match(route, /<Footer \/>/);
    }

    assert.match(
        experience,
        /className=\{`\$\{styles\.tableStage\} \$\{waitingForInitialDeal \? "" : styles\.tableStageShifted\}`\.trim\(\)\}/,
    );
    assert.match(experience, /id="mesa-de-cartas"/);
    assert.match(experience, /data-hand-stage=\{handStage\}/);
    assert.match(experience, /const tableIsBusy =/);
    assert.match(experience, /aria-busy=\{tableIsBusy \|\| undefined\}/);
    assert.match(experience, /beauty_movement_act_view/);
    assert.match(experience, /requestAnimationFrame\(animate\)/);
    assert.match(experience, /scrollIntoView\(\{ behavior: "auto"/);
    assert.match(experience, /prefers-reduced-motion/);
    assert.match(experience, /import \{ BEAUTY_MOVEMENT_MOTION, createBeautyMovementMotionGate \}/);
    assert.match(experience, /AUTO_ADVANCE_SECONDS = BEAUTY_MOVEMENT_MOTION\.autoAdvanceMs \/ 1_000/);
    assert.match(experience, /const INITIAL_TABLE_HEIGHT = 112/);
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
    assert.match(experience, /if \(event\.currentTarget !== event\.target\) return/);
    assert.doesNotMatch(experience, /event\.animationName !== "cardLiftAndSettle"/);
    assert.match(experience, /handRevealFallbackMs/);
    assert.match(experience, /autoAdvanceActive/);
    assert.match(experience, /function beginFinale\(\)/);
    assert.match(experience, /function handleProgressClick\(index: number\)/);
    assert.match(experience, /revealInFlightRef/);
    assert.match(experience, /transitionInFlightRef/);
    assert.match(experience, /confirmInFlightRef/);
    assert.match(experience, /setCurrentFinaleStage\("collecting"\)/);
    assert.match(experience, /setCurrentFinaleStage\("merging"\)/);
    assert.doesNotMatch(experience, /FINALE_HOLD_SECONDS|finaleHoldRemaining|Leitura reunida|A carta especial se forma em seguida/);
    assert.match(experience, /setCurrentFinaleStage\("assembling"\)/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.finaleCardsEnterMs/);
    assert.match(experience, /BEAUTY_MOVEMENT_MOTION\.finaleMergeMs/);
    assert.match(experience, /renderConfirmationAction/);
    assert.doesNotMatch(experience, /inlineFinale|renderResultStage|Leitura completa|O seu presente de celebração/);
    assert.match(experience, /isSpecialCardModalOpen/);
    assert.match(experience, /specialCardReopenActionRef/);
    assert.match(experience, /automática em \{AUTO_ADVANCE_SECONDS\} segundos/);
    assert.doesNotMatch(experience, /confirmationTriggerRef/);
    assert.match(experience, /className=\{styles\.progressButton\}/);
    assert.match(experience, /disabled=\{!isCurrent \|\| Boolean\(progressMotion\)\}/);
    assert.match(experience, /onClick=\{\(\) => handleProgressClick\(index\)\}/);
    assert.match(experience, /className=\{styles\.progressCopy\}/);
    assert.match(experience, /className=\{styles\.progressTransfer\}/);
    assert.match(experience, /function measureProgressTransition\(fromIndex: number, toIndex: number\)/);
    assert.match(experience, /sourceItem\.classList\.remove\(styles\.progressItemCurrent\)/);
    assert.match(experience, /targetItem\.classList\.add\(styles\.progressItemCurrent\)/);
    assert.ok(experience.indexOf("measureProgressTransition(fromIndex, toIndex)") < experience.indexOf("setProgressMotion({ fromIndex"));
    const progressMarkup = experience.slice(experience.indexOf("className={styles.progressButton}"));
    assert.ok(progressMarkup.indexOf("styles.autoAdvance") < progressMarkup.indexOf("</button>"));
    assert.match(
        experience,
        /\{isCurrent && !progressMotion \? \(\s*<span\s+className=\{`\$\{styles\.autoAdvance\}/,
    );
    assert.match(experience, /const isAutoAdvanceVisible = isCurrent && !progressMotion && autoAdvanceActive/);
    assert.match(experience, /styles\.autoAdvanceVisible/);
    assert.match(experience, /aria-hidden=\{isAutoAdvanceVisible \? undefined : true\}/);
    const nextHandTransition = experience.slice(experience.indexOf("function moveToNextHand"));
    assert.match(nextHandTransition, /setCurrentHandStage\("prompt"\);\s*const progressMotionStarted = setCurrentActIndex\(nextIndex\)/);
    assert.match(nextHandTransition, /progressMotionStarted \? BEAUTY_MOVEMENT_MOTION\.progressTransitionMs : 0/);
    assert.ok(
        nextHandTransition.indexOf('setCurrentHandStage("prompt")') <
            nextHandTransition.indexOf("const progressMotionStarted = setCurrentActIndex(nextIndex)"),
    );
    assert.doesNotMatch(experience, /<\/ol>\s*\{autoAdvanceActive \? \(/);
    assert.doesNotMatch(experience, /className=\{styles\.progressCopy\}>\s*<small>/);
    assert.match(experience, /styles\.progressRowWaiting/);
    assert.match(experience, /className=\{styles\.progressGroup\}/);
    assert.match(experience, /styles\.heroDeckInstructionHidden/);
    assert.match(experience, /aria-hidden=\{waitingForInitialDeal \|\| undefined\}/);
    assert.match(experience, /\$\{styles\.tablePrompt\}/);
    assert.match(experience, /key=\{introStage !== "hidden" \? "experience-intro" : tableDefinition\.id\}/);
    assert.doesNotMatch(experience, /waitingForInitialDeal \? \(\s*<p/);
    assert.doesNotMatch(experience, /className=\{styles\.autoAdvanceLabel\}/);
    assert.doesNotMatch(experience, /className=\{styles\.autoAdvanceHint\}/);
    assert.doesNotMatch(experience, /className=\{styles\.brandLine\}/);
    assert.doesNotMatch(experience, /id="table-stage-title"/);
    assert.match(experience, /aria-label=\{tableDefinition\.label\}/);
    assert.match(experience, /const INITIAL_EXPERIENCE_TITLE = "3 anos\. 3 cartas\."/);
    assert.match(experience, /const INITIAL_EXPERIENCE_SUBTITLE = "Um novo movimento para celebrar tudo o que ainda vem pela frente\."/);
    assert.match(experience, /function getInitialExperienceCopy\(description\?: string \| null\)/);
    assert.match(experience, /initialExperienceCopy\.title/);
    assert.match(experience, /initialExperienceCopy\.subtitle/);
    assert.match(experience, /className=\{styles\.specialCardStage\}/);
    assert.match(experience, /styles\.specialCardStageReopen/);
    assert.match(experience, /className=\{styles\.specialCardModalOverlay\}/);
    assert.match(experience, /role="dialog"/);
    assert.match(experience, /aria-modal="true"/);
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
    assert.match(experience, /aria-label="Carta especial"/);
    assert.match(experience, /className=\{styles\.cardSparkles\}/);
    assert.match(experience, /className=\{styles\.deckStage\}/);
    assert.match(experience, /className=\{styles\.finaleSpecialCardTransform\}/);
    assert.match(experience, /function renderFinaleCard\(line: ReturnType<typeof getBeautyMovementReading>\[number\]\)/);
    assert.match(experience, /<BeautyMovementCardIllustration cardId=\{card\.id\} \/>/);
    assert.match(experience, /<strong>\{card\.title\}<\/strong>/);
    assert.match(experience, /<span className=\{styles\.finaleCardMessage\}>\{card\.shortMessage\}<\/span>/);
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
    assert.match(experience, /setTableExpansionHeight\(Math\.max\(INITIAL_TABLE_HEIGHT, surface\.scrollHeight\)\)/);
    assert.match(experience, /const \[tableIntroHeight, setTableIntroHeight\] = useState\(0\)/);
    assert.match(experience, /if \(introStage !== "entering" \|\| handStage !== "waiting"\) return;/);
    assert.match(experience, /surface\.dataset\.deckState !== "intro"/);
    assert.match(experience, /const deck = surface\.querySelector<HTMLElement>\(`\.\$\{styles\.deckStage\}`\)/);
    assert.match(experience, /const previousDisplay = deck\?\.style\.display/);
    assert.match(experience, /deck\.style\.display = "none"/);
    assert.match(experience, /setTableIntroHeight\(Math\.max\(INITIAL_TABLE_HEIGHT, Math\.ceil\(surface\.scrollHeight\)\)\)/);
    assert.match(experience, /getBoundingClientRect\(\)\.height/);
    assert.match(experience, /setTableExpansionHeight\(startHeight\)/);
    assert.match(experience, /const isInitialCategoryEntering =/);
    assert.match(experience, /styles\.progressItemEntering/);
    assert.match(experience, /const targetHeight = Math\.max\(\s*startHeight,/);
    assert.match(experience, /"held"/);
    assert.match(experience, /function startInitialDeal\(\)/);
    assert.match(experience, /function handleDeckKeyDown\(event: ReactKeyboardEvent<HTMLButtonElement>\)/);
    assert.match(experience, /event\.key !== "Enter" && event\.key !== " " && event\.key !== "Spacebar"/);
    assert.equal((experience.match(/onKeyDown=\{handleDeckKeyDown\}/g) ?? []).length, 1);
    const heroInstructionClass = experience.indexOf("styles.heroDeckInstruction");
    const heroInstructionMarkup = experience.slice(
        experience.lastIndexOf("<p", heroInstructionClass),
        experience.indexOf("</p>", heroInstructionClass) + "</p>".length,
    );
    assert.ok(heroInstructionClass >= 0);
    assert.match(heroInstructionMarkup, /<p\s+className=\{`\$\{styles\.heroDeckInstruction\} \$\{waitingForInitialDeal \? "" : styles\.heroDeckInstructionHidden\}`\.trim\(\)\}/);
    assert.match(heroInstructionMarkup, /aria-hidden=\{!waitingForInitialDeal \|\| undefined\}/);
    assert.doesNotMatch(heroInstructionMarkup, /<(?:button|a)\b|onClick=|onKeyDown=|tabIndex=|aria-label=/);
    assert.match(heroInstructionMarkup, /id="beauty-movement-deck-prompt"/);
    assert.equal((experience.match(/onClick=\{startInitialDeal\}/g) ?? []).length, 1);
    assert.match(experience, /Clique no baralho para começar a sua leitura/);
    assert.match(experience, /className=\{styles\.tableDeckPromptArrow\}/);
    assert.doesNotMatch(experience, /Clique no baralho <span aria-hidden="true">↗<\/span>/);
    assert.doesNotMatch(experience, /className=\{styles\.tableDeckPrompt\}/);
    assert.doesNotMatch(experience, /className=\{styles\.deckPrompt\}/);
    assert.ok(heroInstructionClass < experience.indexOf("className={styles.tableSurface}"));
    assert.ok(experience.indexOf("className={styles.tableSurface}") < experience.indexOf("className={styles.tableDeckPromptArrow}"));
    assert.ok(experience.indexOf("className={styles.tableDeckPromptArrow}") < experience.indexOf("className={styles.deckStage}"));
    assert.match(experience, /data-deck-state=\{/);
    assert.match(experience, /\? "intro"/);
    assert.match(experience, /\? "prompt"/);
    assert.match(experience, /finaleStage === "confirmation" \|\| finaleStage === "result"/);
    assert.match(experience, /const isCurrent =\s*finaleStage === "hidden" &&\s*introStage === "hidden" &&\s*!waitingForInitialDeal &&\s*index === displayedActIndex/);
    assert.match(experience, /const \[isSpecialCardModalOpen, setIsSpecialCardModalOpen\] = useState\(initialState\.confirmed\)/);
    assert.match(experience, /setIsSpecialCardModalOpen\(true\)/);
    assert.match(experience, /setIsSpecialCardModalOpen\(confirmed\)/);
    assert.match(experience, /function closeSpecialCardModal|const closeSpecialCardModal/);
    assert.match(experience, /Fechar carta especial/);
    assert.match(experience, /Clique aqui para revelar sua carta especial/);
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
    assert.match(experience, /role="dialog"/);
    assert.match(experience, /aria-modal="true"/);

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
    assert.doesNotMatch(styles, /@keyframes deckReceivePulse/);
    assert.match(styles, /@keyframes deckStageDeal/);
    assert.match(styles, /@keyframes deckStageExpand/);
    assert.match(styles, /@keyframes deckStageCollect/);
    assert.match(styles, /@keyframes deckStageReceive/);
    assert.match(styles, /@keyframes cardReturnToDeck/);
    assert.match(styles, /@keyframes cardSelectedReturnToDeck/);
    assert.match(styles, /@keyframes cardFlipToDeck/);
    assert.match(styles, /@keyframes cardDealFromDeck/);
    assert.match(styles, /\.cardButton \{[\s\S]*min-height: clamp\(312px, 27vw, 324px\)/);
    assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.cardButton \{\s*min-height: 312px;/);
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
        /\.tableStage\[data-hand-stage="reveal"\] \.deck(?:Stage|CardTop)\s*\{[^}]*animation:/,
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
    assert.match(styles, /@keyframes finaleCenterCardTransform/);
    assert.match(styles, /@keyframes finaleSpecialCardTransform/);
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
    assert.match(styles, /--finale-card-height: clamp\(280px, 25vw, 304px\)/);
    assert.match(styles, /\.finaleCardMessage/);
    assert.match(styles, /\.finaleSpecialCardTransform \{/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \{[\s\S]*overflow: visible;/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.tableSurface \{[\s\S]*overflow: visible;/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.finaleCardGridMerging \{[\s\S]*z-index: 4;[\s\S]*overflow: visible;/);
    assert.match(styles, /\.tableStage\[data-hand-stage="finale"\] \.deckStage[\s\S]*pointer-events: none/);
    assert.match(styles, /\.tableStage\[data-finale-stage="confirmation"\] \.deckStage,[\s\S]*visibility: hidden/);
    assert.match(styles, /\.specialCardStage/);
    assert.match(styles, /\.specialCardConfirmation/);
    assert.match(styles, /\.specialCardRevealAction/);
    assert.doesNotMatch(styles, /\.specialCardPrompt|\.finaleHoldStatus/);
    assert.match(styles, /\.specialCard/);
    assert.match(styles, /@keyframes specialCardFlip/);
    assert.match(styles, /@keyframes specialCardIconFloat/);
    assert.doesNotMatch(styles, /\.inlineFinale|\.resultStage|\.invitationPanel|\.benefitPanel|\.resultActions/);
    const heroInstructionStyles = styles.slice(
        styles.indexOf(".heroDeckInstruction {"),
        styles.indexOf(".tableDeckPromptArrow {"),
    );
    assert.match(heroInstructionStyles, /display: block[\s\S]*font-family: var\(--font-brand-text\)/);
    assert.match(styles, /\.heroDeckInstructionHidden \{\s*visibility: hidden;/);
    assert.match(styles, /\.progressRow \{[\s\S]*min-height: 52px;[\s\S]*align-items: flex-start;/);
    assert.doesNotMatch(heroInstructionStyles, /cursor: pointer|:hover|:focus-visible|appearance:|background:/);
    assert.match(styles, /\.tableDeckPromptArrow \{[\s\S]*position: absolute[\s\S]*bottom: calc\(32px \+ 106px \+ 8px\)[\s\S]*font-size: 1\.35rem/);
    assert.match(styles, /\.tableSurface \{[\s\S]*padding: clamp\(10px, 1\.5vw, 16px\) clamp\(10px, 1\.4vw, 16px\) clamp\(32px, 3vw, 44px\)/);
    assert.match(styles, /\.tableSurface\[data-deck-state="waiting"\] \{[\s\S]*height: 0[\s\S]*min-height: 0[\s\S]*padding: 0[\s\S]*border-color: transparent[\s\S]*background: transparent[\s\S]*box-shadow: none[\s\S]*overflow: visible/);
    assert.match(styles, /\.tableSurface\[data-deck-state="intro"\] \{[\s\S]*height: var\(--bm-table-intro-height, 0px\)[\s\S]*transition: height var\(--bm-hand-expand-ms\)/);
    assert.match(
        styles,
        /\.tableSurface\[data-deck-state="intro"\],[\s\S]*\.tableSurface\[data-deck-state="prompt"\] \{[\s\S]*padding-bottom: clamp\(10px, 1\.5vw, 16px\)[\s\S]*overflow: visible/,
    );
    assert.match(styles, /\.tableSurface\[data-deck-state="prompt"\] \{[\s\S]*min-height: 112px/);
    assert.match(styles, /\.tableSurface\[data-deck-state="waiting"\] \.deckStage,[\s\S]*\.tableSurface\[data-deck-state="intro"\] \.deckStage,[\s\S]*\.tableSurface\[data-deck-state="prompt"\] \.deckStage,[\s\S]*\.tableSurface\[data-deck-state="expanding"\] \.deckStage,[\s\S]*\.tableSurface\[data-deck-state="ready"\] \.deckStage[\s\S]*bottom: -79px/);
    assert.match(styles, /\.tableSurface\[data-deck-state="waiting"\] \.tableDeckPromptArrow \{[\s\S]*bottom: 35px/);
    assert.match(styles, /\.tableStage\[data-finale-stage="hidden"\] \{[\s\S]*padding-bottom: clamp\(86px, 9vw, 96px\)/);
    assert.match(styles, /@keyframes deckPromptArrowFloat/);
    assert.match(styles, /\.progressRowWaiting \{[\s\S]*min-height: 52px/);
    assert.match(styles, /\.progressRowWaiting \.progressGroup \{[\s\S]*visibility: hidden[\s\S]*pointer-events: none/);
    assert.match(styles, /\.tableStageShifted \{[\s\S]*?transform: translateY\(-38px\);/);
    assert.doesNotMatch(styles, /\.initialDeckPrompt/);
    assert.match(styles, /\.heroDeckInstruction/);
    assert.doesNotMatch(styles, /\.tableDeckPrompt \{|\.deckPrompt \{|\.deckPromptArrow \{/);
    assert.doesNotMatch(styles, /\.actAdvance|\.advanceNote|\.continueButton|@keyframes finaleCardsReappear/);
    assert.match(styles, /\.deckStage[\s\S]*bottom: 32px/);
    assert.match(styles, /\.deckStage \.(?:deckCard|deckBrandLogo)[\s\S]*cursor: pointer/);
    assert.match(styles, /\.deckStage:disabled,[\s\S]*\.deckStage:disabled \.deckBrandLogo[\s\S]*cursor: default/);
    assert.match(styles, /--deal-y: 106px/);
    assert.match(styles, /\.progressItemCurrent \.progressButton[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.progressRow \{[\s\S]*display: flex[\s\S]*justify-content: center/);
    assert.match(styles, /\.progressRow \{[\s\S]*min-height: 38px/);
    assert.match(styles, /\.progressGroup \{[\s\S]*width: max-content/);
    assert.match(styles, /\.tablePrompt \{[\s\S]*font-size: clamp\(0\.9rem/);
    assert.match(styles, /\.tablePrompt \{[\s\S]*padding: 0;[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
    assert.match(styles, /\.specialCardStage \{[\s\S]*gap: 0;/);
    assert.match(styles, /\.specialCardStageReopen \{[\s\S]*min-height: 430px/);
    assert.doesNotMatch(styles, /\.specialCardReopenCard/);
    assert.match(styles, /\.specialCardModalOverlay \{[\s\S]*--bm-ink: #303030[\s\S]*position: fixed[\s\S]*backdrop-filter: blur\(10px\)/);
    assert.match(styles, /\.specialCardModalDialog \{[\s\S]*place-items: center/);
    assert.match(styles, /\.specialCardModalClose \{[\s\S]*position: absolute/);
    assert.match(styles, /@keyframes specialCardModalBackdropEnter/);
    assert.match(styles, /\.specialCardRevealAction \{[\s\S]*gap: 7px;[\s\S]*width: min\(100%, 282px\)/);
    assert.match(styles, /\.specialCardBackWithAction \{[\s\S]*justify-content: flex-start[\s\S]*padding: 32px 24px 20px/);
    assert.match(styles, /\.specialCardWhatsappAction \{[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.promptWord \{[\s\S]*animation: promptWordMaterialize/);
    assert.match(styles, /\.promptTitle,[\s\S]*\.promptSubtitle \{[\s\S]*display: block/);
    assert.match(styles, /@keyframes promptWordMaterialize/);
    assert.match(styles, /@keyframes promptWordDissolve/);
    assert.match(styles, /\.tablePromptIntroHolding \{[\s\S]*animation: none/);
    assert.match(styles, /\.tablePromptIntroExit,[\s\S]*\.tablePromptExit/);
    assert.doesNotMatch(styles, /\.tablePromptIntro \.promptTitle,[\s\S]*font-weight: 400/);
    assert.match(styles, /\.progressItemCurrent \.progressButton strong \{[\s\S]*font-size: clamp\(1rem/);
    assert.doesNotMatch(styles, /\.tableStage\s*\{[^}]*border-top/);
    assert.match(styles, /\.progressButton \{[\s\S]*min-height: 38px/);
    assert.match(styles, /\.progressButton \{[\s\S]*width: 100%/);
    assert.match(styles, /\.progressItemCurrent \.progressButton \{[\s\S]*grid-template-rows: 25px 5px[\s\S]*height: 38px[\s\S]*min-height: 38px[\s\S]*padding: 4px 14px 1px/);
    assert.match(styles, /\.autoAdvance \{[\s\S]*width: 100%[\s\S]*height: 4px[\s\S]*margin-top: 1px/);
    assert.match(styles, /\.autoAdvance \{[\s\S]*visibility: hidden/);
    assert.match(styles, /\.autoAdvanceVisible \{[\s\S]*visibility: visible/);
    assert.match(styles, /\.autoAdvance::after \{[\s\S]*animation: none/);
    assert.match(styles, /\.autoAdvanceVisible::after \{[\s\S]*animation: autoAdvanceProgress var\(--bm-auto-advance-ms\) linear both/);
    assert.match(styles, /\.progressTransfer \{[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.progressMotionActive \.progressButton \{[\s\S]*background: transparent !important/);
    assert.match(styles, /@keyframes progressButtonCollapse[\s\S]*background: transparent/);
    assert.match(styles, /@keyframes progressButtonExpand[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.progressItemEntering \.progressButton[\s\S]*animation: progressButtonEnter var\(--bm-progress-enter-ms\)/);
    assert.match(styles, /\.progressItemEntering strong[\s\S]*animation: progressLabelEnter var\(--bm-progress-enter-ms\)/);
    assert.match(styles, /@keyframes progressButtonEnter/);
    assert.match(styles, /@keyframes progressLabelEnter/);
    assert.match(styles, /\.progressTransfer \{[\s\S]*animation: progressHighlightTransfer var\(--bm-progress-total-ms\)/);
    assert.match(styles, /@keyframes progressHighlightTransfer[\s\S]*calc\(var\(--progress-to-left\) \+ var\(--progress-to-width\) - var\(--progress-from-left\)\)/);
    assert.match(styles, /\.autoAdvance::after \{[\s\S]*background: var\(--bm-ink\)/);
    assert.match(styles, /animation: cardLiftAndSettle var\(--bm-hand-reveal-ms\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="reveal"\] \.cardButtonSelected,\s*\.tableStage\[data-hand-stage="reveal"\] \.cardButtonSelected \.cardInner/);
    assert.match(styles, /animation: deckStageDeal var\(--bm-hand-deal-ms\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="expand"\] \.tableSurface[\s\S]*height: var\(--bm-table-expand-height, 112px\)/);
    assert.match(styles, /\.tableStage\[data-hand-stage="expand"\] \.tableSurface[\s\S]*overflow: visible/);
    assert.match(styles, /\.tableStage\[data-hand-stage="expand"\] \.cardGrid[\s\S]*visibility: hidden/);
    assert.match(styles, /transition: height var\(--bm-hand-expand-ms\) cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
    assert.match(styles, /@keyframes deckStageExpand[\s\S]*0%\s*\{[\s\S]*translateX\(-50%\) translateY\(0\) scale\(0\.985\)[\s\S]*100%\s*\{[\s\S]*translateX\(-50%\) translateY\(0\)/);
    assert.match(styles, /@keyframes deckStageDeal[\s\S]*50%\s*\{[\s\S]*translateX\(-50%\) translateY\(2px\) scale\(0\.995\)/);
    assert.doesNotMatch(styles, /@keyframes deckStageExpand[\s\S]*translateY\(-24px\)/);
    assert.doesNotMatch(styles, /@keyframes deckStageDeal[\s\S]*translateY\(8px\)/);
    assert.match(styles, /animation: deckStageCollect var\(--bm-hand-collect-ms\)/);
    assert.match(styles, /@keyframes finaleCardsMerge[\s\S]*0% \{[\s\S]*opacity: 1[\s\S]*translate3d\(0, 0, 0\)/);
    assert.doesNotMatch(styles, /\.brandLine|\.brandDivider|\.partnerName/);
    assert.match(styles, /cardIllustration svg > \*/);
    assert.match(styles, /\.cardBrandMark/);
    assert.doesNotMatch(styles, /\.actsStack|\.revealedStrip|\.reopenReading/);
    assert.match(experience, /<BrandMark/);
    assert.match(brandMark, /loading=\{loading\}/);
    assert.match(experience, /<BrandMark className=\{styles\.cardBrandLogo\} loading="eager"/);
    assert.ok(experience.indexOf("className={styles.tableStage}") < experience.indexOf("${styles.progress}"));
    assert.match(experience, /aria-hidden=\{!isSelected\}/);
    assert.match(experience, /BeautyMovementCardIllustration/);
    assert.match(experience, /function renderSpecialCard/);
    assert.match(experience, /type SpecialCardAction = "none" \| "confirm" \| "reopen"/);
    assert.match(experience, /function renderSpecialCard\(revealed: boolean, action: SpecialCardAction = "none"\)/);
    assert.match(experience, /className=\{styles\.specialCardRevealAction\}/);
    assert.match(experience, /Garantir presente e confirmar presença/);
    assert.match(experience, /if \(!operationalConsent && !isLocalPreview\) return;/);
    assert.doesNotMatch(experience, /Confirme sua entrada para revelar a sua carta especial/);
    assert.doesNotMatch(experience, /Sua aula será confirmada pela equipe da unidade após o contato/);
    assert.match(experience, /Seu movimento também faz parte da celebração/);
    assert.match(experience, /styles\.specialCardWhatsappAction/);
    assert.match(experience, /finaleStage === "confirmation" \?/);
    assert.match(experience, /!isLocalPreview \? renderConfirmationAction\(\) : null/);
    assert.match(experience, /renderSpecialCard\(false, isLocalPreview \? "confirm" : "none"\)/);
    assert.match(experience, /renderSpecialCard\(false, "reopen"\)/);
    assert.doesNotMatch(experience, /specialCardPrompt|Sua carta especial está pronta\./);
    assert.match(experience, /Clique aqui para revelar sua carta especial/);
    assert.match(experience, /finaleCardGridMerging/);
    assert.match(experience, /Carta especial do benefício/);
    assert.match(experience, /ref=\{action === "reopen" \? specialCardReopenActionRef : undefined\}/);
    assert.match(experience, /onClick=\{action === "confirm" \? \(\) => void handleConfirm\(\) : openSpecialCardModal\}/);
    assert.doesNotMatch(experience, /role=\{interactive \? "button" : undefined\}/);
    assert.doesNotMatch(experience, /aria-label="Cartas finais"/);
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
