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

const HERO_JUNHO_2026_CAMPAIGN_ITEMS = [
    {
        id: "botox-3-regioes-50ui-699",
        desktopFile: "botox_3_regioes_50ui__rosto__price__699__meta__story__estatico__campaign__2x1.png",
        mobileFile: "botox_3_regioes_50ui__rosto__price__699__meta__story__estatico__campaign__9x16.png",
        alt: "Botox 3 regiões 50 UI por R$ 699 - campanha Junho 2026",
    },
    {
        id: "botox-3-regioes-60ui-799",
        desktopFile: "botox_3_regioes_60ui__rosto__799__campaign__2x1.png",
        mobileFile: "botox_3_regioes_60ui__rosto__799__campaign__9x16.png",
        alt: "Botox 3 regiões 60 UI por R$ 799 - campanha Junho 2026",
    },
    {
        id: "botox-3-regioes-599",
        desktopFile: "botox_3_regioes__rosto__price__599__meta__story__estatico__campaign__2x1.png",
        mobileFile: "botox_3_regioes__rosto__price__599__meta__story__estatico__campaign__9x16.png",
        alt: "Botox 3 regiões por R$ 599 - campanha Junho 2026",
    },
    {
        id: "combo-botox-full-face-labial-hidragloss-v1",
        desktopFile: "combo_botox_full_face_preenchimento_labial_hidragloss__rosto__10x14990__campaign__V1__2x1.png",
        mobileFile: "combo_botox_full_face_preenchimento_labial_hidragloss__rosto__10x14990__campaign__V1__9x16.png",
        alt: "Combo Botox Full Face, preenchimento labial e Hidragloss em 10x de R$ 149,90 - campanha Junho 2026",
    },
    {
        id: "combo-botox-full-face-labial-hidragloss-v2",
        desktopFile: "combo_botox_full_face_preenchimento_labial_hidragloss__rosto__10x14990__campaign__V2__2x1.png",
        mobileFile: "combo_botox_full_face_preenchimento_labial_hidragloss__rosto__10x14990__campaign__V2__9x16.png",
        alt: "Combo Botox Full Face, preenchimento labial e Hidragloss - campanha Junho 2026",
    },
    {
        id: "combo-botox-preenchimento-40ui-1ml",
        desktopFile: "combo_botox_preenchimento__40ui_1ml__10x97__campaign__2x1.png",
        mobileFile: "combo_botox_preenchimento__40ui_1ml__10x97__campaign__9x16.png",
        alt: "Combo Botox 40 UI e preenchimento 1 ml em 10x de R$ 97 - campanha Junho 2026",
    },
    {
        id: "combo-botox-preenchimento-mulher-40ui-1ml",
        desktopFile: "combo_botox_preenchimento__mulher__40ui_1ml__10x97__campaign__2x1.png",
        mobileFile: "combo_botox_preenchimento__mulher__40ui_1ml__10x97__campaign__9x16.png",
        alt: "Combo Botox e preenchimento 40 UI + 1 ml - campanha Junho 2026",
    },
    {
        id: "combo-botox-preenchimento-facial",
        desktopFile: "combo_botox_preenchimento_facial__rosto__parcelado__10x97__campaign__2x1.png",
        mobileFile: "combo_botox_preenchimento_facial__rosto__parcelado__10x97__campaign__9x16.png",
        alt: "Combo Botox e preenchimento facial em 10x de R$ 97 - campanha Junho 2026",
    },
    {
        id: "combo-pele-renovada",
        desktopFile: "combo_pele_renovada__peeling_microagulhamento_intradermoterapia__450__campaign__2x1.png",
        mobileFile: "combo_pele_renovada__peeling_microagulhamento_intradermoterapia__450__campaign__9x16.png",
        alt: "Combo pele renovada com peeling, microagulhamento e intradermoterapia - campanha Junho 2026",
    },
    {
        id: "combo-preenchimento-sculptra",
        desktopFile: "combo_preenchimento_sculptra__1ml__10x249__campaign__2x1.png",
        mobileFile: "combo_preenchimento_sculptra__1ml__10x249__campaign__9x16.png",
        alt: "Combo preenchimento e Sculptra 1 ml em 10x de R$ 249 - campanha Junho 2026",
    },
    {
        id: "preenchimento-labial-antes-depois-namorados",
        desktopFile: "preenchimento_labial__antes_depois__1ml599_2ml50off__campaign_namorados__2x1.png",
        mobileFile: "preenchimento_labial__antes_depois__1ml599_2ml50off__campaign_namorados__9x16.png",
        alt: "Preenchimento labial 1 ml por R$ 599 e segundo ml com 50% off - campanha Namorados 2026",
    },
    {
        id: "preenchimento-labial-casal-namorados",
        desktopFile: "preenchimento_labial__casal__1ml599_2ml50off__campaign_namorados__2x1.png",
        mobileFile: "preenchimento_labial__casal__1ml599_2ml50off__campaign_namorados__9x16.png",
        alt: "Preenchimento labial para casal - campanha Namorados 2026",
    },
    {
        id: "preenchimento-labial-rosto-namorados",
        desktopFile: "preenchimento_labial__rosto__1ml_599_2ml_50off_299__campaign_namorados__2x1.png",
        mobileFile: "preenchimento_labial__rosto__1ml_599_2ml_50off_299__campaign_namorados__9x16.png",
        alt: "Preenchimento labial 1 ml por R$ 599, segundo ml por R$ 299 - campanha Namorados 2026",
    },
] as const;

function heroJunho2026ItemForVariant(
    item: (typeof HERO_JUNHO_2026_CAMPAIGN_ITEMS)[number],
    variant: HeroMediaVariant,
    index: number,
): HeroMediaItem {
    const file = variant === "mobile" ? item.mobileFile : item.desktopFile;
    return {
        id: `junho-2026-${variant}-${item.id}`,
        type: "image",
        src: `/images/hero/campaigns/junho-2026/${variant}/${file}`,
        alt: item.alt,
        order: index + 1,
    };
}

export const HERO_JUNHO_2026_DESKTOP_ITEMS: HeroMediaItem[] = HERO_JUNHO_2026_CAMPAIGN_ITEMS.map((item, index) =>
    heroJunho2026ItemForVariant(item, "desktop", index),
);

export const HERO_JUNHO_2026_MOBILE_ITEMS: HeroMediaItem[] = HERO_JUNHO_2026_CAMPAIGN_ITEMS.map((item, index) =>
    heroJunho2026ItemForVariant(item, "mobile", index),
);

export const LOCAL_HERO_ITEMS_DESKTOP: HeroMediaItem[] = HERO_JUNHO_2026_DESKTOP_ITEMS;

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = HERO_JUNHO_2026_MOBILE_ITEMS;

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
