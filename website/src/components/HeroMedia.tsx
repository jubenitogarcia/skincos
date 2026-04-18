"use client";

import TrackedBookingLink from "@/components/TrackedBookingLink";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { getLocalHeroItems, normalizeHeroUnitSlug, type HeroMediaItem, type HeroMediaVariant } from "@/lib/heroMediaShared";
import { getStoredUnitSlug } from "@/lib/unitSelection";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type HeroMediaProps = {
    initialItems?: HeroMediaItem[];
    initialVariant?: HeroMediaVariant;
    initialUnitSlug?: string | null;
};

const HERO_AUTOPLAY_MS = 6000;
const HERO_TRANSITION_MS = 560;
const HERO_DEFAULT_FRAME_COLOR = "#050505";
const HERO_LIGHT_TEXT_COLOR = "#f5ead8";
const HERO_DARK_TEXT_COLOR = "#1f1f1f";
const HERO_DEFAULT_FRAME_COLORS = {
    top: HERO_DEFAULT_FRAME_COLOR,
    bottom: HERO_DEFAULT_FRAME_COLOR,
} as const;
const EMPTY_HERO_ITEMS: HeroMediaItem[] = [];

type HeroFrameColors = {
    top: string;
    bottom: string;
};

function clampColorChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexColor(r: number, g: number, b: number): string {
    const toHex = (value: number) => clampColorChannel(value).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
    const raw = (value ?? "").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
    return {
        r: Number.parseInt(raw.slice(0, 2), 16),
        g: Number.parseInt(raw.slice(2, 4), 16),
        b: Number.parseInt(raw.slice(4, 6), 16),
    };
}

function relativeLuminance(colorHex: string): number {
    const parsed = parseHexColor(colorHex);
    if (!parsed) return 0;

    const toLinear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    const r = toLinear(parsed.r);
    const g = toLinear(parsed.g);
    const b = toLinear(parsed.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pickBandTextColor(backgroundHex: string): string {
    return relativeLuminance(backgroundHex) > 0.42 ? HERO_DARK_TEXT_COLOR : HERO_LIGHT_TEXT_COLOR;
}

function campaignKey(variant: HeroMediaVariant, unitSlug: string | null | undefined): string {
    const normalizedUnit = normalizeHeroUnitSlug(unitSlug);
    return `${variant}:${normalizedUnit || "default"}`;
}

function extractTopBottomEdgeColorsFromImage(src: string): Promise<HeroFrameColors | null> {
    return new Promise((resolve) => {
        if (typeof window === "undefined") {
            resolve(null);
            return;
        }

        const image = new window.Image();
        image.decoding = "async";
        image.crossOrigin = "anonymous";

        image.onload = () => {
            try {
                const sampleSize = 24;
                const canvas = document.createElement("canvas");
                canvas.width = sampleSize;
                canvas.height = sampleSize;

                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) {
                    resolve(null);
                    return;
                }

                ctx.drawImage(image, 0, 0, sampleSize, sampleSize);
                const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

                let topR = 0;
                let topG = 0;
                let topB = 0;
                let topWeight = 0;
                let bottomR = 0;
                let bottomG = 0;
                let bottomB = 0;
                let bottomWeight = 0;

                const edgeBand = 3;

                for (let y = 0; y < sampleSize; y += 1) {
                    for (let x = 0; x < sampleSize; x += 1) {
                        const idx = (y * sampleSize + x) * 4;
                        const alpha = data[idx + 3] / 255;
                        if (alpha < 0.14) continue;

                        if (y < edgeBand) {
                            topR += data[idx] * alpha;
                            topG += data[idx + 1] * alpha;
                            topB += data[idx + 2] * alpha;
                            topWeight += alpha;
                        }

                        if (y >= sampleSize - edgeBand) {
                            bottomR += data[idx] * alpha;
                            bottomG += data[idx + 1] * alpha;
                            bottomB += data[idx + 2] * alpha;
                            bottomWeight += alpha;
                        }
                    }
                }

                if (topWeight <= 0 || bottomWeight <= 0) {
                    resolve(null);
                    return;
                }

                resolve({
                    top: toHexColor(topR / topWeight, topG / topWeight, topB / topWeight),
                    bottom: toHexColor(bottomR / bottomWeight, bottomG / bottomWeight, bottomB / bottomWeight),
                });
            } catch {
                resolve(null);
            }
        };

        image.onerror = () => resolve(null);
        image.src = src;
    });
}

export default function HeroMedia({ initialItems, initialVariant, initialUnitSlug = null }: HeroMediaProps) {
    const unit = useCurrentUnit();
    const [index, setIndex] = useState(0);
    const [prevIndex, setPrevIndex] = useState<number | null>(null);
    const [queuedIndex, setQueuedIndex] = useState<number | null>(null);
    const [aspectRatio, setAspectRatio] = useState<string>("16 / 9");
    const [frameColors, setFrameColors] = useState<HeroFrameColors>(HERO_DEFAULT_FRAME_COLORS);
    const [pendingFrameColors, setPendingFrameColors] = useState<HeroFrameColors | null>(null);
    const [readyImageSrcs, setReadyImageSrcs] = useState<Record<string, true>>({});
    const [variant, setVariant] = useState<HeroMediaVariant>(initialVariant ?? "desktop");
    const hasInitialItems = Array.isArray(initialItems) && initialItems.length > 0;
    const topBandTextColor = useMemo(() => pickBandTextColor(frameColors.top), [frameColors.top]);
    const bottomBandTextColor = useMemo(() => pickBandTextColor(frameColors.bottom), [frameColors.bottom]);

    type HeroStyle = CSSProperties &
        Record<
            "--hero-ar" | "--hero-band-bg" | "--hero-band-bg-top" | "--hero-band-bg-bottom" | "--hero-cta-left" | "--hero-cta-top" | "--hero-cta-width" | "--hero-cta-height",
            string
        >;
    useEffect(() => {
        if (Array.isArray(initialItems) && initialItems.length) return;
        if (typeof window === "undefined") return;
        const mql = window.matchMedia("(max-width: 900px)");
        const update = () => setVariant(mql.matches ? "mobile" : "desktop");
        update();
        if (typeof mql.addEventListener === "function") {
            mql.addEventListener("change", update);
            return () => mql.removeEventListener("change", update);
        }
        mql.addListener(update);
        return () => mql.removeListener(update);
    }, [initialItems]);

    const [items, setItems] = useState<HeroMediaItem[]>(() => {
        const startupStoredUnitSlug = typeof window === "undefined" ? null : getStoredUnitSlug();
        const startupTargetUnitSlug = startupStoredUnitSlug ?? initialUnitSlug ?? null;
        const startupCampaignKey = campaignKey(variant, startupTargetUnitSlug);
        const initialCampaignKey = campaignKey(variant, initialUnitSlug ?? null);
        const canHydrateInitialItems = hasInitialItems && startupCampaignKey === initialCampaignKey;
        if (canHydrateInitialItems) return initialItems;
        return getLocalHeroItems(variant, { unitSlug: startupTargetUnitSlug });
    });
    const [loadedCampaignKey, setLoadedCampaignKey] = useState<string>(() => {
        const startupStoredUnitSlug = typeof window === "undefined" ? null : getStoredUnitSlug();
        const startupTargetUnitSlug = startupStoredUnitSlug ?? initialUnitSlug ?? null;
        return campaignKey(variant, startupTargetUnitSlug);
    });

    const storedUnitSlug = typeof window === "undefined" ? null : getStoredUnitSlug();
    const targetUnitSlug = unit?.slug ?? storedUnitSlug ?? initialUnitSlug ?? null;
    const targetCampaignKey = campaignKey(variant, targetUnitSlug);
    const initialCampaignKey = campaignKey(variant, initialUnitSlug ?? null);
    const visibleItems = loadedCampaignKey === targetCampaignKey ? items : EMPTY_HERO_ITEMS;

    const markImageReady = useCallback((src: string) => {
        if (!src) return;
        setReadyImageSrcs((current) => {
            if (current[src]) return current;
            return {
                ...current,
                [src]: true,
            };
        });
    }, []);

    const preloadImage = useCallback(
        (src: string) => {
            if (typeof window === "undefined" || !src || readyImageSrcs[src]) return;

            const image = new window.Image();
            image.decoding = "async";
            image.onload = () => markImageReady(src);
            image.onerror = () => markImageReady(src);
            image.src = src;

            if (typeof image.decode === "function") {
                void image.decode().then(
                    () => markImageReady(src),
                    () => markImageReady(src),
                );
            }
        },
        [markImageReady, readyImageSrcs],
    );

    useEffect(() => {
        let cancelled = false;

        const shouldUseInitialItems = hasInitialItems && targetCampaignKey === initialCampaignKey;

        if (shouldUseInitialItems) {
            setItems(initialItems);
            setLoadedCampaignKey(targetCampaignKey);
            return;
        }

        const fallbackItems = getLocalHeroItems(variant, { unitSlug: targetUnitSlug });

        // Avoid flashing stale campaign while the new one is loading.
        setItems([]);
        setLoadedCampaignKey("");

        async function loadItemsByUnit() {
            try {
                const query = new URLSearchParams({ variant });
                if (targetUnitSlug) query.set("unit", targetUnitSlug);
                const response = await fetch(`/api/hero-media?${query.toString()}`, { cache: "no-store" });
                if (!response.ok) throw new Error(`hero_media_http_${response.status}`);

                const payload = (await response.json()) as { items?: HeroMediaItem[] };
                const nextItems = Array.isArray(payload.items) && payload.items.length > 0 ? payload.items : fallbackItems;
                if (!cancelled) {
                    setItems(nextItems);
                    setLoadedCampaignKey(targetCampaignKey);
                }
            } catch {
                if (!cancelled) {
                    setItems(fallbackItems);
                    setLoadedCampaignKey(targetCampaignKey);
                }
            }
        }

        void loadItemsByUnit();

        return () => {
            cancelled = true;
        };
    }, [hasInitialItems, initialCampaignKey, initialItems, targetCampaignKey, targetUnitSlug, variant]);

    const effectiveVariant = initialVariant ?? variant;

    useEffect(() => {
        setIndex(0);
        setPrevIndex(null);
        setQueuedIndex(null);
    }, [visibleItems]);

    useEffect(() => {
        visibleItems.forEach((heroItem) => {
            if (heroItem.type !== "image") return;
            preloadImage(heroItem.src);
        });
    }, [preloadImage, visibleItems]);

    const item = visibleItems[index] ?? visibleItems[0] ?? null;
    const shouldLoopVideo = item?.type === "video" && visibleItems.length === 1;
    const imageFit = effectiveVariant === "mobile" ? "cover" : "contain";
    const bookingHref = useMemo(() => {
        if (!unit?.slug) return "/agendamento?doctor=none#booking-flow";
        return `/agendamento?unit=${encodeURIComponent(unit.slug)}&doctor=none#booking-flow`;
    }, [unit?.slug]);

    const goTo = useCallback(
        (nextIndex: number) => {
            if (visibleItems.length <= 1) return;
            if (prevIndex !== null) return;
            if (nextIndex === index) return;
            if (nextIndex < 0 || nextIndex >= visibleItems.length) return;
            const nextItem = visibleItems[nextIndex];
            if (!nextItem) return;

            if (nextItem.type === "image" && !readyImageSrcs[nextItem.src]) {
                preloadImage(nextItem.src);
                setQueuedIndex(nextIndex);
                return;
            }

            setQueuedIndex(null);
            setPrevIndex(index);
            setIndex(nextIndex);
        },
        [index, preloadImage, prevIndex, readyImageSrcs, visibleItems],
    );

    const goNext = useCallback(() => {
        goTo((index + 1) % visibleItems.length);
    }, [goTo, index, visibleItems.length]);

    const goPrev = useCallback(() => {
        goTo((index - 1 + visibleItems.length) % visibleItems.length);
    }, [goTo, index, visibleItems.length]);

    useEffect(() => {
        if (prevIndex === null) return;
        const t = window.setTimeout(() => setPrevIndex(null), HERO_TRANSITION_MS);
        return () => window.clearTimeout(t);
    }, [prevIndex]);

    useEffect(() => {
        if (queuedIndex === null) return;
        const queuedItem = visibleItems[queuedIndex];
        if (!queuedItem) {
            setQueuedIndex(null);
            return;
        }
        if (queuedItem.type === "image" && !readyImageSrcs[queuedItem.src]) return;
        if (queuedIndex === index) {
            setQueuedIndex(null);
            return;
        }
        setPrevIndex(index);
        setIndex(queuedIndex);
        setQueuedIndex(null);
    }, [index, queuedIndex, readyImageSrcs, visibleItems]);

    useEffect(() => {
        if (prevIndex !== null || !pendingFrameColors) return;
        setFrameColors(pendingFrameColors);
        setPendingFrameColors(null);
    }, [pendingFrameColors, prevIndex]);

    useEffect(() => {
        const canAutoAdvance = visibleItems.length > 1 && item?.type === "image" && effectiveVariant !== "mobile";
        if (!canAutoAdvance) return;

        const t = window.setTimeout(() => {
            goNext();
        }, HERO_AUTOPLAY_MS);

        return () => window.clearTimeout(t);
    }, [effectiveVariant, goNext, visibleItems.length, item?.type]);

    const canAutoAdvance = visibleItems.length > 1 && item?.type === "image" && effectiveVariant !== "mobile";

    useEffect(() => {
        let cancelled = false;

        if (!item || item.type !== "image") {
            if (prevIndex !== null) {
                setPendingFrameColors(HERO_DEFAULT_FRAME_COLORS);
            } else {
                setFrameColors(HERO_DEFAULT_FRAME_COLORS);
                setPendingFrameColors(null);
            }
            return () => {
                cancelled = true;
            };
        }

        void extractTopBottomEdgeColorsFromImage(item.src).then((nextColors) => {
            if (cancelled) return;
            const resolvedColors = nextColors ?? HERO_DEFAULT_FRAME_COLORS;
            if (prevIndex !== null) {
                setPendingFrameColors(resolvedColors);
            } else {
                setFrameColors(resolvedColors);
                setPendingFrameColors(null);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [item, prevIndex]);

    useEffect(() => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        root.style.setProperty("--hero-band-bg-top-live", frameColors.top);
        root.style.setProperty("--hero-band-bg-bottom-live", frameColors.bottom);
        root.style.setProperty("--hero-band-fg-top-live", topBandTextColor);
        root.style.setProperty("--hero-band-fg-bottom-live", bottomBandTextColor);
    }, [bottomBandTextColor, frameColors.bottom, frameColors.top, topBandTextColor]);

    useEffect(() => {
        if (typeof document === "undefined") return undefined;
        const root = document.documentElement;
        return () => {
            root.style.removeProperty("--hero-band-bg-top-live");
            root.style.removeProperty("--hero-band-bg-bottom-live");
            root.style.removeProperty("--hero-band-fg-top-live");
            root.style.removeProperty("--hero-band-fg-bottom-live");
        };
    }, []);

    const style = useMemo<HeroStyle>(() => {
        const hotspot = item?.bookingHotspot;
        return {
            "--hero-ar": aspectRatio,
            "--hero-band-bg": frameColors.top,
            "--hero-band-bg-top": frameColors.top,
            "--hero-band-bg-bottom": frameColors.bottom,
            "--hero-cta-left": hotspot ? `${hotspot.leftPct}%` : "0%",
            "--hero-cta-top": hotspot ? `${hotspot.topPct}%` : "0%",
            "--hero-cta-width": hotspot ? `${hotspot.widthPct}%` : "0%",
            "--hero-cta-height": hotspot ? `${hotspot.heightPct}%` : "0%",
        };
    }, [aspectRatio, frameColors.bottom, frameColors.top, item?.bookingHotspot]);

    const renderLayer = (layerItem: HeroMediaItem, opts: { layerKey: string; kind: "active" | "prev" }) => {
        const layerClass =
            opts.kind === "active"
                ? `heroMediaLayer heroMediaLayer--active${prevIndex !== null ? " heroMediaLayer--enter" : ""}`
                : "heroMediaLayer heroMediaLayer--prev";

        return (
            <div key={opts.layerKey} className={layerClass}>
                {layerItem.type === "video" ? (
                    <video
                        className="heroMediaEl"
                        src={layerItem.src}
                        autoPlay={opts.kind === "active"}
                        muted
                        loop={opts.kind === "active" ? shouldLoopVideo : false}
                        playsInline
                        preload="metadata"
                        onError={() => {
                            if (visibleItems.length <= 1) return;
                            if (opts.kind !== "active") return;
                            goNext();
                        }}
                        onLoadedMetadata={(e) => {
                            if (opts.kind !== "active") return;
                            const v = e.currentTarget;
                            if (v.videoWidth > 0 && v.videoHeight > 0) {
                                setAspectRatio(`${v.videoWidth} / ${v.videoHeight}`);
                            }
                        }}
                        onEnded={() => {
                            if (visibleItems.length <= 1) return;
                            if (opts.kind !== "active") return;
                            goNext();
                        }}
                    />
                ) : (
                    <Image
                        className="heroMediaEl"
                        src={layerItem.src}
                        alt={layerItem.alt ?? "Espaço Facial"}
                        fill
                        priority={opts.kind === "active"}
                        sizes="100vw"
                        onError={() => {
                            if (visibleItems.length <= 1) return;
                            if (opts.kind !== "active") return;
                            goNext();
                        }}
                        onLoad={(event) => {
                            if (opts.kind !== "active") return;
                            const img = event.currentTarget;
                            markImageReady(layerItem.src);
                            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                                setAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
                            }
                        }}
                        style={{ objectFit: imageFit, background: `linear-gradient(180deg, ${frameColors.top}, ${frameColors.bottom})` }}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="heroMedia" style={style}>
            {visibleItems.length > 1 ? (
                <>
                    <div className="heroHoverZone heroHoverZone--left" aria-hidden="true" />
                    <button type="button" className="heroArrow carouselNavChrome heroArrow--left" aria-label="Anterior" onClick={goPrev}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <div className="heroHoverZone heroHoverZone--right" aria-hidden="true" />
                    <button type="button" className="heroArrow carouselNavChrome heroArrow--right" aria-label="Próximo" onClick={goNext}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </>
            ) : null}

            {item ? renderLayer(item, { layerKey: `active:${item.src}`, kind: "active" }) : null}
            {prevIndex !== null && visibleItems[prevIndex] ? renderLayer(visibleItems[prevIndex]!, { layerKey: `prev:${visibleItems[prevIndex]!.src}:${prevIndex}`, kind: "prev" }) : null}

            {item?.bookingHotspot ? (
                <TrackedBookingLink
                    href={bookingHref}
                    className="heroBannerCtaHotspot"
                    placement="hero_banner"
                    unitSlug={unit?.slug ?? null}
                    experience="hero_media"
                    variant={effectiveVariant}
                    aria-label={unit?.name ? `Ir para o agendamento da unidade ${unit.name}` : "Ir para a página de agendamento"}
                >
                    <span className="srOnly">Garanta o seu</span>
                </TrackedBookingLink>
            ) : null}

            {visibleItems.length > 1 ? (
                <div className="heroMediaNav" aria-label="Selecionar mídia do banner">
                    {visibleItems.map((_, i) => {
                        const active = i === index;
                        return (
                            <button
                                key={i}
                                type="button"
                                className={`heroDot${active ? " heroDot--active" : ""}`}
                                aria-label={`Ir para ${i + 1} de ${visibleItems.length}`}
                                aria-pressed={active}
                                onClick={() => goTo(i)}
                            >
                                <span className="heroDot__core" aria-hidden="true" />
                                {active && canAutoAdvance ? (
                                    <span
                                        className="heroDotProgress"
                                        aria-hidden="true"
                                        style={{ "--hero-dot-progress-ms": `${HERO_AUTOPLAY_MS}ms` } as CSSProperties}
                                    >
                                        <svg viewBox="0 0 20 20" aria-hidden="true">
                                            <circle className="heroDotProgress__track" cx="10" cy="10" r="8" />
                                            <circle className="heroDotProgress__value" cx="10" cy="10" r="8" />
                                        </svg>
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
