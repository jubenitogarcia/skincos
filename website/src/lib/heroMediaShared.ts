export type HeroMediaItem = {
    type: "image" | "video";
    src: string;
    alt?: string;
};

export type HeroMediaVariant = "desktop" | "mobile";

export const LOCAL_HERO_ITEMS_DESKTOP: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/desktop/banner-01.png",
        alt: "Mês do Consumidor - Preenchimento 2mL",
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-02.png",
        alt: "Mês do Consumidor - Preenchimento com Lavieen",
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-03.png",
        alt: "Mês do Consumidor - Combo exclusivo de preenchimento",
    },
];

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/mobile/banner-01-optimized.jpg",
        alt: "Mês do Consumidor - Preenchimento 2mL",
    },
    {
        type: "image",
        src: "/images/hero/mobile/banner-02.png",
        alt: "Mês do Consumidor - Preenchimento com Lavieen",
    },
    {
        type: "image",
        src: "/images/hero/mobile/banner-03.png",
        alt: "Mês do Consumidor - Combo exclusivo de preenchimento",
    },
];

export function getLocalHeroItems(variant: HeroMediaVariant): HeroMediaItem[] {
    return variant === "mobile" ? LOCAL_HERO_ITEMS_MOBILE : LOCAL_HERO_ITEMS_DESKTOP;
}

export const LOCAL_HERO_ITEMS = LOCAL_HERO_ITEMS_DESKTOP;

export function dedupeHeroMediaItems(items: HeroMediaItem[]): HeroMediaItem[] {
    const unique = new Map<string, HeroMediaItem>();
    for (const item of items) {
        unique.set(`${item.type}:${item.src}`, item);
    }
    return [...unique.values()];
}
