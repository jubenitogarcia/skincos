export type HeroMediaBookingHotspot = {
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
};

export type HeroMediaItem = {
    type: "image" | "video";
    src: string;
    alt?: string;
    bookingHotspot?: HeroMediaBookingHotspot;
};

export type HeroMediaVariant = "desktop" | "mobile";

export type HeroMediaUnitCampaign = {
    desktop: HeroMediaItem[];
    mobile: HeroMediaItem[];
};

export const LOCAL_HERO_ITEMS_DESKTOP: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/desktop/banner-01.png",
        alt: "Mês do Consumidor - Preenchimento 2mL",
        bookingHotspot: {
            leftPct: 45.5,
            topPct: 80.2,
            widthPct: 18.5,
            heightPct: 8.8,
        },
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-02.png",
        alt: "Mês do Consumidor - Preenchimento com Lavieen",
        bookingHotspot: {
            leftPct: 44.8,
            topPct: 82.8,
            widthPct: 20.3,
            heightPct: 8.8,
        },
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-03.png",
        alt: "Mês do Consumidor - Combo exclusivo de preenchimento",
        bookingHotspot: {
            leftPct: 70.2,
            topPct: 81.4,
            widthPct: 22.8,
            heightPct: 9.1,
        },
    },
];

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/mobile/banner-01-optimized.jpg",
        alt: "Mês do Consumidor - Preenchimento 2mL",
        bookingHotspot: {
            leftPct: 17,
            topPct: 71.4,
            widthPct: 32,
            heightPct: 6.8,
        },
    },
    {
        type: "image",
        src: "/images/hero/mobile/banner-02.png",
        alt: "Mês do Consumidor - Preenchimento com Lavieen",
        bookingHotspot: {
            leftPct: 12.6,
            topPct: 73.5,
            widthPct: 33.8,
            heightPct: 7,
        },
    },
    {
        type: "image",
        src: "/images/hero/mobile/banner-03.png",
        alt: "Mês do Consumidor - Combo exclusivo de preenchimento",
        bookingHotspot: {
            leftPct: 12.2,
            topPct: 76.5,
            widthPct: 34.5,
            heightPct: 7,
        },
    },
];

export const LOCAL_HERO_ITEMS_BY_UNIT: Partial<Record<string, HeroMediaUnitCampaign>> = {
    barrashoppingsul: {
        desktop: [
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/desktop/banner-01.jpg",
                alt: "2 anos Espaço Facial Barra Shopping Sul",
            },
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/desktop/banner-02.jpg",
                alt: "Campanha Botox 3 regiões por 4x de R$99,90",
            },
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/desktop/banner-03.jpg",
                alt: "Campanha Barra Shopping Sul com Botox, Lavieen e preenchedor",
            },
        ],
        mobile: [
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/mobile/banner-01.jpg",
                alt: "2 anos Espaço Facial Barra Shopping Sul",
            },
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/mobile/banner-02.jpg",
                alt: "Campanha Botox 3 regiões por 4x de R$99,90",
            },
            {
                type: "image",
                src: "/images/hero/units/barrashoppingsul/mobile/banner-03.jpg",
                alt: "Campanha Barra Shopping Sul com Botox, Lavieen e preenchedor",
            },
        ],
    },
    novohamburgo: {
        desktop: [
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/desktop/banner-01.png",
                alt: "Campanha Beijo Premiado",
            },
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/desktop/banner-02.png",
                alt: "Campanha de preenchedor 1ml e 2ml",
            },
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/desktop/banner-03.png",
                alt: "Campanha Beije e Ganhe",
            },
        ],
        mobile: [
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/mobile/banner-01.png",
                alt: "Campanha Beijo Premiado",
            },
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/mobile/banner-02.png",
                alt: "Campanha de preenchedor 1ml e 2ml",
            },
            {
                type: "image",
                src: "/images/hero/units/novohamburgo/mobile/banner-03.png",
                alt: "Campanha Beije e Ganhe",
            },
        ],
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

export function getLocalHeroItems(variant: HeroMediaVariant, options: { unitSlug?: string | null } = {}): HeroMediaItem[] {
    const unitKey = normalizeHeroUnitSlug(options.unitSlug);
    const unitCampaign = unitKey ? LOCAL_HERO_ITEMS_BY_UNIT[unitKey] : null;
    const unitItems = unitCampaign ? (variant === "mobile" ? unitCampaign.mobile : unitCampaign.desktop) : null;

    if (Array.isArray(unitItems) && unitItems.length > 0) return unitItems;

    return variant === "mobile" ? LOCAL_HERO_ITEMS_MOBILE : LOCAL_HERO_ITEMS_DESKTOP;
}

export const LOCAL_HERO_ITEMS = LOCAL_HERO_ITEMS_DESKTOP;

export function dedupeHeroMediaItems(items: HeroMediaItem[]): HeroMediaItem[] {
    const unique = new Map<string, HeroMediaItem>();
    for (const item of items) {
        const key = `${item.type}:${item.src}`;
        const existing = unique.get(key);
        if (!existing) {
            unique.set(key, item);
            continue;
        }

        unique.set(key, {
            ...item,
            alt: item.alt ?? existing.alt,
            bookingHotspot: item.bookingHotspot ?? existing.bookingHotspot,
        });
    }
    return [...unique.values()];
}
