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
export const BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION = "beauty-movement-outcomes-v1" as const;

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
};

export type BeautyMovementCombination = {
    palette: BeautyMovementPalette;
    selections: Readonly<Record<BeautyMovementAct, string>>;
    cards: readonly BeautyMovementCard[];
    outcomeKey: BeautyMovementOutcomeKey;
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

const SYNERGIES: readonly Synergy[] = [
    { outcomeKey: "elleva_upgrade", cards: ["movimento-constancia", "celebracao-renovacao"], bonus: 3 },
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
    for (const synergy of SYNERGIES) {
        if (cardIds.has(synergy.cards[0]) && cardIds.has(synergy.cards[1])) scores[synergy.outcomeKey] += synergy.bonus;
    }
    const orderedScores = sortedScores(scores);
    const winner = orderedScores[0]!;
    const selectionRecord = Object.fromEntries(BEAUTY_MOVEMENT_ACTS.map((act, index) => [act, cards[index]!.id])) as Record<BeautyMovementAct, string>;
    return {
        protocolVersion: BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION,
        palette: params.palette,
        selections: selectionRecord,
        cards,
        scores: orderedScores,
        outcomeKey: winner.outcomeKey,
        offer: BEAUTY_MOVEMENT_OFFERS[winner.outcomeKey],
    };
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
                    combinations.push({ palette, selections, cards: resolved.cards, outcomeKey: resolved.outcomeKey });
                }
            }
        }
    }
    return combinations;
}

export function getBeautyMovementOffer(outcomeKey: BeautyMovementOutcomeKey): BeautyMovementOffer {
    return BEAUTY_MOVEMENT_OFFERS[outcomeKey];
}

/** Stable, review-friendly artifact used to audit every reachable combination. */
export function formatBeautyMovementCombinationMapMarkdown(): string {
    const matrix = enumerateBeautyMovementCombinations();
    const counts = BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => [
        key,
        matrix.filter((entry) => entry.outcomeKey === key).length,
    ] as const);
    const rows = matrix.map((entry) => {
        const cardTitles = entry.cards.map((card) => card.title).join(" / ");
        return `| ${entry.palette} | ${entry.selections.beleza} | ${entry.selections.movimento} | ${entry.selections.celebracao} | ${cardTitles} | ${entry.outcomeKey} |`;
    });
    return [
        "# Matriz de combinações — Cartas da Beleza",
        "",
        `Versão do resolver: \`${BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION}\`  `,
        "Resolver puro, determinístico e sem dados pessoais. A paleta escolhe o deck; não escolhe o resultado.",
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
        "## Matriz completa",
        "",
        "| Paleta | Beleza | Movimento | Celebração | Títulos | Oferta desbloqueada |",
        "| --- | --- | --- | --- | --- | --- |",
        ...rows,
        "",
    ].join("\n");
}
