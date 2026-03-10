"use client";

import { getLocalHeroItems, type HeroMediaItem, type HeroMediaVariant } from "@/lib/heroMediaShared";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type HeroMediaProps = {
    initialItems?: HeroMediaItem[];
    initialVariant?: HeroMediaVariant;
};

export default function HeroMedia({ initialItems, initialVariant }: HeroMediaProps) {
    const [index, setIndex] = useState(0);
    const [prevIndex, setPrevIndex] = useState<number | null>(null);
    const [aspectRatio, setAspectRatio] = useState<string>("16 / 9");
    const [variant, setVariant] = useState<HeroMediaVariant>("desktop");

    type HeroStyle = CSSProperties & Record<"--hero-ar", string>;
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
        if (items.length <= 1) return;
        if (item.type !== "image") return;
        if (effectiveVariant === "mobile") return;

        const t = window.setTimeout(() => {
            goNext();
        }, 6000);

        return () => window.clearTimeout(t);
    }, [effectiveVariant, goNext, items.length, item.type]);

    const style = useMemo<HeroStyle>(() => {
        return { "--hero-ar": aspectRatio };
    }, [aspectRatio]);

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
                        unoptimized
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
                        style={{ objectFit: "cover" }}
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
                    <button type="button" className="heroArrow heroArrow--left" aria-label="Anterior" onClick={goPrev}>
                        <span aria-hidden="true">‹</span>
                    </button>
                    <div className="heroHoverZone heroHoverZone--right" aria-hidden="true" />
                    <button type="button" className="heroArrow heroArrow--right" aria-label="Próximo" onClick={goNext}>
                        <span aria-hidden="true">›</span>
                    </button>
                </>
            ) : null}

            {renderLayer(item, { layerKey: `active:${item.src}`, kind: "active" })}
            {prevIndex !== null && items[prevIndex] ? renderLayer(items[prevIndex]!, { layerKey: `prev:${items[prevIndex]!.src}:${prevIndex}`, kind: "prev" }) : null}

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
                            />
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
