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
        alt: "Botox 3 Regiões (40ui) e Botox Full Face",
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-02.png",
        alt: "Festival do Preenchimento",
    },
    {
        type: "image",
        src: "/images/hero/desktop/banner-03.png",
        alt: "Carnaval beleza - Brilhe de dentro para fora",
    },
];

export const LOCAL_HERO_ITEMS_MOBILE: HeroMediaItem[] = [
    {
        type: "image",
        src: "/images/hero/mobile/banner-01-optimized.jpg",
        alt: "Espaco Facial mobile banner",
    },
    ...Array.from({ length: 26 }, (_, idx) => ({
        type: "image" as const,
        src: `/images/hero/mobile/banner-${String(idx + 2).padStart(2, "0")}.png`,
        alt: "Espaco Facial mobile banner",
    })),
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
