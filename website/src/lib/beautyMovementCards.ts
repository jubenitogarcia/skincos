export const BEAUTY_MOVEMENT_ACTS = ["beleza", "movimento", "celebracao"] as const;

export type BeautyMovementAct = (typeof BEAUTY_MOVEMENT_ACTS)[number];

export const BEAUTY_MOVEMENT_PALETTES = ["radiancia", "ritmo", "conexao"] as const;

export type BeautyMovementPalette = (typeof BEAUTY_MOVEMENT_PALETTES)[number];

export type BeautyMovementActDefinition = {
    id: BeautyMovementAct;
    label: string;
    prompt: string;
    promptTitle: string;
    promptSubtitle: string;
    progressLabel: string;
};

export type BeautyMovementCard = {
    id: string;
    act: BeautyMovementAct;
    title: string;
    shortMessage: string;
    palette: BeautyMovementPalette | "comum";
};

export type BeautyMovementSelections = Partial<Record<BeautyMovementAct, string>>;

export type BeautyMovementReadingLine = {
    act: BeautyMovementAct;
    actLabel: string;
    cardId: string;
    title: string;
    message: string;
};

export const BEAUTY_MOVEMENT_ACT_DEFINITIONS: readonly BeautyMovementActDefinition[] = [
    {
        id: "beleza",
        label: "Beleza",
        prompt: "O que merece mais presença no seu ritual? O gesto que faz você se reconhecer no agora.",
        promptTitle: "O que merece mais presença no seu ritual?",
        promptSubtitle: "O gesto que faz você se reconhecer no agora.",
        progressLabel: "Primeira escolha",
    },
    {
        id: "movimento",
        label: "Movimento",
        prompt: "O que sustenta o seu ritmo? A energia que transforma pequenos gestos em movimento.",
        promptTitle: "O que sustenta o seu ritmo?",
        promptSubtitle: "A energia que transforma pequenos gestos em movimento.",
        progressLabel: "Segunda escolha",
    },
    {
        id: "celebracao",
        label: "Celebração",
        prompt: "O que você quer celebrar neste encontro? A presença, a conexão e o próximo ciclo.",
        promptTitle: "O que você quer celebrar neste encontro?",
        promptSubtitle: "A presença, a conexão e o próximo ciclo.",
        progressLabel: "Terceira escolha",
    },
] as const;

export const BEAUTY_MOVEMENT_PALETTE_LABELS: Record<BeautyMovementPalette, string> = {
    radiancia: "Radiância",
    ritmo: "Ritmo",
    conexao: "Conexão",
};

const COMMON_CARDS: Record<BeautyMovementAct, readonly Omit<BeautyMovementCard, "act" | "palette">[]> = {
    beleza: [
        {
            id: "beleza-presenca",
            title: "Presença",
            shortMessage: "Um convite para reconhecer o que faz você se sentir inteira no agora.",
        },
        {
            id: "beleza-autocuidado",
            title: "Autocuidado",
            shortMessage: "Seu ritual também pode ser uma pausa escolhida por você.",
        },
    ],
    movimento: [
        {
            id: "movimento-constancia",
            title: "Constância",
            shortMessage: "Pequenos gestos, repetidos com intenção, também criam movimento.",
        },
        {
            id: "movimento-potencia",
            title: "Potência",
            shortMessage: "Há força em ocupar o seu espaço com leveza e decisão.",
        },
    ],
    celebracao: [
        {
            id: "celebracao-confianca",
            title: "Confiança",
            shortMessage: "Celebre a segurança de aparecer do seu próprio jeito.",
        },
        {
            id: "celebracao-renovacao",
            title: "Renovação",
            shortMessage: "Um novo ciclo pode começar em um detalhe que faz sentido para você.",
        },
    ],
};

const PALETTE_SIGNATURES: Record<BeautyMovementPalette, Record<BeautyMovementAct, Omit<BeautyMovementCard, "act" | "palette">>> = {
    radiancia: {
        beleza: {
            id: "beleza-radiancia",
            title: "Radiância",
            shortMessage: "Deixe que o que é seu apareça com clareza, sem excessos.",
        },
        movimento: {
            id: "movimento-leveza",
            title: "Leveza",
            shortMessage: "Movimento também é encontrar espaço para respirar e seguir.",
        },
        celebracao: {
            id: "celebracao-brilho",
            title: "Brilho",
            shortMessage: "Reconheça as pequenas luzes que tornam o seu caminho especial.",
        },
    },
    ritmo: {
        beleza: {
            id: "beleza-autoria",
            title: "Autoria",
            shortMessage: "Sua beleza acompanha escolhas que têm a sua assinatura.",
        },
        movimento: {
            id: "movimento-ritmo",
            title: "Ritmo",
            shortMessage: "Encontre uma cadência que respeite o seu tempo e a sua energia.",
        },
        celebracao: {
            id: "celebracao-impulso",
            title: "Impulso",
            shortMessage: "Valorize o que te convida a avançar com vontade.",
        },
    },
    conexao: {
        beleza: {
            id: "beleza-harmonia",
            title: "Harmonia",
            shortMessage: "Há beleza no que conversa com quem você é hoje.",
        },
        movimento: {
            id: "movimento-sintonia",
            title: "Sintonia",
            shortMessage: "Siga o que combina com o seu momento, sem pressa de caber em outro ritmo.",
        },
        celebracao: {
            id: "celebracao-encontro",
            title: "Encontro",
            shortMessage: "Celebre as conexões que deixam a experiência mais memorável.",
        },
    },
};

export function getBeautyMovementAct(act: BeautyMovementAct): BeautyMovementActDefinition {
    return BEAUTY_MOVEMENT_ACT_DEFINITIONS.find((item) => item.id === act) ?? BEAUTY_MOVEMENT_ACT_DEFINITIONS[0];
}

export function isBeautyMovementAct(value: unknown): value is BeautyMovementAct {
    return typeof value === "string" && BEAUTY_MOVEMENT_ACTS.includes(value as BeautyMovementAct);
}

export function isBeautyMovementPalette(value: unknown): value is BeautyMovementPalette {
    return typeof value === "string" && BEAUTY_MOVEMENT_PALETTES.includes(value as BeautyMovementPalette);
}

export function getBeautyMovementDeck(palette: BeautyMovementPalette): readonly BeautyMovementCard[] {
    return BEAUTY_MOVEMENT_ACTS.flatMap((act) => [
        ...COMMON_CARDS[act].map((card) => ({ ...card, act, palette: "comum" as const })),
        { ...PALETTE_SIGNATURES[palette][act], act, palette },
    ]);
}

export function getBeautyMovementCardsForAct(
    palette: BeautyMovementPalette,
    act: BeautyMovementAct,
): readonly BeautyMovementCard[] {
    return getBeautyMovementDeck(palette).filter((card) => card.act === act);
}

export function getBeautyMovementCard(
    palette: BeautyMovementPalette,
    cardId: string | null | undefined,
): BeautyMovementCard | null {
    if (!cardId) return null;
    return getBeautyMovementDeck(palette).find((card) => card.id === cardId) ?? null;
}

export function normalizeBeautyMovementSelections(
    palette: BeautyMovementPalette,
    selections: BeautyMovementSelections | null | undefined,
): BeautyMovementSelections {
    if (!selections) return {};

    return BEAUTY_MOVEMENT_ACTS.reduce<BeautyMovementSelections>((normalized, act) => {
        const card = getBeautyMovementCard(palette, selections[act]);
        if (card?.act === act) {
            normalized[act] = card.id;
        }
        return normalized;
    }, {});
}

export function getBeautyMovementReading(
    palette: BeautyMovementPalette,
    selections: BeautyMovementSelections,
): readonly BeautyMovementReadingLine[] {
    return BEAUTY_MOVEMENT_ACTS.flatMap((act) => {
        const card = getBeautyMovementCard(palette, selections[act]);
        if (!card || card.act !== act) return [];

        return [
            {
                act,
                actLabel: getBeautyMovementAct(act).label,
                cardId: card.id,
                title: card.title,
                message: card.shortMessage,
            },
        ];
    });
}

export function buildBeautyMovementSummary(reading: readonly BeautyMovementReadingLine[]): string {
    const titles = reading.map((line) => line.title);
    if (titles.length === 0) return "Uma seleção preparada para acompanhar o seu momento.";
    if (titles.length === 1) return `${titles[0]} guia a sua leitura.`;
    if (titles.length === 2) return `${titles[0]} e ${titles[1]} acompanham a sua leitura.`;
    return `${titles[0]}, ${titles[1]} e ${titles[2]} formam a sua leitura para este encontro.`;
}
