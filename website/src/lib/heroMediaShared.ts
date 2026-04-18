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

export const LOCAL_HERO_ITEMS_DESKTOP: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-01.png",
        alt: "Mês das Mães - Espaço Facial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-02.png",
        alt: "Mês das Mães - Botox 3 Regiões",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-03.png",
        alt: "Mês das Mães - Bioestimulador de Colágeno",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-04.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno destaque",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-05.jpg",
        alt: "Mês das Mães - Laser Lavieen",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-06.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno oferta",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-07.jpg",
        alt: "Mês das Mães - Preenchimento Labial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-08.jpg",
        alt: "Mês das Mães - Botox 3 Regiões campanha",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-09.jpg",
        alt: "Mês das Mães - Botox 3 Regiões visual",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/clube-botox-2026/banner-01.jpg",
        alt: "Clube do Botox - campanha masculina",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/clube-botox-2026/banner-02.jpg",
        alt: "Clube do Botox - campanha feminina",
    },
];

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-01.png",
        alt: "Mês das Mães - Espaço Facial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-02.png",
        alt: "Mês das Mães - Botox 3 Regiões",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-03.png",
        alt: "Mês das Mães - Bioestimulador de Colágeno",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-04.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno destaque",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-05.jpg",
        alt: "Mês das Mães - Laser Lavieen",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-06.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno oferta",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-07.jpg",
        alt: "Mês das Mães - Preenchimento Labial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-08.jpg",
        alt: "Mês das Mães - Botox 3 Regiões campanha",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-09.jpg",
        alt: "Mês das Mães - Botox 3 Regiões visual",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/clube-botox-2026/banner-01.jpg",
        alt: "Clube do Botox - campanha masculina",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/clube-botox-2026/banner-02.jpg",
        alt: "Clube do Botox - campanha feminina",
    },
];

const HERO_MAES_2026_ITEMS: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-01.png",
        alt: "Mês das Mães - Espaço Facial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-02.png",
        alt: "Mês das Mães - Botox 3 Regiões",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-03.png",
        alt: "Mês das Mães - Bioestimulador de Colágeno",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-04.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno destaque",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-05.jpg",
        alt: "Mês das Mães - Laser Lavieen",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-06.jpg",
        alt: "Mês das Mães - Bioestimulador de Colágeno oferta",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-07.jpg",
        alt: "Mês das Mães - Preenchimento Labial",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-08.jpg",
        alt: "Mês das Mães - Botox 3 Regiões campanha",
    },
    {
        type: "image",
        src: "/images/hero/campaigns/maes-2026/banner-09.jpg",
        alt: "Mês das Mães - Botox 3 Regiões visual",
    },
];

export const LOCAL_HERO_ITEMS_BY_UNIT: Partial<Record<string, HeroMediaUnitCampaign>> = {
    barrashoppingsul: {
        desktop: HERO_MAES_2026_ITEMS,
        mobile: HERO_MAES_2026_ITEMS,
    },
    novohamburgo: {
        desktop: HERO_MAES_2026_ITEMS,
        mobile: HERO_MAES_2026_ITEMS,
    },
};

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
