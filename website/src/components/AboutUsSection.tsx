"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import type { Unit } from "@/data/units";
import Image from "next/image";
import { trackEvent } from "@/lib/analytics";
import { trackBookingStart } from "@/lib/leadTracking";
import UnitQuickButtons from "@/components/UnitQuickButtons";

type PlaceDetailsPayload = {
    available: boolean;
    error?: string;
    placeId?: string | null;
    name?: string | null;
    address?: string | null;
    rating?: number | null;
    userRatingsTotal?: number | null;
    mapsUrl?: string | null;
    website?: string | null;
    location?: { lat: number | null; lng: number | null };
    photos?: Array<{ photoReference: string; width: number | null; height: number | null }>;
    reviews?: Array<{ authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>;
};

type GbpPhotosPayload = {
    available: boolean;
    items?: Array<{ name: string; thumbnailUrl: string; googleUrl: string | null }>;
    nextPageToken?: string | null;
    error?: string;
};

type GbpReviewsPayload = {
    available: boolean;
    reviews?: Array<{ reviewId: string; authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>;
    nextPageToken?: string | null;
    error?: string;
};

type ReviewSort = "newest" | "highest" | "lowest";

function shouldFallbackFromGbp(error: string | null | undefined): boolean {
    const e = (error ?? "").trim();
    if (!e) return false;
    if (e.startsWith("missing_gbp_")) return true;
    if (e === "oauth_refresh_failed") return true;
    if (e === "missing_access_token") return true;
    return false;
}

function buildDefaultQuery(): string {
    return "Espaço Facial";
}

function buildQueryForUnit(unit: Unit | null): string {
    if (!unit) return buildDefaultQuery();

    const parts: string[] = [];
    parts.push("Espaço Facial");
    if (unit.name) parts.push(unit.name);
    if (unit.addressLine) parts.push(unit.addressLine);
    if (unit.state) parts.push(unit.state);
    parts.push("Brasil");

    const query = parts.filter(Boolean).join(", ");
    return query || buildDefaultQuery();
}

function getGoogleMapsEmbedUrl(query: string): string {
    const q = encodeURIComponent(query);
    return `https://www.google.com/maps?q=${q}&z=15&output=embed`;
}

function getGoogleMapsEmbedUrlForLatLng(lat: number, lng: number, zoom = 16): string {
    // Lat/Lng ensures the embed is centered correctly (avoids world-zoom glitches).
    const q = encodeURIComponent(`${lat},${lng}`);
    return `https://www.google.com/maps?q=${q}&z=${zoom}&output=embed`;
}

function buildEmbedQuery(data: PlaceDetailsPayload | null, unit: Unit | null, fallbackQuery: string): string {
    const name = (data?.name ?? "").trim();
    const address = (data?.address ?? unit?.addressLine ?? "").trim();

    const joined = [name, address].filter(Boolean).join(" - ").trim();
    if (joined) return joined;

    return fallbackQuery;
}

function clampRating(value: number | null | undefined): number {
    const n = typeof value === "number" ? value : 0;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
}

function Stars({ rating }: { rating: number | null | undefined }) {
    const r = clampRating(rating);
    const full = Math.floor(r);
    const hasHalf = r - full >= 0.35 && r - full < 0.8;
    const empty = 5 - full - (hasHalf ? 1 : 0);

    return (
        <div className="aboutStars" aria-label={`Avaliação ${r.toFixed(1)} de 5`}>
            {Array.from({ length: full }).map((_, i) => (
                <span key={`f${i}`} className="star full" aria-hidden>
                    ★
                </span>
            ))}
            {hasHalf ? (
                <span className="star half" aria-hidden>
                    ★
                </span>
            ) : null}
            {Array.from({ length: empty }).map((_, i) => (
                <span key={`e${i}`} className="star empty" aria-hidden>
                    ★
                </span>
            ))}
        </div>
    );
}

export default function AboutUsSection() {
    const unit = useCurrentUnit();
    const hasSelectedUnit = Boolean(unit);

    const query = useMemo(() => buildQueryForUnit(unit), [unit]);

    const [data, setData] = useState<PlaceDetailsPayload | null>(null);
    const [loading, setLoading] = useState<boolean>(false);

    const [ratingFilter, setRatingFilter] = useState<number | "all">("all");
    const [onlyWithText, setOnlyWithText] = useState<boolean>(true);
    const [sort, setSort] = useState<ReviewSort>("newest");
    const [search, setSearch] = useState<string>("");

    const reviewsScrollRef = useRef<HTMLDivElement | null>(null);
    const [visibleReviewsCount, setVisibleReviewsCount] = useState<number>(6);

    const photosScrollRef = useRef<HTMLDivElement | null>(null);
    const [visiblePhotosCount, setVisiblePhotosCount] = useState<number>(8);

    const photosAutoScrollTimerRef = useRef<number | null>(null);

    const [gbpPhotos, setGbpPhotos] = useState<Array<{ name: string; thumbnailUrl: string; googleUrl: string | null }>>([]);
    const [gbpPhotosNextToken, setGbpPhotosNextToken] = useState<string | null>(null);
    const [gbpPhotosLoading, setGbpPhotosLoading] = useState<boolean>(false);

    const [gbpReviews, setGbpReviews] = useState<
        Array<{ reviewId: string; authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>
    >([]);
    const [gbpReviewsNextToken, setGbpReviewsNextToken] = useState<string | null>(null);
    const [gbpReviewsLoading, setGbpReviewsLoading] = useState<boolean>(false);
    const [gbpForceFallback, setGbpForceFallback] = useState<boolean>(false);

    const [activePhoto, setActivePhoto] = useState<{ src: string; alt: string; googleUrl?: string | null } | null>(null);

    useEffect(() => {
        if (!activePhoto) return;

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setActivePhoto(null);
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [activePhoto]);

    useEffect(() => {
        let cancelled = false;

        if (!hasSelectedUnit) {
            setData(null);
            setLoading(false);
            return () => {
                cancelled = true;
            };
        }

        async function run() {
            setLoading(true);

            try {
                const url = new URL("/api/places/details", window.location.origin);

                const placeId = unit?.placeId;
                if (typeof placeId === "string" && placeId.trim()) {
                    url.searchParams.set("placeId", placeId.trim());
                } else {
                    url.searchParams.set("query", query);
                }

                const res = await fetch(url.toString(), { cache: "no-store" });
                const json = (await res.json()) as PlaceDetailsPayload;
                if (!cancelled) setData(json);
            } catch {
                if (!cancelled) setData({ available: false, error: "fetch_failed" });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        run();
        return () => {
            cancelled = true;
        };
    }, [hasSelectedUnit, query, unit?.placeId]);

    const title = hasSelectedUnit ? data?.name || unit?.name || "Espaço Facial" : "Selecione uma unidade";
    const address = hasSelectedUnit
        ? data?.address || unit?.addressLine || ""
        : "Selecione uma unidade no cabeçalho para conhecer mais sobre ela.";

    const rating = data?.rating ?? null;
    const total = data?.userRatingsTotal ?? null;

    const selectedPlaceId = (data?.placeId ?? unit?.placeId ?? null)?.toString().trim() || null;
    const agendarUrl = hasSelectedUnit ? unit?.contactUrl || null : null;
    const bookingHref = hasSelectedUnit && unit?.slug ? `/agendamento?unit=${encodeURIComponent(unit.slug)}` : "/agendamento";
    const reviewUrl = hasSelectedUnit && selectedPlaceId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(selectedPlaceId)}` : null;

    const gbpLocation = hasSelectedUnit ? (unit?.gbpLocation ?? "").trim() : "";
    const useGbp = Boolean(gbpLocation) && !gbpForceFallback;

    const embedUrl = useMemo(() => {
        const embedQuery = buildEmbedQuery(data, unit, query);

        // Prefer a descriptive query so the map card shows name/address (not raw coordinates).
        if (embedQuery && embedQuery !== query) {
            return getGoogleMapsEmbedUrl(embedQuery);
        }

        // Fallback: lat/lng gives reliable centering/zoom if we don't have a good label.
        const lat = data?.location?.lat ?? unit?.lat ?? null;
        const lng = data?.location?.lng ?? unit?.lng ?? null;
        if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
            return getGoogleMapsEmbedUrlForLatLng(lat, lng, 16);
        }

        return getGoogleMapsEmbedUrl(query);
    }, [data, unit, query]);

    const buildPlacePhotoUrl = useCallback((ref: string, maxwidth = 1200) => {
        return `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=${maxwidth}`;
    }, []);

    const allPhotos = useMemo(() => (hasSelectedUnit ? data?.photos ?? [] : []), [data?.photos, hasSelectedUnit]);
    const photos = useMemo(() => allPhotos.slice(0, visiblePhotosCount), [allPhotos, visiblePhotosCount]);

    const baseReviews = useMemo(() => {
        if (!hasSelectedUnit) return [];
        const all = useGbp ? gbpReviews : data?.reviews ?? [];

        const normalizedSearch = search.trim().toLowerCase();

        const filtered = all.filter((r) => {
            if (onlyWithText && !(r.text ?? "").trim()) return false;
            if (ratingFilter !== "all" && typeof r.rating === "number" && Math.round(r.rating) !== ratingFilter) return false;
            if (ratingFilter !== "all" && typeof r.rating !== "number") return false;

            if (!normalizedSearch) return true;
            const haystack = `${r.authorName ?? ""} ${r.text ?? ""} ${r.relativeTimeDescription ?? ""}`.toLowerCase();
            return haystack.includes(normalizedSearch);
        });

        const sorted = [...filtered].sort((a, b) => {
            if (sort === "highest") {
                return (b.rating ?? -1) - (a.rating ?? -1);
            }
            if (sort === "lowest") {
                return (a.rating ?? 99) - (b.rating ?? 99);
            }
            const at = a.time ?? 0;
            const bt = b.time ?? 0;
            return bt - at;
        });

        return sorted;
    }, [data?.reviews, gbpReviews, hasSelectedUnit, onlyWithText, ratingFilter, search, sort, useGbp]);

    const reviews = baseReviews;

    const displayedReviews = useMemo(() => reviews.slice(0, visibleReviewsCount), [reviews, visibleReviewsCount]);

    useEffect(() => {
        // Reset pagination when unit or filters change.
        setVisibleReviewsCount(6);
    }, [hasSelectedUnit, selectedPlaceId, ratingFilter, onlyWithText, search, sort]);

    useEffect(() => {
        setVisiblePhotosCount(8);
    }, [hasSelectedUnit, selectedPlaceId]);

    useEffect(() => {
        setActivePhoto(null);
    }, [hasSelectedUnit, selectedPlaceId]);

    useEffect(() => {
        // Reset GBP state on unit change.
        setGbpForceFallback(false);
        setGbpPhotos([]);
        setGbpPhotosNextToken(null);
        setGbpPhotosLoading(false);

        setGbpReviews([]);
        setGbpReviewsNextToken(null);
        setGbpReviewsLoading(false);
    }, [gbpLocation, hasSelectedUnit]);

    const fetchGbpPhotos = useCallback(
        async (token: string | null) => {
            if (!gbpLocation) return;
            if (gbpForceFallback) return;
            if (gbpPhotosLoading) return;
            setGbpPhotosLoading(true);

            try {
                const url = new URL("/api/gbp/photos", window.location.origin);
                url.searchParams.set("location", gbpLocation);
                url.searchParams.set("pageSize", "12");
                if (token) url.searchParams.set("pageToken", token);

                const res = await fetch(url.toString(), { cache: "no-store" });
                const json = (await res.json()) as GbpPhotosPayload;

                if (json?.available) {
                    const items = json.items ?? [];
                    setGbpPhotos((prev) => {
                        const seen = new Set(prev.map((p) => p.thumbnailUrl));
                        const next = items.filter((p) => !seen.has(p.thumbnailUrl));
                        return [...prev, ...next];
                    });
                    setGbpPhotosNextToken((json.nextPageToken ?? null) || null);
                } else {
                    if (shouldFallbackFromGbp(json?.error)) {
                        setGbpForceFallback(true);
                        setGbpPhotos([]);
                        setGbpPhotosNextToken(null);
                    } else {
                        // transient failure: keep existing photos and don't permanently disable GBP
                        setGbpPhotosNextToken(null);
                    }
                }
            } catch {
                setGbpPhotosNextToken(null);
            } finally {
                setGbpPhotosLoading(false);
            }
        },
        [gbpForceFallback, gbpLocation, gbpPhotosLoading],
    );

    const fetchGbpReviews = useCallback(
        async (token: string | null) => {
            if (!gbpLocation) return;
            if (gbpForceFallback) return;
            if (gbpReviewsLoading) return;
            setGbpReviewsLoading(true);

            try {
                const url = new URL("/api/gbp/reviews", window.location.origin);
                url.searchParams.set("location", gbpLocation);
                url.searchParams.set("pageSize", "10");
                if (token) url.searchParams.set("pageToken", token);

                const res = await fetch(url.toString(), { cache: "no-store" });
                const json = (await res.json()) as GbpReviewsPayload;

                if (json?.available) {
                    const items = json.reviews ?? [];
                    setGbpReviews((prev) => {
                        const seen = new Set(prev.map((r) => r.reviewId || `${r.authorName}-${r.time ?? "t"}-${r.text}`));
                        const next = items.filter((r) => !seen.has(r.reviewId || `${r.authorName}-${r.time ?? "t"}-${r.text}`));
                        return [...prev, ...next];
                    });
                    setGbpReviewsNextToken((json.nextPageToken ?? null) || null);
                } else {
                    if (shouldFallbackFromGbp(json?.error)) {
                        setGbpForceFallback(true);
                        setGbpReviews([]);
                        setGbpReviewsNextToken(null);
                    } else {
                        // transient failure: keep existing reviews and don't permanently disable GBP
                        setGbpReviewsNextToken(null);
                    }
                }
            } catch {
                setGbpReviewsNextToken(null);
            } finally {
                setGbpReviewsLoading(false);
            }
        },
        [gbpForceFallback, gbpLocation, gbpReviewsLoading],
    );

    useEffect(() => {
        if (!useGbp) return;
        // initial page
        void fetchGbpPhotos(null);
        void fetchGbpReviews(null);
    }, [fetchGbpPhotos, fetchGbpReviews, useGbp]);

    const loadMoreReviews = useCallback(() => {
        if (useGbp) {
            if (gbpReviewsNextToken && !gbpReviewsLoading) void fetchGbpReviews(gbpReviewsNextToken);
            return;
        }
        setVisibleReviewsCount((c) => {
            if (c >= reviews.length) return c;
            return Math.min(reviews.length, c + 6);
        });
    }, [fetchGbpReviews, gbpReviewsLoading, gbpReviewsNextToken, reviews.length, useGbp]);

    const loadMorePhotos = useCallback(() => {
        if (useGbp) {
            if (gbpPhotosNextToken && !gbpPhotosLoading) void fetchGbpPhotos(gbpPhotosNextToken);
            return;
        }
        setVisiblePhotosCount((c) => {
            if (c >= allPhotos.length) return c;
            return Math.min(allPhotos.length, c + 4);
        });
    }, [allPhotos.length, fetchGbpPhotos, gbpPhotosLoading, gbpPhotosNextToken, useGbp]);

    const maybeLoadMoreReviews = useCallback(() => {
        const el = reviewsScrollRef.current;
        if (!el) return;
        if (useGbp) {
            if (!gbpReviewsNextToken || gbpReviewsLoading) return;
        } else if (visibleReviewsCount >= reviews.length) {
            return;
        }
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 220;
        if (nearBottom) loadMoreReviews();
    }, [gbpReviewsLoading, gbpReviewsNextToken, loadMoreReviews, reviews.length, useGbp, visibleReviewsCount]);

    const maybeLoadMorePhotos = useCallback(() => {
        const el = photosScrollRef.current;
        if (!el) return;
        if (useGbp) {
            if (!gbpPhotosNextToken || gbpPhotosLoading) return;
        } else if (visiblePhotosCount >= allPhotos.length) {
            return;
        }
        const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 260;
        if (nearEnd) loadMorePhotos();
    }, [allPhotos.length, gbpPhotosLoading, gbpPhotosNextToken, loadMorePhotos, useGbp, visiblePhotosCount]);

    useEffect(() => {
        const el = reviewsScrollRef.current;
        if (!el) return;
        const onScroll = () => maybeLoadMoreReviews();
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [maybeLoadMoreReviews]);

    useEffect(() => {
        const el = photosScrollRef.current;
        if (!el) return;
        const onScroll = () => maybeLoadMorePhotos();
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [maybeLoadMorePhotos]);

    useEffect(() => {
        // If the list still doesn't overflow, keep loading until it does (or we reach the end).
        const el = reviewsScrollRef.current;
        if (!el) return;
        if (useGbp) {
            if (gbpReviewsNextToken && !gbpReviewsLoading && el.scrollHeight <= el.clientHeight + 20) {
                loadMoreReviews();
            }
            return;
        }
        if (visibleReviewsCount >= reviews.length) return;
        if (el.scrollHeight <= el.clientHeight + 20) {
            loadMoreReviews();
        }
    }, [gbpReviewsLoading, gbpReviewsNextToken, loadMoreReviews, reviews.length, useGbp, visibleReviewsCount]);

    useEffect(() => {
        const el = photosScrollRef.current;
        if (!el) return;
        if (useGbp) {
            if (gbpPhotosNextToken && !gbpPhotosLoading && el.scrollWidth <= el.clientWidth + 20) {
                loadMorePhotos();
            }
            return;
        }
        if (visiblePhotosCount >= allPhotos.length) return;
        if (el.scrollWidth <= el.clientWidth + 20) {
            loadMorePhotos();
        }
    }, [allPhotos.length, gbpPhotosLoading, gbpPhotosNextToken, loadMorePhotos, useGbp, visiblePhotosCount]);

    const stopPhotosAutoScroll = useCallback(() => {
        if (photosAutoScrollTimerRef.current) {
            window.clearInterval(photosAutoScrollTimerRef.current);
            photosAutoScrollTimerRef.current = null;
        }
    }, []);

    const startPhotosAutoScroll = useCallback(
        (direction: "left" | "right") => {
            stopPhotosAutoScroll();
            const el = photosScrollRef.current;
            if (!el) return;

            photosAutoScrollTimerRef.current = window.setInterval(() => {
                const node = photosScrollRef.current;
                if (!node) return;
                const delta = direction === "right" ? 12 : -12;
                node.scrollBy({ left: delta, behavior: "auto" });
                maybeLoadMorePhotos();
            }, 16);
        },
        [maybeLoadMorePhotos, stopPhotosAutoScroll],
    );

    const scrollPhotosBy = useCallback((direction: "left" | "right") => {
        const el = photosScrollRef.current;
        if (!el) return;
        const amount = Math.max(240, Math.floor(el.clientWidth * 0.85));
        el.scrollBy({ left: direction === "right" ? amount : -amount, behavior: "smooth" });
    }, []);

    useEffect(() => {
        return () => stopPhotosAutoScroll();
    }, [stopPhotosAutoScroll]);

    return (
        <section id="sobre-nos" className="pageSection" style={{ marginTop: 50 }}>
            <h2 className="sectionTitle">Sobre Nós</h2>
            <p className="sectionSub">
                {hasSelectedUnit
                    ? "Conheça nossa unidade, veja avaliações e algumas fotos."
                    : "Selecione uma unidade para conhecer mais sobre nós."}
            </p>
            {!hasSelectedUnit ? <UnitQuickButtons placement="about_us_quick" /> : null}

            {!hasSelectedUnit ? null : (
                <div className="aboutGrid">
                    <div className="aboutPhotosRow" aria-label="Fotos da unidade">
                        {useGbp ? (
                            gbpPhotos.length ? (
                                <div className="aboutPhotosScrollerWrap">
                                    <div
                                        className="aboutPhotosEdge aboutPhotosEdge--left"
                                        aria-hidden="true"
                                        onMouseEnter={() => startPhotosAutoScroll("left")}
                                        onMouseLeave={stopPhotosAutoScroll}
                                    />
                                    <div
                                        className="aboutPhotosEdge aboutPhotosEdge--right"
                                        aria-hidden="true"
                                        onMouseEnter={() => startPhotosAutoScroll("right")}
                                        onMouseLeave={stopPhotosAutoScroll}
                                    />

                                    <button
                                        type="button"
                                        className="aboutPhotosArrow aboutPhotosArrow--left"
                                        aria-label="Fotos anteriores"
                                        onClick={() => scrollPhotosBy("left")}
                                    >
                                        <span aria-hidden="true">‹</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="aboutPhotosArrow aboutPhotosArrow--right"
                                        aria-label="Próximas fotos"
                                        onClick={() => scrollPhotosBy("right")}
                                    >
                                        <span aria-hidden="true">›</span>
                                    </button>

                                    <div className="aboutPhotosScroller" ref={photosScrollRef}>
                                        {gbpPhotos.map((p) => {
                                            const alt = "Foto da unidade";
                                            const photo = (
                                                <Image
                                                    className="aboutPhotoItem"
                                                    src={p.thumbnailUrl}
                                                    alt={alt}
                                                    width={520}
                                                    height={488}
                                                    sizes="25vw"
                                                    unoptimized
                                                    style={{ objectFit: "cover" }}
                                                />
                                            );

                                            return (
                                                <button
                                                    key={p.thumbnailUrl}
                                                    type="button"
                                                    className="aboutPhotoLink aboutPhotoButton"
                                                    aria-label="Ampliar foto da unidade"
                                                    onClick={() =>
                                                        setActivePhoto({
                                                            src: p.thumbnailUrl,
                                                            alt,
                                                            googleUrl: p.googleUrl,
                                                        })
                                                    }
                                                >
                                                    {photo}
                                                </button>
                                            );
                                        })}

                                        {gbpPhotosNextToken ? (
                                            <div className="aboutPhotosTail">{gbpPhotosLoading ? "Carregando…" : "Mais fotos →"}</div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : (
                                <div className="aboutMuted">{gbpPhotosLoading ? "Carregando fotos…" : "Fotos indisponíveis no momento."}</div>
                            )
                        ) : photos.length ? (
                            <div className="aboutPhotosScrollerWrap">
                                <div
                                    className="aboutPhotosEdge aboutPhotosEdge--left"
                                    aria-hidden="true"
                                    onMouseEnter={() => startPhotosAutoScroll("left")}
                                    onMouseLeave={stopPhotosAutoScroll}
                                />
                                <div
                                    className="aboutPhotosEdge aboutPhotosEdge--right"
                                    aria-hidden="true"
                                    onMouseEnter={() => startPhotosAutoScroll("right")}
                                    onMouseLeave={stopPhotosAutoScroll}
                                />

                                <button
                                    type="button"
                                    className="aboutPhotosArrow aboutPhotosArrow--left"
                                    aria-label="Fotos anteriores"
                                    onClick={() => scrollPhotosBy("left")}
                                >
                                    <span aria-hidden="true">‹</span>
                                </button>
                                <button
                                    type="button"
                                    className="aboutPhotosArrow aboutPhotosArrow--right"
                                    aria-label="Próximas fotos"
                                    onClick={() => scrollPhotosBy("right")}
                                >
                                    <span aria-hidden="true">›</span>
                                </button>

                                <div className="aboutPhotosScroller" ref={photosScrollRef}>
                                    {photos.map((p) => {
                                        const alt = "Foto da unidade";
                                        return (
                                            <button
                                                key={p.photoReference}
                                                type="button"
                                                className="aboutPhotoLink aboutPhotoButton"
                                                aria-label="Ampliar foto da unidade"
                                                onClick={() =>
                                                    setActivePhoto({
                                                        src: buildPlacePhotoUrl(p.photoReference, 1600),
                                                        alt,
                                                    })
                                                }
                                            >
                                                <Image
                                                    className="aboutPhotoItem"
                                                    src={buildPlacePhotoUrl(p.photoReference, 1200)}
                                                    alt={alt}
                                                    width={520}
                                                    height={488}
                                                    sizes="25vw"
                                                    unoptimized
                                                    style={{ objectFit: "cover" }}
                                                />
                                            </button>
                                        );
                                    })}

                                    {photos.length < allPhotos.length ? <div className="aboutPhotosTail">Mais fotos →</div> : null}
                                </div>
                            </div>
                        ) : (
                            <div className="aboutMuted">{loading ? "Carregando fotos…" : "Fotos indisponíveis no momento."}</div>
                        )}

                        <div className="aboutPhotosHint">Passe o mouse no canto direito para ver mais fotos.</div>
                    </div>

                    <div className="aboutSplit">
                        <div className="aboutMapCard">
                            <div className="aboutMapHeader">
                                <div>
                                    <div className="aboutPlaceTitle">{title}</div>
                                    {address ? <div className="aboutPlaceSub">{address}</div> : null}
                                </div>

                                <div className="aboutHeaderActions" aria-label="Ações">
                                    {agendarUrl ? (
                                        <Link
                                            className="aboutBtnPrimary"
                                            href={bookingHref}
                                            onClick={() =>
                                                trackBookingStart({
                                                    placement: "about",
                                                    unitSlug: unit?.slug ?? null,
                                                    bookingUrl: bookingHref,
                                                })
                                            }
                                        >
                                            Agendar
                                        </Link>
                                    ) : null}

                                    {reviewUrl ? (
                                        <a
                                            className="aboutBtnGhost"
                                            href={reviewUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={() =>
                                                trackEvent("cta_review_click", {
                                                    placement: "about",
                                                    unitSlug: unit?.slug ?? null,
                                                    placeId: selectedPlaceId,
                                                })
                                            }
                                        >
                                            Fazer review
                                        </a>
                                    ) : null}
                                </div>
                            </div>

                            <iframe
                                className="aboutMapFrame"
                                title="Google Maps"
                                src={embedUrl}
                                loading="lazy"
                                referrerPolicy="no-referrer-when-downgrade"
                            />

                            <div className="aboutRatingRow">
                                {loading ? (
                                    <div className="aboutMuted">Carregando avaliações…</div>
                                ) : !hasSelectedUnit ? (
                                    <div className="aboutMuted">Selecione uma unidade para ver avaliações e fotos.</div>
                                ) : data?.available ? (
                                    <>
                                        <Stars rating={rating} />
                                        <div className="aboutRatingText">
                                            <strong>{clampRating(rating).toFixed(1)}</strong>
                                            {typeof total === "number" ? <span className="aboutMuted">({total} avaliações)</span> : null}
                                        </div>
                                    </>
                                ) : (
                                    <div className="aboutMuted">Avaliações indisponíveis no momento.</div>
                                )}
                            </div>
                        </div>

                        <div className="aboutReviewsCard">
                            {hasSelectedUnit && (data?.available || loading) ? (
                                <div className="aboutReviewsSection" aria-label="Avaliações">
                                    <div className="aboutControls">
                                        <div className="aboutPills" aria-label="Filtro por nota">
                                            <button
                                                type="button"
                                                className={ratingFilter === "all" ? "aboutPill active" : "aboutPill"}
                                                onClick={() => setRatingFilter("all")}
                                            >
                                                Todas
                                            </button>
                                            {[5, 4, 3, 2, 1].map((n) => (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    className={ratingFilter === n ? "aboutPill active" : "aboutPill"}
                                                    onClick={() => setRatingFilter(n)}
                                                >
                                                    {n}★
                                                </button>
                                            ))}
                                        </div>

                                        <div className="aboutControlsRow">
                                            <label className="aboutToggle">
                                                <input
                                                    type="checkbox"
                                                    checked={onlyWithText}
                                                    onChange={(e) => setOnlyWithText(e.target.checked)}
                                                />
                                                Apenas com comentário
                                            </label>

                                            <select
                                                className="aboutSelect"
                                                value={sort}
                                                onChange={(e) => setSort(e.target.value as ReviewSort)}
                                                aria-label="Ordenação"
                                            >
                                                <option value="newest">Mais recentes</option>
                                                <option value="highest">Maior nota</option>
                                                <option value="lowest">Menor nota</option>
                                            </select>
                                        </div>

                                        <input
                                            className="aboutInput"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Buscar nas avaliações…"
                                            aria-label="Buscar avaliações"
                                        />
                                    </div>

                                    {loading ? (
                                        <div className="aboutMuted" style={{ padding: "0 14px 14px" }}>
                                            Carregando avaliações…
                                        </div>
                                    ) : reviews.length ? (
                                        <div className="aboutReviewsScroll" ref={reviewsScrollRef}>
                                            <div className="aboutReviews">
                                                {displayedReviews.map((r, idx) => (
                                                    <div key={`${r.authorName}-${r.time ?? "t"}-${idx}`} className="aboutReview">
                                                        <div className="aboutReviewTop">
                                                            <div className="aboutReviewAuthor">{r.authorName || "Avaliação"}</div>
                                                            <div className="aboutReviewMeta">
                                                                {typeof r.rating === "number" ? <span>{r.rating.toFixed(1)}★</span> : null}
                                                                {r.relativeTimeDescription ? <span>{r.relativeTimeDescription}</span> : null}
                                                            </div>
                                                        </div>
                                                        {r.text ? <div className="aboutReviewText">{r.text}</div> : null}
                                                    </div>
                                                ))}
                                            </div>
                                            {displayedReviews.length < reviews.length ? (
                                                <div className="aboutLoadMore">
                                                    Mostrando {displayedReviews.length} de {reviews.length}.{" "}
                                                    <button type="button" className="aboutLoadMoreBtn" onClick={loadMoreReviews}>
                                                        + Avaliações
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="aboutMuted" style={{ padding: "0 14px 14px" }}>
                                            Nenhuma avaliação encontrada com esses filtros.
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            {activePhoto ? (
                <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Foto da unidade"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setActivePhoto(null);
                    }}
                >
                    <div className="modalCard photoModalCard">
                        <div className="modalHeader">
                            <div>
                                <div className="modalTitle">Foto da unidade</div>
                                {activePhoto.googleUrl ? <div className="modalSubtitle">Google Maps</div> : null}
                            </div>
                            <button className="modalClose" type="button" onClick={() => setActivePhoto(null)} aria-label="Fechar">
                                ×
                            </button>
                        </div>
                        <div className="modalBody photoModalBody">
                            <Image
                                className="photoModalImage"
                                src={activePhoto.src}
                                alt={activePhoto.alt}
                                width={1600}
                                height={900}
                                loading="lazy"
                                unoptimized
                            />
                            {activePhoto.googleUrl ? (
                                <div className="modalActions">
                                    <a className="btn btnPrimary" href={activePhoto.googleUrl} target="_blank" rel="noreferrer">
                                        Abrir no Google Maps
                                    </a>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
