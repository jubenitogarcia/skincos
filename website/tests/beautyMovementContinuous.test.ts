import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("continuous experience reuses the real shell and keeps the inline finale flow", async () => {
    const [page, localPage, experience, styles, campaignStyles, illustrations] = await Promise.all([
        readFile(sourceUrl("src/app/beleza-em-movimento/page.tsx"), "utf8"),
        readFile(sourceUrl("src/app/beleza-em-movimento/local-preview/page.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementCampaign.module.css"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementCardIllustration.tsx"), "utf8"),
    ]);

    for (const route of [page, localPage]) {
        assert.match(route, /import Header from "@\/components\/Header"/);
        assert.match(route, /<Header(?:\s+[^>]*)? \/>/);
        assert.match(route, /preferredUnitSlug="novo-hamburgo"/);
        assert.match(route, /fixedUnitSlug="novo-hamburgo"/);
        assert.match(route, /<Footer \/>/);
    }

    assert.match(experience, /className=\{styles\.tableStage\}/);
    assert.match(experience, /id="mesa-de-cartas"/);
    assert.match(experience, /data-hand-stage=\{handStage\}/);
    assert.match(experience, /beauty_movement_act_view/);
    assert.match(experience, /requestAnimationFrame\(animate\)/);
    assert.match(experience, /scrollIntoView\(\{ behavior: "auto"/);
    assert.match(experience, /prefers-reduced-motion/);
    assert.match(experience, /AUTO_ADVANCE_SECONDS = 5/);
    assert.match(experience, /function motionDuration\(durationMs: number\)/);
    assert.match(experience, /if \(prefersReducedMotion\(\)\) return;/);
    assert.match(experience, /HAND_REVEAL_MS = 1350/);
    assert.match(experience, /autoAdvanceActive/);
    assert.match(experience, /function beginFinale\(\)/);
    assert.match(experience, /revealInFlightRef/);
    assert.match(experience, /transitionInFlightRef/);
    assert.match(experience, /confirmInFlightRef/);
    assert.match(experience, /setCurrentFinaleStage\("collecting"\)/);
    assert.match(experience, /HAND_FINALE_MS = 1120/);
    assert.match(experience, /className=\{styles\.inlineFinale\}/);
    assert.match(experience, /renderConfirmationStage/);
    assert.match(experience, /renderResultStage/);
    assert.match(experience, /automática em \{AUTO_ADVANCE_SECONDS\} segundos/);
    assert.doesNotMatch(experience, /confirmationTriggerRef/);
    assert.match(experience, /className=\{styles\.progressButton\}/);
    assert.match(experience, /disabled=\{!isCurrent\}/);
    assert.match(experience, /className=\{styles\.progressCopy\}/);
    assert.match(experience, /role="group" aria-label="Cartas finais"/);
    assert.match(experience, /role="group" aria-label=\{`Cartas da etapa \$\{tableDefinition\.label\}`\}/);
    assert.doesNotMatch(experience, /role="list" aria-label="Cartas finais"/);
    assert.doesNotMatch(experience, /className=\{styles\.progressNumber\}/);
    assert.match(experience, /scrollToTable/);
    assert.doesNotMatch(experience, /preparedNote/);
    assert.doesNotMatch(experience, /choiceInstruction/);
    assert.match(experience, /Continuar para confirmar/);
    assert.match(experience, /disabled=\{handStage !== "held"\}/);
    assert.match(experience, /Seu presente de celebração/);
    assert.match(experience, /Seu presente será revelado após a confirmação/);
    assert.doesNotMatch(experience, /benefitPreview/);
    assert.doesNotMatch(experience, /Ver minha leitura/);
    assert.doesNotMatch(experience, /actsStack|revealedStrip/);
    assert.doesNotMatch(experience, /BeautyMovementModalReading/);
    assert.match(experience, /finaleCardGridSettled/);
    assert.match(experience, /aria-label="Cartas finais"/);
    assert.match(experience, /className=\{styles\.cardSparkles\}/);
    assert.match(experience, /className=\{styles\.deckStage\}/);
    assert.match(experience, /type HandStage = "waiting"/);
    assert.match(experience, /"held"/);
    assert.match(experience, /function startInitialDeal\(\)/);
    assert.match(experience, /function handleDeckKeyDown\(event: ReactKeyboardEvent<HTMLButtonElement>\)/);
    assert.match(experience, /event\.key !== "Enter" && event\.key !== " " && event\.key !== "Spacebar"/);
    assert.match(experience, /onKeyDown=\{handleDeckKeyDown\}/);
    assert.match(experience, /className=\{styles\.deckPrompt\}/);
    assert.match(experience, /role="note"/);
    assert.doesNotMatch(experience, /<button\s+className=\{styles\.deckPrompt\}/);
    assert.match(experience, /data-deck-state=\{/);
    assert.match(experience, /finaleStage === "confirmation" \|\| finaleStage === "result"/);
    assert.match(experience, /const isCurrent = index === displayedActIndex/);
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
    assert.match(styles, /@keyframes finaleReturnToDeck/);
    assert.match(styles, /@keyframes finaleCardsReappear/);
    assert.match(styles, /@keyframes finaleIllustrationPulse/);
    assert.match(styles, /@keyframes finaleIllustrationPulse[\s\S]*100%[\s\S]*opacity: 1/);
    assert.match(styles, /\.finaleCardGrid/);
    assert.match(styles, /\.finaleCardGridSettled/);
    assert.match(styles, /\.inlineFinale/);
    assert.match(styles, /\.deckPrompt/);
    assert.match(styles, /\.deckStage[\s\S]*bottom: 18px/);
    assert.match(styles, /--deal-y: 122px/);
    assert.match(styles, /\.progressItemCurrent \.progressButton[\s\S]*background: var\(--bm-yellow\)/);
    assert.match(styles, /\.progressButton \{[\s\S]*min-height: 44px/);
    assert.match(styles, /cardIllustration svg > \*/);
    assert.match(styles, /\.cardBrandMark/);
    assert.doesNotMatch(styles, /\.actsStack|\.revealedStrip|\.reopenReading/);
    assert.match(experience, /<BrandMark/);
    assert.match(experience, /aria-hidden=\{!isSelected\}/);
    assert.match(experience, /BeautyMovementCardIllustration/);
    assert.match(experience, /function drawStoryCardIllustration/);
    assert.match(experience, /drawStoryCardIllustration\(context, line\.cardId/);
    assert.match(experience, /getStoryCanvasFont\("--font-brand-ui"/);
    assert.doesNotMatch(experience, /Arial, sans-serif/);
    assert.match(illustrations, /beleza-presenca/);
    assert.match(illustrations, /celebracao-encontro/);
    assert.match(campaignStyles, /background: #fafafa/i);
    assert.doesNotMatch(campaignStyles, /Georgia|coral|plum|linear-gradient|#fffaf2/i);
});
