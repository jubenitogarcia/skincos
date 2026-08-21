import {
    BEAUTY_MOVEMENT_ACTS,
    getBeautyMovementCard,
    getBeautyMovementCardsForAct,
    type BeautyMovementAct,
    type BeautyMovementCard,
    type BeautyMovementPalette,
    type BeautyMovementSelections,
} from "@/lib/beautyMovementCards";


/**
 * Protocol version for the card-to-offer contract. Bump this when the
 * commercial catalog, affinity table, scoring or tie-break rule changes.
 */
export const BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION = "beauty-movement-outcomes-v1" as const;
export const BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION = "beauty-movement-outcomes-v2" as const;
export const BEAUTY_MOVEMENT_SUPPORTED_OUTCOME_PROTOCOL_VERSIONS = [
    BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION,
    BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION,
] as const;

export const BEAUTY_MOVEMENT_OUTCOME_KEYS = [
    "elleva_upgrade",
    "filler_double",
    "sculptra_classic_unlock",
    "skinbooster_diamond_unlock",
] as const;

export type BeautyMovementOutcomeKey = (typeof BEAUTY_MOVEMENT_OUTCOME_KEYS)[number];

export type BeautyMovementOfferProduct = {
    productId: string;
    productName: string;
    quantity: number;
    unit: "mg" | "mL" | "condition";
};

export type BeautyMovementOfferPrice = {
    amount: number;
    currency: "BRL";
};

export type BeautyMovementOffer = {
    outcomeKey: BeautyMovementOutcomeKey;
    title: string;
    shortLabel: string;
    trigger: BeautyMovementOfferProduct;
    benefit: BeautyMovementOfferProduct;
    referencePrice: BeautyMovementOfferPrice | null;
    unlockedPrice: BeautyMovementOfferPrice | null;
    commercialText: string;
    externalRules: readonly string[];
};

export type BeautyMovementOutcomeScore = {
    outcomeKey: BeautyMovementOutcomeKey;
    score: number;
};

export type BeautyMovementResolvedOutcome = {
    protocolVersion: typeof BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION;
    palette: BeautyMovementPalette;
    selections: Readonly<Record<BeautyMovementAct, string>>;
    cards: readonly BeautyMovementCard[];
    scores: readonly BeautyMovementOutcomeScore[];
    outcomeKey: BeautyMovementOutcomeKey;
    offer: BeautyMovementOffer;
    rationale: string;
};

export type BeautyMovementCombination = {
    palette: BeautyMovementPalette;
    selections: Readonly<Record<BeautyMovementAct, string>>;
    cards: readonly BeautyMovementCard[];
    scores: readonly BeautyMovementOutcomeScore[];
    outcomeKey: BeautyMovementOutcomeKey;
    rationale: string;
};

const outcome = (key: BeautyMovementOutcomeKey): BeautyMovementOffer => {
    const commonRules = [
        "Oferta sujeita à disponibilidade e às condições comerciais da unidade.",
        "A elegibilidade clínica depende de avaliação profissional.",
    ] as const;
    const offers: Record<BeautyMovementOutcomeKey, BeautyMovementOffer> = {
        elleva_upgrade: {
            outcomeKey: key,
            title: "Firmeza & Renovação",
            shortLabel: "Elleva",
            trigger: { productId: "elleva-150-mg", productName: "Elleva 150 mg", quantity: 1, unit: "mg" },
            benefit: { productId: "elleva-210-mg", productName: "Elleva 210 mg", quantity: 1, unit: "mg" },
            referencePrice: null,
            unlockedPrice: null,
            commercialText: "Sua combinação desbloqueou Elleva 210 mg pelo valor do Elleva 150 mg.",
            externalRules: commonRules,
        },
        filler_double: {
            outcomeKey: key,
            title: "Harmonia & Definição",
            shortLabel: "Preenchimento",
            trigger: { productId: "filler", productName: "Preenchimento", quantity: 2, unit: "mL" },
            benefit: { productId: "filler", productName: "Preenchimento", quantity: 4, unit: "mL" },
            referencePrice: null,
            unlockedPrice: null,
            commercialText: "Sua combinação desbloqueou 2 mL de preenchimento e você recebe 4 mL.",
            externalRules: commonRules,
        },
        sculptra_classic_unlock: {
            outcomeKey: key,
            title: "Estrutura & Estímulo",
            shortLabel: "Restylane Classic + Sculptra",
            trigger: { productId: "restylane-classic", productName: "Restylane Classic", quantity: 1, unit: "mL" },
            benefit: { productId: "sculptra", productName: "Sculptra", quantity: 1, unit: "condition" },
            referencePrice: { amount: 2899, currency: "BRL" },
            unlockedPrice: { amount: 1699, currency: "BRL" },
            commercialText: "Sua combinação desbloqueou Sculptra por R$ 1.699 ao adquirir 1 mL de Restylane Classic (referência R$ 2.899).",
            externalRules: commonRules,
        },
        skinbooster_diamond_unlock: {
            outcomeKey: key,
            title: "Hidratação & Luminosidade",
            shortLabel: "Skinbooster + Diamond",
            trigger: { productId: "restylane-skinbooster", productName: "Restylane Skinbooster", quantity: 1, unit: "mL" },
            benefit: { productId: "diamond", productName: "Diamond", quantity: 1, unit: "condition" },
            referencePrice: { amount: 2099, currency: "BRL" },
            unlockedPrice: { amount: 899, currency: "BRL" },
            commercialText: "Sua combinação desbloqueou Diamond por R$ 899 ao adquirir 1 mL de Restylane Skinbooster (referência R$ 2.099).",
            externalRules: commonRules,
        },
    };
    return offers[key];
};

export const BEAUTY_MOVEMENT_OFFERS: Readonly<Record<BeautyMovementOutcomeKey, BeautyMovementOffer>> =
    Object.fromEntries(BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => [key, outcome(key)])) as Record<BeautyMovementOutcomeKey, BeautyMovementOffer>;

type AffinityVector = Readonly<Record<BeautyMovementOutcomeKey, number>>;

/**
 * Every card in the current catalog is listed explicitly. A future card that
 * is added to beautyMovementCards.ts without an affinity is rejected by the
 * resolver instead of silently biasing a commercial result.
 */
export const BEAUTY_MOVEMENT_CARD_AFFINITIES: Readonly<Record<string, AffinityVector>> = {
    "beleza-presenca": { elleva_upgrade: 0, filler_double: 4, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 1 },
    "beleza-autocuidado": { elleva_upgrade: 1, filler_double: 0, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 4 },
    "beleza-radiancia": { elleva_upgrade: 0, filler_double: 1, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 4 },
    "beleza-autoria": { elleva_upgrade: 0, filler_double: 1, sculptra_classic_unlock: 4, skinbooster_diamond_unlock: 0 },
    "beleza-harmonia": { elleva_upgrade: 1, filler_double: 4, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 0 },
    "movimento-constancia": { elleva_upgrade: 4, filler_double: 0, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 1 },
    "movimento-potencia": { elleva_upgrade: 1, filler_double: 0, sculptra_classic_unlock: 4, skinbooster_diamond_unlock: 0 },
    "movimento-leveza": { elleva_upgrade: 0, filler_double: 1, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 3 },
    "movimento-ritmo": { elleva_upgrade: 1, filler_double: 0, sculptra_classic_unlock: 4, skinbooster_diamond_unlock: 0 },
    "movimento-sintonia": { elleva_upgrade: 1, filler_double: 3, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 0 },
    "celebracao-confianca": { elleva_upgrade: 1, filler_double: 3, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 0 },
    "celebracao-renovacao": { elleva_upgrade: 4, filler_double: 0, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 1 },
    "celebracao-brilho": { elleva_upgrade: 0, filler_double: 1, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 4 },
    "celebracao-impulso": { elleva_upgrade: 1, filler_double: 0, sculptra_classic_unlock: 4, skinbooster_diamond_unlock: 0 },
    "celebracao-encontro": { elleva_upgrade: 0, filler_double: 3, sculptra_classic_unlock: 0, skinbooster_diamond_unlock: 1 },
};

type Synergy = {
    outcomeKey: BeautyMovementOutcomeKey;
    cards: readonly [string, string];
    bonus: number;
};

export const BEAUTY_MOVEMENT_SYNERGIES: readonly Synergy[] = [
    { outcomeKey: "elleva_upgrade", cards: ["movimento-constancia", "celebracao-renovacao"], bonus: 3 },
    // Potência + Renovação tells a clearer firmness/renewal story than a
    // near-tie between Elleva and the luminosity archetype.
    { outcomeKey: "elleva_upgrade", cards: ["movimento-potencia", "celebracao-renovacao"], bonus: 2 },
    // Radiância + Confiança is the strongest editorial bridge to luminosity;
    // keep it explicit so a tie never falls to the generic tie-break order.
    { outcomeKey: "skinbooster_diamond_unlock", cards: ["beleza-radiancia", "celebracao-confianca"], bonus: 2 },
    // Presence becomes a luminosity story when the final card is Brilho; this
    // resolves the only three-way visual/relational tie without using palette.
    { outcomeKey: "skinbooster_diamond_unlock", cards: ["beleza-presenca", "celebracao-brilho"], bonus: 2 },
    // Autoria + Constância describes a self-authored, sustained ritual; it
    // should not lose to a one-point filler/structure tie.
    { outcomeKey: "elleva_upgrade", cards: ["beleza-autoria", "movimento-constancia"], bonus: 2 },
    // Self-care with Potência is the small bridge to Structure & Stimulus;
    // stronger Brilho or Renovação signals still win their own archetypes.
    { outcomeKey: "sculptra_classic_unlock", cards: ["beleza-autocuidado", "movimento-potencia"], bonus: 2 },
    // Autocuidado + Ritmo carries the same sustained-stimulus story without
    // requiring the celebration card to be Impulso.
    { outcomeKey: "sculptra_classic_unlock", cards: ["beleza-autocuidado", "movimento-ritmo"], bonus: 1 },
    { outcomeKey: "filler_double", cards: ["beleza-presenca", "movimento-sintonia"], bonus: 2 },
    { outcomeKey: "filler_double", cards: ["beleza-harmonia", "celebracao-encontro"], bonus: 2 },
    { outcomeKey: "sculptra_classic_unlock", cards: ["beleza-autoria", "movimento-potencia"], bonus: 3 },
    { outcomeKey: "sculptra_classic_unlock", cards: ["movimento-ritmo", "celebracao-impulso"], bonus: 3 },
    { outcomeKey: "skinbooster_diamond_unlock", cards: ["beleza-autocuidado", "celebracao-brilho"], bonus: 3 },
    { outcomeKey: "skinbooster_diamond_unlock", cards: ["beleza-radiancia", "movimento-leveza"], bonus: 2 },
    { outcomeKey: "skinbooster_diamond_unlock", cards: ["beleza-autocuidado", "movimento-constancia"], bonus: 2 },
] as const;

const TIE_BREAK_ORDER: readonly BeautyMovementOutcomeKey[] = [
    "elleva_upgrade",
    "filler_double",
    "sculptra_classic_unlock",
    "skinbooster_diamond_unlock",
] as const;

function getMatchedSynergies(
    cards: readonly BeautyMovementCard[],
    outcomeKey: BeautyMovementOutcomeKey,
): readonly Synergy[] {
    const cardIds = new Set(cards.map((card) => card.id));
    return BEAUTY_MOVEMENT_SYNERGIES.filter(
        (synergy) => synergy.outcomeKey === outcomeKey && cardIds.has(synergy.cards[0]) && cardIds.has(synergy.cards[1]),
    );
}

function joinCardTitles(titles: readonly string[]): string {
    if (titles.length <= 1) return titles[0] ?? "as cartas escolhidas";
    if (titles.length === 2) return `${titles[0]} e ${titles[1]}`;
    return `${titles.slice(0, -1).join(", ")} e ${titles[titles.length - 1]}`;
}

export function explainBeautyMovementOutcome(resolved: Pick<BeautyMovementResolvedOutcome, "cards" | "scores" | "outcomeKey" | "offer">): string {
    const winner = resolved.scores.find((score) => score.outcomeKey === resolved.outcomeKey)!;
    const tied = resolved.scores.filter((score) => score.score === winner.score);
    const affinitySignals = resolved.cards
        .map((card) => ({ card, score: BEAUTY_MOVEMENT_CARD_AFFINITIES[card.id]![resolved.outcomeKey] }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.card.title.localeCompare(right.card.title, "pt-BR"));
    const signalTitles = affinitySignals.slice(0, 2).map((entry) => entry.card.title);
    const matched = getMatchedSynergies(resolved.cards, resolved.outcomeKey);

    if (tied.length > 1) {
        const tiedTitles = tied.map((score) => BEAUTY_MOVEMENT_OFFERS[score.outcomeKey].title);
        return `Empate entre ${joinCardTitles(tiedTitles)}; ${resolved.offer.title} vence pela ordem de desempate estável, apoiado por ${joinCardTitles(signalTitles)}.`;
    }
    if (matched.length > 0) {
        const synergyTitles = matched[0]!.cards.map((cardId) => resolved.cards.find((card) => card.id === cardId)?.title ?? cardId);
        return `${joinCardTitles(synergyTitles)} reforçam ${resolved.offer.title}; as demais afinidades mantêm a leitura coerente.`;
    }
    return `${joinCardTitles(signalTitles)} concentram a maior afinidade em ${resolved.offer.title}.`;
}

function sortedScores(scores: Record<BeautyMovementOutcomeKey, number>): BeautyMovementOutcomeScore[] {
    return TIE_BREAK_ORDER
        .map((outcomeKey) => ({ outcomeKey, score: scores[outcomeKey] }))
        .sort((left, right) => right.score - left.score || TIE_BREAK_ORDER.indexOf(left.outcomeKey) - TIE_BREAK_ORDER.indexOf(right.outcomeKey));
}

function validateCards(palette: BeautyMovementPalette, selections: BeautyMovementSelections): [BeautyMovementCard, BeautyMovementCard, BeautyMovementCard] {
    const cards = BEAUTY_MOVEMENT_ACTS.map((act) => getBeautyMovementCard(palette, selections[act]));
    if (cards.some((card, index) => !card || card.act !== BEAUTY_MOVEMENT_ACTS[index])) {
        throw new Error("beauty_movement_outcome_requires_three_cards");
    }
    const resolved = cards as [BeautyMovementCard, BeautyMovementCard, BeautyMovementCard];
    for (const card of resolved) {
        if (!BEAUTY_MOVEMENT_CARD_AFFINITIES[card.id]) throw new Error(`beauty_movement_card_affinity_missing:${card.id}`);
    }
    return resolved;
}

export function resolveBeautyMovementOutcome(params: {
    palette: BeautyMovementPalette;
    selections: BeautyMovementSelections;
}): BeautyMovementResolvedOutcome {
    const cards = validateCards(params.palette, params.selections);
    const scores = Object.fromEntries(BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => [key, 0])) as Record<BeautyMovementOutcomeKey, number>;
    for (const card of cards) {
        const affinity = BEAUTY_MOVEMENT_CARD_AFFINITIES[card.id]!;
        for (const key of BEAUTY_MOVEMENT_OUTCOME_KEYS) scores[key] += affinity[key];
    }
    const cardIds = new Set(cards.map((card) => card.id));
    for (const synergy of BEAUTY_MOVEMENT_SYNERGIES) {
        if (cardIds.has(synergy.cards[0]) && cardIds.has(synergy.cards[1])) scores[synergy.outcomeKey] += synergy.bonus;
    }
    const orderedScores = sortedScores(scores);
    const winner = orderedScores[0]!;
    const selectionRecord = Object.fromEntries(BEAUTY_MOVEMENT_ACTS.map((act, index) => [act, cards[index]!.id])) as Record<BeautyMovementAct, string>;
    const resolved = {
        protocolVersion: BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION,
        palette: params.palette,
        selections: selectionRecord,
        cards,
        scores: orderedScores,
        outcomeKey: winner.outcomeKey,
        offer: BEAUTY_MOVEMENT_OFFERS[winner.outcomeKey],
    };
    return { ...resolved, rationale: explainBeautyMovementOutcome(resolved) };
}

export function enumerateBeautyMovementCombinations(): readonly BeautyMovementCombination[] {
    const combinations: BeautyMovementCombination[] = [];
    const palettes: BeautyMovementPalette[] = ["radiancia", "ritmo", "conexao"];
    for (const palette of palettes) {
        const cardsByAct = BEAUTY_MOVEMENT_ACTS.map((act) => getBeautyMovementCardsForAct(palette, act));
        for (const beauty of cardsByAct[0]!) {
            for (const movement of cardsByAct[1]!) {
                for (const celebration of cardsByAct[2]!) {
                    const selections = { beleza: beauty.id, movimento: movement.id, celebracao: celebration.id } as const;
                    const resolved = resolveBeautyMovementOutcome({ palette, selections });
                    combinations.push({
                        palette,
                        selections,
                        cards: resolved.cards,
                        scores: resolved.scores,
                        outcomeKey: resolved.outcomeKey,
                        rationale: resolved.rationale,
                    });
                }
            }
        }
    }
    return combinations;
}

export function getBeautyMovementOffer(outcomeKey: BeautyMovementOutcomeKey): BeautyMovementOffer {
    return BEAUTY_MOVEMENT_OFFERS[outcomeKey];
}

/**
 * Selects one stable, reviewable card triplet for an invite assignment.
 *
 * The triplet is an audit/display aid only: the invite assignment remains the
 * server-side authority, so a visitor may still click any valid card without
 * changing the guaranteed prize. Keeping this mapping deterministic lets an
 * import report show which symbolic reading was prepared for each outcome
 * without using a person's identity or any random source.
 */
export function selectBeautyMovementPlannedSelections(params: {
    palette: BeautyMovementPalette;
    outcomeKey: BeautyMovementOutcomeKey | null;
}): BeautyMovementSelections {
    const firstCards = BEAUTY_MOVEMENT_ACTS.map((act) => getBeautyMovementCardsForAct(params.palette, act)[0]);
    if (firstCards.some((card) => !card)) throw new Error("beauty_movement_planned_cards_unavailable");
    if (params.outcomeKey === null) {
        return Object.fromEntries(BEAUTY_MOVEMENT_ACTS.map((act, index) => [act, firstCards[index]!.id])) as BeautyMovementSelections;
    }

    const cardsByAct = BEAUTY_MOVEMENT_ACTS.map((act) => getBeautyMovementCardsForAct(params.palette, act));
    for (const beleza of cardsByAct[0]!) {
        for (const movimento of cardsByAct[1]!) {
            for (const celebracao of cardsByAct[2]!) {
                const selections = { beleza: beleza.id, movimento: movimento.id, celebracao: celebracao.id } as const;
                if (resolveBeautyMovementOutcome({ palette: params.palette, selections }).outcomeKey === params.outcomeKey) {
                    return selections;
                }
            }
        }
    }
    throw new Error("beauty_movement_planned_outcome_unreachable");
}

/** Stable, review-friendly artifact used to audit every reachable combination. */
export function formatBeautyMovementCombinationMapMarkdown(): string {
    const matrix = enumerateBeautyMovementCombinations();
    const counts = BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => [
        key,
        matrix.filter((entry) => entry.outcomeKey === key).length,
    ] as const);
    const paletteCounts = ["radiancia", "ritmo", "conexao"].map((palette) => {
        const entries = matrix.filter((entry) => entry.palette === palette);
        return [
            palette,
            ...BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => entries.filter((entry) => entry.outcomeKey === key).length),
        ] as const;
    });
    const rows = matrix.map((entry) => {
        const cardTitles = entry.cards.map((card) => card.title).join(" / ");
        const winner = entry.scores.find((score) => score.outcomeKey === entry.outcomeKey)!;
        const runner = entry.scores.find((score) => score.outcomeKey !== entry.outcomeKey)!;
        return `| ${entry.palette} | ${entry.selections.beleza} | ${entry.selections.movimento} | ${entry.selections.celebracao} | ${cardTitles} | ${entry.outcomeKey} | ${winner.score}–${runner.score} | ${entry.rationale} |`;
    });
    return [
        "# Matriz de combinações — Cartas da Beleza",
        "",
        `Versão do resolver: \`${BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION}\``,
        "Resolver puro, determinístico e sem dados pessoais. A paleta escolhe o deck; não escolhe o resultado.",
        "",
        "## Revisão editorial",
        "",
        "A matriz foi revisada para que a coerência da história venha antes da igualdade matemática. Potência + Renovação reforça Firmeza & Renovação; Radiância/Presença + Confiança/Brilho reforçam Hidratação & Luminosidade; Autoria/Constância reforça continuidade; Autocuidado + Potência/Ritmo resolve a leitura de estímulo sem depender do desempate. A paleta continua enviesando o deck por semântica, mas cada paleta alcança os quatro outcomes.",
        "",
        "## Regra de desempate",
        "",
        "Somam-se as afinidades explícitas das três cartas e as sinergias documentadas no código. Em empate, a ordem estável é Elleva → Preenchimento → Restylane Classic + Sculptra → Skinbooster + Diamond.",
        "",
        "## Cobertura",
        "",
        `Total: **${matrix.length}** combinações (3 paletas × 3³ escolhas).`,
        "",
        ...counts.map(([key, count]) => `- \`${key}\`: ${count}`),
        "",
        "Distribuição por paleta (a assimetria é semântica; nenhum outcome é bloqueado):",
        "",
        "| Paleta | Elleva | Preenchimento | Restylane Classic + Sculptra | Skinbooster + Diamond |",
        "| --- | ---: | ---: | ---: | ---: |",
        ...paletteCounts.map(([palette, ...values]) => `| ${palette} | ${values.join(" | ")} |`),
        "",
        "## Matriz completa",
        "",
        "| Paleta | Beleza | Movimento | Celebração | Títulos | Oferta desbloqueada | Pontuação | Justificativa editorial |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows,
        "",
    ].join("\n");
}
