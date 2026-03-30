"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import useHorizontalRail from "@/hooks/useHorizontalRail";
import type { Unit } from "@/data/units";
import Image from "next/image";
import { trackEvent } from "@/lib/analytics";
import { trackBookingStart, trackCtaInstagramClick } from "@/lib/leadTracking";
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

type GalleryItem =
    | {
          id: string;
          kind: "photo";
          alt: string;
          thumbSrc: string;
          fullSrc: string;
          googleUrl?: string | null;
      }
    | {
          id: string;
          kind: "cta";
          alt: string;
          href: string;
          handle: string | null;
      };

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

function buildOpenMapsUrl(data: PlaceDetailsPayload | null, unit: Unit | null, fallbackQuery: string): string | null {
    const directUrl = (unit?.maps ?? data?.mapsUrl ?? "").trim();
    if (directUrl) return directUrl;

    const lat = data?.location?.lat ?? unit?.lat ?? null;
    const lng = data?.location?.lng ?? unit?.lng ?? null;
    const query = typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : fallbackQuery;

    if (!query.trim()) return null;

    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", query);
    return url.toString();
}

function buildGoogleEmbedUrl(data: PlaceDetailsPayload | null, unit: Unit | null, fallbackQuery: string): string | null {
    const lat = data?.location?.lat ?? unit?.lat ?? null;
    const lng = data?.location?.lng ?? unit?.lng ?? null;
    const query = typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : fallbackQuery.trim();
    if (!query) return null;

    const url = new URL("https://www.google.com/maps");
    url.searchParams.set("q", query);
    url.searchParams.set("z", "15");
    url.searchParams.set("output", "embed");
    return url.toString();
}

function formatCoordinates(lat: number | null | undefined, lng: number | null | undefined): string | null {
    if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
        return null;
    }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function clampRating(value: number | null | undefined): number {
    const n = typeof value === "number" ? value : 0;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
}

function extractInstagramHandle(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const { pathname } = new URL(url);
        const handle = pathname.split("/").filter(Boolean)[0];
        return handle ? handle.replace(/^@/, "") : null;
    } catch {
        return null;
    }
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
    const {
        canScrollLeft: canScrollPhotosLeft,
        canScrollRight: canScrollPhotosRight,
        hoverEdge: photosHoverEdge,
        handleEdgeMouse: handlePhotosEdgeMouse,
        clearHoverScroll: clearPhotosHoverScroll,
        scrollByDirection: scrollPhotosBy,
    } = useHorizontalRail({
        railRef: photosScrollRef,
        itemSelector: ".aboutPhotoLink",
        lockMs: 720,
        baseVelocity: 0.02,
        maxVelocity: 0.18,
        fallbackMinStep: 180,
        fallbackStepRatio: 0.52,
    });

    const [gbpPhotos, setGbpPhotos] = useState<Array<{ name: string; thumbnailUrl: string; googleUrl: string | null }>>([]);
    const [gbpPhotosNextToken, setGbpPhotosNextToken] = useState<string | null>(null);
    const [gbpPhotosLoading, setGbpPhotosLoading] = useState<boolean>(false);

    const [gbpReviews, setGbpReviews] = useState<
        Array<{ reviewId: string; authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>
    >([]);
    const [gbpReviewsNextToken, setGbpReviewsNextToken] = useState<string | null>(null);
    const [gbpReviewsLoading, setGbpReviewsLoading] = useState<boolean>(false);
    const [gbpForceFallback, setGbpForceFallback] = useState<boolean>(false);

    const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);

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

                const res = await fetch(url.toString());
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

    const mapOpenUrl = useMemo(() => buildOpenMapsUrl(data, unit, query), [data, unit, query]);
    const mapEmbedUrl = useMemo(() => buildGoogleEmbedUrl(data, unit, query), [data, unit, query]);
    const coordinatesLabel = useMemo(() => formatCoordinates(data?.location?.lat ?? unit?.lat, data?.location?.lng ?? unit?.lng), [data?.location?.lat, data?.location?.lng, unit?.lat, unit?.lng]);
    const isPlaceDataPending = hasSelectedUnit && (loading || data === null);
    const isPhotoDataPending = useGbp ? gbpPhotosLoading && gbpPhotos.length === 0 : isPlaceDataPending;
    const isReviewDataPending = useGbp ? gbpReviewsLoading && gbpReviews.length === 0 : isPlaceDataPending;

    const buildPlacePhotoUrl = useCallback((ref: string, maxwidth = 1200) => {
        return `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=${maxwidth}`;
    }, []);

    const allPhotos = useMemo(() => (hasSelectedUnit ? data?.photos ?? [] : []), [data?.photos, hasSelectedUnit]);
    const photos = useMemo(() => allPhotos.slice(0, visiblePhotosCount), [allPhotos, visiblePhotosCount]);
    const unitInstagramUrl = (unit?.instagram ?? "").trim() || "https://www.instagram.com/espacofacial/";
    const unitInstagramHandle = extractInstagramHandle(unitInstagramUrl);
    const galleryItems = useMemo<GalleryItem[]>(() => {
        if (!hasSelectedUnit) return [];

        const items: GalleryItem[] = useGbp
            ? gbpPhotos.map((photo, index) => ({
                  id: `${photo.thumbnailUrl}-${index}`,
                  kind: "photo",
                  alt: "Imagem da unidade",
                  thumbSrc: photo.thumbnailUrl,
                  fullSrc: photo.thumbnailUrl,
                  googleUrl: photo.googleUrl,
              }))
            : photos.map((photo) => ({
                  id: photo.photoReference,
                  kind: "photo",
                  alt: "Imagem da unidade",
                  thumbSrc: buildPlacePhotoUrl(photo.photoReference, 1200),
                  fullSrc: buildPlacePhotoUrl(photo.photoReference, 1600),
              }));

        if (unitInstagramUrl) {
            items.push({
                id: `cta-${unit?.slug ?? "unit"}`,
                kind: "cta",
                alt: "Conheça mais sobre a unidade",
                href: unitInstagramUrl,
                handle: unitInstagramHandle,
            });
        }

        return items;
    }, [buildPlacePhotoUrl, gbpPhotos, hasSelectedUnit, photos, unit?.slug, unitInstagramHandle, unitInstagramUrl, useGbp]);
    const activeGalleryItem = activePhotoIndex !== null ? galleryItems[activePhotoIndex] ?? null : null;
    const activePhoto = activeGalleryItem?.kind === "photo" ? activeGalleryItem : null;
    const activeGalleryCta = activeGalleryItem?.kind === "cta" ? activeGalleryItem : null;

    useEffect(() => {
        if (!activeGalleryItem) return;

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                setActivePhotoIndex(null);
                return;
            }
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                setActivePhotoIndex((current) => {
                    if (current === null || !galleryItems.length) return current;
                    return (current - 1 + galleryItems.length) % galleryItems.length;
                });
                return;
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setActivePhotoIndex((current) => {
                    if (current === null || !galleryItems.length) return current;
                    return (current + 1) % galleryItems.length;
                });
            }
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [activeGalleryItem, galleryItems.length]);

    useEffect(() => {
        if (activePhotoIndex === null) return;
        if (galleryItems.length === 0) {
            setActivePhotoIndex(null);
            return;
        }
        if (activePhotoIndex >= galleryItems.length) {
            setActivePhotoIndex(galleryItems.length - 1);
        }
    }, [activePhotoIndex, galleryItems.length]);

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
        setActivePhotoIndex(null);
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

                const res = await fetch(url.toString());
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

                const res = await fetch(url.toString());
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

    const openPhotoAtIndex = useCallback((index: number) => {
        setActivePhotoIndex(index);
    }, []);

    const goToPreviousPhoto = useCallback(() => {
        setActivePhotoIndex((current) => {
            if (current === null || !galleryItems.length) return current;
            return (current - 1 + galleryItems.length) % galleryItems.length;
        });
    }, [galleryItems.length]);

    const goToNextPhoto = useCallback(() => {
        setActivePhotoIndex((current) => {
            if (current === null || !galleryItems.length) return current;
            return (current + 1) % galleryItems.length;
        });
    }, [galleryItems.length]);

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
                        {galleryItems.length ? (
                            <div className="aboutPhotosScrollerWrap">
                                {galleryItems.length > 1 ? (
                                    <>
                                        <div
                                            className="aboutPhotosEdge aboutPhotosEdge--left"
                                            aria-hidden="true"
                                            onMouseEnter={(event) => handlePhotosEdgeMouse("left", event)}
                                            onMouseMove={(event) => handlePhotosEdgeMouse("left", event)}
                                            onMouseLeave={() => clearPhotosHoverScroll()}
                                        />
                                        <div
                                            className="aboutPhotosEdge aboutPhotosEdge--right"
                                            aria-hidden="true"
                                            onMouseEnter={(event) => handlePhotosEdgeMouse("right", event)}
                                            onMouseMove={(event) => handlePhotosEdgeMouse("right", event)}
                                            onMouseLeave={() => clearPhotosHoverScroll()}
                                        />

                                        <button
                                            type="button"
                                            className="aboutPhotosArrow carouselNavChrome aboutPhotosArrow--left"
                                            aria-label="Fotos anteriores"
                                            disabled={!canScrollPhotosLeft}
                                            data-visible={canScrollPhotosLeft ? "true" : "false"}
                                            data-hovered={photosHoverEdge === "left" ? "true" : "false"}
                                            onClick={() => scrollPhotosBy("left")}
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            className="aboutPhotosArrow carouselNavChrome aboutPhotosArrow--right"
                                            aria-label="Próximas fotos"
                                            disabled={!canScrollPhotosRight}
                                            data-visible={canScrollPhotosRight ? "true" : "false"}
                                            data-hovered={photosHoverEdge === "right" ? "true" : "false"}
                                            onClick={() => scrollPhotosBy("right")}
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                    </>
                                ) : null}

                                <div className="aboutPhotosScroller" ref={photosScrollRef}>
                                    {galleryItems.map((item, index) => {
                                        if (item.kind === "photo") {
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    className="aboutPhotoLink aboutPhotoButton"
                                                    aria-label="Ampliar imagem da unidade"
                                                    data-active={activePhotoIndex === index ? "true" : "false"}
                                                    onClick={() => openPhotoAtIndex(index)}
                                                >
                                                    <Image
                                                        className="aboutPhotoItem"
                                                        src={item.thumbSrc}
                                                        alt={item.alt}
                                                        width={520}
                                                        height={488}
                                                        sizes="25vw"
                                                        unoptimized
                                                        style={{ objectFit: "cover" }}
                                                    />
                                                    <span className="aboutPhotoOverlay" aria-hidden="true" />
                                                </button>
                                            );
                                        }

                                        return (
                                            <a
                                                key={item.id}
                                                className="aboutPhotoLink aboutPhotoLink--cta"
                                                href={item.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={item.alt}
                                                data-active={activePhotoIndex === index ? "true" : "false"}
                                                onClick={() =>
                                                    trackCtaInstagramClick({
                                                        placement: "about",
                                                        unitSlug: unit?.slug ?? null,
                                                        instagramUrl: unitInstagramUrl,
                                                    })
                                                }
                                            >
                                                <span className="aboutPhotoCtaGlow" aria-hidden="true" />
                                                <span className="aboutPhotoOverlay aboutPhotoOverlay--cta" aria-hidden="true" />
                                                <span className="aboutPhotoCtaContent">
                                                    <span className="aboutPhotoCtaPlus" aria-hidden="true">+</span>
                                                    <span className="aboutPhotoCtaTitle">Conheça mais</span>
                                                    {item.handle ? <span className="aboutPhotoCtaMeta">@{item.handle}</span> : null}
                                                </span>
                                            </a>
                                        );
                                    })}

                                </div>
                            </div>
                        ) : (
                            <div className="aboutMuted">
                                {isPhotoDataPending ? "Carregando fotos…" : "Fotos indisponíveis no momento."}
                            </div>
                        )}

                        {!galleryItems.length ? (
                            <div className="aboutMuted" style={{ padding: "0 18px", fontSize: 12 }}>
                                {isPhotoDataPending ? "Carregando fotos…" : "Mais fotos em breve."}
                            </div>
                        ) : null}
                        <div className="aboutPhotosHint">Arraste, use as setas, a barra inferior ou aproxime o cursor das laterais para navegar com suavidade.</div>
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

                            {mapEmbedUrl ? (
                                mapOpenUrl ? (
                                    <a
                                        className="aboutMapEmbedLink"
                                        href={mapOpenUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Abrir localização de ${title} no Google Maps`}
                                    >
                                        <iframe
                                            className="aboutMapFrame aboutMapFrame--preview"
                                            src={mapEmbedUrl}
                                            loading="lazy"
                                            referrerPolicy="no-referrer-when-downgrade"
                                            title={`Mapa de ${title}`}
                                        />
                                        <span className="aboutMapOverlayHint">Abrir no Google Maps</span>
                                    </a>
                                ) : (
                                    <iframe
                                        className="aboutMapFrame"
                                        src={mapEmbedUrl}
                                        loading="lazy"
                                        referrerPolicy="no-referrer-when-downgrade"
                                        title={`Mapa de ${title}`}
                                    />
                                )
                            ) : (
                                <div className="aboutMapFrame aboutMapFrame--static" aria-label="Resumo de localização da unidade">
                                    <div className="aboutMapStaticGlow" aria-hidden="true" />
                                    <div className="aboutMapStaticTop">
                                        <span className="aboutMapStaticEyebrow">Localização</span>
                                        <span className="aboutMapStaticBadge">Snapshot local</span>
                                    </div>
                                    <div className="aboutMapStaticTitle">{title}</div>
                                    {address ? <div className="aboutMapStaticAddress">{address}</div> : null}
                                    <div className="aboutMapStaticMeta">
                                        {coordinatesLabel ? (
                                            <div className="aboutMapStaticMetaItem">
                                                <span>Coordenadas</span>
                                                <strong>{coordinatesLabel}</strong>
                                            </div>
                                        ) : null}
                                        <div className="aboutMapStaticMetaItem">
                                            <span>Status</span>
                                            <strong>{mapEmbedUrl ? "Google Maps sob clique" : "Snapshot local"}</strong>
                                        </div>
                                    </div>
                                    <div className="aboutMapStaticActions">
                                        {mapOpenUrl ? (
                                            <a className="aboutBtnGhost" href={mapOpenUrl} target="_blank" rel="noopener noreferrer">
                                                Abrir rota
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            )}

                            <div className="aboutRatingRow">
                                {isReviewDataPending ? (
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
                            {hasSelectedUnit ? (
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

                                    {isReviewDataPending ? (
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

            {activeGalleryItem ? (
                <div
                    className="modalOverlay aboutPhotoModalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Galeria da unidade"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setActivePhotoIndex(null);
                    }}
                >
                    <div className="aboutPhotoModalCard">
                        <button
                            className="aboutPhotoModalClose"
                            type="button"
                            onClick={() => setActivePhotoIndex(null)}
                            aria-label="Fechar"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 7l10 10" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                                <path d="M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                            </svg>
                        </button>

                        {galleryItems.length > 1 ? (
                            <>
                                <button
                                    className="aboutPhotoModalArrow carouselNavChrome aboutPhotoModalArrow--left"
                                    type="button"
                                    onClick={goToPreviousPhoto}
                                    aria-label="Item anterior"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                                <button
                                    className="aboutPhotoModalArrow carouselNavChrome aboutPhotoModalArrow--right"
                                    type="button"
                                    onClick={goToNextPhoto}
                                    aria-label="Próximo item"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </>
                        ) : null}

                        <div
                            className={
                                activeGalleryCta
                                    ? "aboutPhotoModalViewport aboutPhotoModalViewport--cta"
                                    : "aboutPhotoModalViewport"
                            }
                        >
                            {activePhoto ? (
                                <Image
                                    className="aboutPhotoModalImage"
                                    src={activePhoto.fullSrc}
                                    alt={activePhoto.alt}
                                    width={1600}
                                    height={900}
                                    loading="lazy"
                                    unoptimized
                                />
                            ) : null}

                            {activeGalleryCta ? (
                                <a
                                    className="aboutPhotoModalCtaCard"
                                    href={activeGalleryCta.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() =>
                                        trackCtaInstagramClick({
                                            placement: "about",
                                            unitSlug: unit?.slug ?? null,
                                            instagramUrl: unitInstagramUrl,
                                        })
                                    }
                                >
                                    <span className="aboutPhotoModalCtaPlus" aria-hidden="true">+</span>
                                    <span className="aboutPhotoModalCtaTitle">Conheça mais</span>
                                    {activeGalleryCta.handle ? <span className="aboutPhotoModalCtaMeta">@{activeGalleryCta.handle}</span> : null}
                                </a>
                            ) : null}
                        </div>

                        {activePhoto?.googleUrl ? (
                            <div className="aboutPhotoModalFooter">
                                <a className="aboutPhotoModalLink" href={activePhoto.googleUrl} target="_blank" rel="noreferrer">
                                    Abrir no Google Maps
                                </a>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </section>
    );
}
