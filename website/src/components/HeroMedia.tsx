"use client";

import TrackedBookingLink from "@/components/TrackedBookingLink";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { getLocalHeroItems, type HeroMediaItem, type HeroMediaVariant } from "@/lib/heroMediaShared";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type HeroMediaProps = {
    initialItems?: HeroMediaItem[];
    initialVariant?: HeroMediaVariant;
};

const HERO_AUTOPLAY_MS = 6000;

export default function HeroMedia({ initialItems, initialVariant }: HeroMediaProps) {
    const unit = useCurrentUnit();
    const [index, setIndex] = useState(0);
    const [prevIndex, setPrevIndex] = useState<number | null>(null);
    const [aspectRatio, setAspectRatio] = useState<string>("16 / 9");
    const [variant, setVariant] = useState<HeroMediaVariant>(initialVariant ?? "desktop");

    type HeroStyle = CSSProperties &
        Record<
            "--hero-ar" | "--hero-cta-left" | "--hero-cta-top" | "--hero-cta-width" | "--hero-cta-height",
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

    const items = useMemo(() => {
        if (Array.isArray(initialItems) && initialItems.length) return initialItems;
        return getLocalHeroItems(variant);
    }, [initialItems, variant]);
    const effectiveVariant = initialVariant ?? variant;

    useEffect(() => {
        setIndex(0);
        setPrevIndex(null);
    }, [items]);

    const item = items[index] ?? items[0]!;
    const shouldLoopVideo = item.type === "video" && items.length === 1;
    const imageFit = effectiveVariant === "mobile" ? "cover" : "contain";
    const bookingHref = useMemo(() => {
        if (!unit?.slug) return "/agendamento?doctor=none#booking-flow";
        return `/agendamento?unit=${encodeURIComponent(unit.slug)}&doctor=none#booking-flow`;
    }, [unit?.slug]);

    const goTo = useCallback(
        (nextIndex: number) => {
            if (items.length <= 1) return;
            if (nextIndex === index) return;
            if (nextIndex < 0 || nextIndex >= items.length) return;
            setPrevIndex(index);
            setIndex(nextIndex);
        },
        [index, items.length],
    );

    const goNext = useCallback(() => {
        goTo((index + 1) % items.length);
    }, [goTo, index, items.length]);

    const goPrev = useCallback(() => {
        goTo((index - 1 + items.length) % items.length);
    }, [goTo, index, items.length]);

    useEffect(() => {
        if (prevIndex === null) return;
        const t = window.setTimeout(() => setPrevIndex(null), 650);
        return () => window.clearTimeout(t);
    }, [prevIndex]);

    useEffect(() => {
        const canAutoAdvance = items.length > 1 && item.type === "image" && effectiveVariant !== "mobile";
        if (!canAutoAdvance) return;

        const t = window.setTimeout(() => {
            goNext();
        }, HERO_AUTOPLAY_MS);

        return () => window.clearTimeout(t);
    }, [effectiveVariant, goNext, items.length, item.type]);

    const canAutoAdvance = items.length > 1 && item.type === "image" && effectiveVariant !== "mobile";

    const style = useMemo<HeroStyle>(() => {
        const hotspot = item.bookingHotspot;
        return {
            "--hero-ar": aspectRatio,
            "--hero-cta-left": hotspot ? `${hotspot.leftPct}%` : "0%",
            "--hero-cta-top": hotspot ? `${hotspot.topPct}%` : "0%",
            "--hero-cta-width": hotspot ? `${hotspot.widthPct}%` : "0%",
            "--hero-cta-height": hotspot ? `${hotspot.heightPct}%` : "0%",
        };
    }, [aspectRatio, item.bookingHotspot]);

    const shouldAnimateIn = prevIndex !== null;

    const renderLayer = (layerItem: HeroMediaItem, opts: { layerKey: string; kind: "active" | "prev" }) => {
        const layerClass =
            opts.kind === "active"
                ? `heroMediaLayer heroMediaLayer--active${shouldAnimateIn ? " heroMediaLayer--fadeIn" : ""}`
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
                            if (items.length <= 1) return;
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
                            if (items.length <= 1) return;
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
                            if (items.length <= 1) return;
                            if (opts.kind !== "active") return;
                            goNext();
                        }}
                        onLoad={(event) => {
                            if (opts.kind !== "active") return;
                            const img = event.currentTarget;
                            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                                setAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
                            }
                        }}
                        style={{ objectFit: imageFit, backgroundColor: "#050505" }}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="heroMedia" style={style}>
            {items.length > 1 ? (
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

            {renderLayer(item, { layerKey: `active:${item.src}`, kind: "active" })}
            {prevIndex !== null && items[prevIndex] ? renderLayer(items[prevIndex]!, { layerKey: `prev:${items[prevIndex]!.src}:${prevIndex}`, kind: "prev" }) : null}

            {item.bookingHotspot ? (
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

            {items.length > 1 ? (
                <div className="heroMediaNav" aria-label="Selecionar mídia do banner">
                    {items.map((_, i) => {
                        const active = i === index;
                        return (
                            <button
                                key={i}
                                type="button"
                                className={`heroDot${active ? " heroDot--active" : ""}`}
                                aria-label={`Ir para ${i + 1} de ${items.length}`}
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
