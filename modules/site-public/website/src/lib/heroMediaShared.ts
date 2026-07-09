export type HeroMediaBookingHotspot = {
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
};

export type HeroMediaScope = "global" | `unit:${string}`;

export type HeroMediaItem = {
    id?: string;
    type: "image" | "video";
    src: string;
    alt?: string;
    scope?: HeroMediaScope;
    enabled?: boolean;
    order?: number;
    bookingHotspot?: HeroMediaBookingHotspot;
};

export type HeroMediaVariant = "desktop" | "mobile";

export type HeroMediaUnitCampaign = {
    desktop: HeroMediaItem[];
    mobile: HeroMediaItem[];
};

export type HeroMediaScopeBuckets = {
    unitItems: HeroMediaItem[];
    globalItems: HeroMediaItem[];
};

const HERO_ANIVERSARIO_7_ANOS_2026_CAMPAIGN_ITEMS = [
    {
        id: "website-01-aniversario-cruzeiro",
        desktopFile: "website-01.png",
        alt: "Campanha de 7 anos da Espaço Facial com prêmio de viagem internacional",
    },
    {
        id: "website-02-compras-cruzeiro",
        desktopFile: "website-02.png",
        alt: "A cada R$ 1.500 em compras, concorra a um cruzeiro internacional com acompanhante",
    },
    {
        id: "website-03-botox-bioestimulador",
        desktopFile: "website-03.png",
        alt: "Botox 35 UI a partir de R$ 399 e bioestimulador de colágeno a partir de R$ 799",
    },
] as const;

const HERO_ANIVERSARIO_7_ANOS_2026_MOBILE_CAMPAIGN_ITEMS = [
    {
        id: "mobile-01-botox-modelo",
        file: "mobile-01.png",
        alt: "Campanha mobile de 7 anos com oferta de Botox 35 UI por R$ 399",
    },
    {
        id: "mobile-02-bioestimulador-modelo",
        file: "mobile-02.png",
        alt: "Campanha mobile de 7 anos com bioestimulador de colágeno a partir de R$ 799",
    },
    {
        id: "mobile-03-botox-antes-depois",
        file: "mobile-03.png",
        alt: "Campanha mobile de Botox com resultado antes e depois",
    },
    {
        id: "mobile-04-botox-antes-depois-masculino",
        file: "mobile-04.png",
        alt: "Campanha mobile de Botox com resultado antes e depois masculino",
    },
    {
        id: "mobile-05-bioestimulador-antes-depois",
        file: "mobile-05.png",
        alt: "Campanha mobile de bioestimulador de colágeno com resultado antes e depois",
    },
] as const;

function heroAniversario7Anos2026DesktopItem(
    item: (typeof HERO_ANIVERSARIO_7_ANOS_2026_CAMPAIGN_ITEMS)[number],
    index: number,
): HeroMediaItem {
    return {
        id: `aniversario-7-anos-2026-desktop-${item.id}`,
        type: "image",
        src: `/images/hero/campaigns/aniversario-7-anos-2026/desktop/${item.desktopFile}`,
        alt: item.alt,
        order: index + 1,
    };
}

function heroAniversario7Anos2026MobileItem(
    item: (typeof HERO_ANIVERSARIO_7_ANOS_2026_MOBILE_CAMPAIGN_ITEMS)[number],
    index: number,
): HeroMediaItem {
    return {
        id: `aniversario-7-anos-2026-mobile-${item.id}`,
        type: "image",
        src: `/images/hero/campaigns/aniversario-7-anos-2026/mobile/${item.file}`,
        alt: item.alt,
        order: index + 1,
    };
}

export const HERO_ANIVERSARIO_7_ANOS_2026_DESKTOP_ITEMS: HeroMediaItem[] = HERO_ANIVERSARIO_7_ANOS_2026_CAMPAIGN_ITEMS.map(
    heroAniversario7Anos2026DesktopItem,
);

export const HERO_ANIVERSARIO_7_ANOS_2026_MOBILE_ITEMS: HeroMediaItem[] =
    HERO_ANIVERSARIO_7_ANOS_2026_MOBILE_CAMPAIGN_ITEMS.map(heroAniversario7Anos2026MobileItem);

export const LOCAL_HERO_ITEMS_DESKTOP: HeroMediaItem[] = HERO_ANIVERSARIO_7_ANOS_2026_DESKTOP_ITEMS;

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = HERO_ANIVERSARIO_7_ANOS_2026_MOBILE_ITEMS;

export const LOCAL_HERO_ITEMS_BY_UNIT: Partial<Record<string, HeroMediaUnitCampaign>> = {};

export function normalizeHeroUnitSlug(value: string | null | undefined): string {
    return (value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function toUnitScope(unitSlug: string | null | undefined): HeroMediaScope | null {
    const unitKey = normalizeHeroUnitSlug(unitSlug);
    return unitKey ? (`unit:${unitKey}` as HeroMediaScope) : null;
}

export function normalizeHeroMediaScope(value: string | null | undefined): HeroMediaScope | null {
    const raw = (value ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "global") return "global";
    if (!raw.startsWith("unit:")) return null;
    const unitKey = normalizeHeroUnitSlug(raw.slice("unit:".length));
    if (!unitKey) return null;
    return `unit:${unitKey}`;
}

function normalizeOrder(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function sortHeroMediaItems(items: HeroMediaItem[]): HeroMediaItem[] {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const aOrder = typeof a.item.order === "number";
            const bOrder = typeof b.item.order === "number";
            if (aOrder && bOrder) {
                const left = a.item.order as number;
                const right = b.item.order as number;
                if (left !== right) return left - right;
                return a.index - b.index;
            }
            if (aOrder) return -1;
            if (bOrder) return 1;
            return a.index - b.index;
        })
        .map((entry) => entry.item);
}

function dedupeKey(item: HeroMediaItem): string {
    const normalizedId = normalizeId(item.id);
    if (normalizedId) return `id:${normalizedId}`;
    return `src:${item.type}:${item.src}`;
}

export function dedupeHeroMediaItems(items: HeroMediaItem[]): HeroMediaItem[] {
    const unique = new Map<string, HeroMediaItem>();

    for (const item of items) {
        const key = dedupeKey(item);
        const existing = unique.get(key);
        if (!existing) {
            unique.set(key, {
                ...item,
                id: normalizeId(item.id),
                scope: normalizeHeroMediaScope(item.scope ?? null) ?? item.scope,
                order: normalizeOrder(item.order),
            });
            continue;
        }

        unique.set(key, {
            ...existing,
            id: normalizeId(existing.id) ?? normalizeId(item.id),
            alt: existing.alt ?? item.alt,
            bookingHotspot: existing.bookingHotspot ?? item.bookingHotspot,
            scope: normalizeHeroMediaScope(existing.scope ?? null) ?? normalizeHeroMediaScope(item.scope ?? null) ?? existing.scope ?? item.scope,
            enabled: existing.enabled ?? item.enabled,
            order: normalizeOrder(existing.order) ?? normalizeOrder(item.order),
        });
    }

    return [...unique.values()];
}

function resolveItemsWithFallbackScope(items: HeroMediaItem[], fallbackScope: HeroMediaScope, unitScope: HeroMediaScope | null): HeroMediaScopeBuckets {
    const unitItems: HeroMediaItem[] = [];
    const globalItems: HeroMediaItem[] = [];

    for (const rawItem of items) {
        if (!rawItem || typeof rawItem.src !== "string" || !rawItem.src.trim()) continue;
        if (rawItem.enabled === false) continue;

        const scope = normalizeHeroMediaScope(rawItem.scope ?? null) ?? fallbackScope;
        if (scope !== "global" && (!unitScope || scope !== unitScope)) continue;

        const normalizedItem: HeroMediaItem = {
            ...rawItem,
            id: normalizeId(rawItem.id),
            scope,
            order: normalizeOrder(rawItem.order),
        };

        if (scope === "global") {
            globalItems.push(normalizedItem);
        } else {
            unitItems.push(normalizedItem);
        }
    }

    return {
        unitItems: dedupeHeroMediaItems(sortHeroMediaItems(unitItems)),
        globalItems: dedupeHeroMediaItems(sortHeroMediaItems(globalItems)),
    };
}

export function resolveScopedHeroMediaItems(options: {
    items: HeroMediaItem[];
    unitSlug?: string | null;
    fallbackScope?: HeroMediaScope;
}): HeroMediaScopeBuckets {
    const unitScope = toUnitScope(options.unitSlug);
    const fallbackScope = options.fallbackScope ?? "global";
    return resolveItemsWithFallbackScope(options.items, fallbackScope, unitScope);
}

export function composeHeroMediaItems(options: {
    unitSlug?: string | null;
    unitItems?: HeroMediaItem[];
    globalItems?: HeroMediaItem[];
}): HeroMediaItem[] {
    const unitScope = toUnitScope(options.unitSlug);
    const resolvedUnit = unitScope
        ? resolveItemsWithFallbackScope(options.unitItems ?? [], unitScope, unitScope)
        : { unitItems: [] as HeroMediaItem[], globalItems: [] as HeroMediaItem[] };
    const resolvedGlobal = resolveItemsWithFallbackScope(options.globalItems ?? [], "global", unitScope);

    // Order rule: specific unit items always come before global items.
    return dedupeHeroMediaItems([
        ...resolvedUnit.unitItems,
        ...resolvedGlobal.unitItems,
        ...resolvedUnit.globalItems,
        ...resolvedGlobal.globalItems,
    ]);
}

export function getLocalHeroItemsByScope(variant: HeroMediaVariant, options: { unitSlug?: string | null } = {}): HeroMediaScopeBuckets {
    const unitScope = toUnitScope(options.unitSlug);
    const unitKey = unitScope ? unitScope.slice("unit:".length) : "";
    const unitCampaign = unitKey ? LOCAL_HERO_ITEMS_BY_UNIT[unitKey] : null;

    const globalSource = variant === "mobile" ? LOCAL_HERO_ITEMS_MOBILE : LOCAL_HERO_ITEMS_DESKTOP;
    const unitSource = unitCampaign ? (variant === "mobile" ? unitCampaign.mobile : unitCampaign.desktop) : [];

    const fromGlobal = resolveItemsWithFallbackScope(globalSource, "global", unitScope);
    const fromUnit = unitScope ? resolveItemsWithFallbackScope(unitSource, unitScope, unitScope) : { unitItems: [] as HeroMediaItem[], globalItems: [] as HeroMediaItem[] };

    return {
        unitItems: dedupeHeroMediaItems([...fromGlobal.unitItems, ...fromUnit.unitItems]),
        globalItems: dedupeHeroMediaItems([...fromGlobal.globalItems, ...fromUnit.globalItems]),
    };
}

export function getLocalHeroItems(variant: HeroMediaVariant, options: { unitSlug?: string | null } = {}): HeroMediaItem[] {
    const scoped = getLocalHeroItemsByScope(variant, options);
    return composeHeroMediaItems({
        unitSlug: options.unitSlug,
        unitItems: scoped.unitItems,
        globalItems: scoped.globalItems,
    });
}

export const LOCAL_HERO_ITEMS = LOCAL_HERO_ITEMS_DESKTOP;
