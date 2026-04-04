"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import useHorizontalRail from "@/hooks/useHorizontalRail";
import type { Unit } from "@/data/units";
import Image from "next/image";
import { trackEvent } from "@/lib/analytics";
import { trackBookingStart, trackCtaInstagramClick } from "@/lib/leadTracking";

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

type ReviewPayload = {
    reviewId: string;
    authorName: string;
    rating: number | null;
    relativeTimeDescription: string;
    time: number | null;
    text: string;
};

type GbpReviewsPagePayload = {
    available: boolean;
    error?: string;
    reviews?: ReviewPayload[];
    nextPageToken?: string | null;
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

function formatAddressLines(title: string, rawAddress: string | null | undefined, unitSlug?: string | null): string[] {
    if (unitSlug === "barrashoppingsul") {
        return [
            "Espaço Facial – BarraShoppingSul",
            "Av. Diário de Notícias, 300.",
            "Nível Guaíba, Loja 2093.",
            "Porto Alegre/RS",
            "90810-080",
        ];
    }

    if (unitSlug === "novo-hamburgo") {
        return [
            "Espaço Facial – Novo Hamburgo",
            "Av. Dr. Maurício Cardoso, 1126",
            "Novo Hamburgo/RS",
            "93548-515",
        ];
    }

    const source = (rawAddress ?? "").trim();
    if (!source) return [];

    const normalizedTitle = title.trim().toLowerCase();
    const withoutTitle = normalizedTitle
        ? source.replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i"), "")
        : source;

    const segments = withoutTitle
        .split(" - ")
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length < 2) return [withoutTitle];

    const last = segments[segments.length - 1] ?? "";
    const beforeLast = segments[segments.length - 2] ?? "";
    const earlier = segments.slice(0, -2);

    const line1 = earlier.length ? earlier.join(" - ") : beforeLast;

    const cityCandidate = beforeLast.includes(",")
        ? beforeLast.split(",").map((part) => part.trim()).filter(Boolean).pop() ?? beforeLast
        : beforeLast;
    const stateCandidate = last.split(",")[0]?.trim() ?? "";
    const postalCandidate = last.split(",").slice(1).join(",").trim();

    const lines = [line1];

    if (cityCandidate && stateCandidate) {
        lines.push(`${cityCandidate}/${stateCandidate}`);
    } else if (cityCandidate || stateCandidate) {
        lines.push(cityCandidate || stateCandidate);
    }

    if (postalCandidate) lines.push(postalCandidate);

    return lines.filter(Boolean);
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

type AboutUsSectionProps = {
    headingLevel?: 1 | 2;
    selectedTitle?: string;
    selectedSubtitle?: string;
    unselectedTitle?: string;
};

export default function AboutUsSection({
    headingLevel = 2,
    selectedTitle = "Conheça a unidade",
    selectedSubtitle = "Veja algumas fotos, avaliações e como chegar na unidade.",
    unselectedTitle = "Espaço Facial",
}: AboutUsSectionProps = {}) {
    const unit = useCurrentUnit();
    const hasSelectedUnit = Boolean(unit);
    const HeadingTag = `h${headingLevel}` as ElementType;

    const query = useMemo(() => buildQueryForUnit(unit), [unit]);

    const [data, setData] = useState<PlaceDetailsPayload | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [loadedReviews, setLoadedReviews] = useState<ReviewPayload[]>([]);
    const [reviewsLoadingInitial, setReviewsLoadingInitial] = useState<boolean>(false);
    const [reviewsLoadingMore, setReviewsLoadingMore] = useState<boolean>(false);
    const [nextReviewsPageToken, setNextReviewsPageToken] = useState<string | null>(null);
    const [reviewsAvailable, setReviewsAvailable] = useState<boolean>(false);

    const [ratingFilter, setRatingFilter] = useState<number | "all">(5);
    const [sort, setSort] = useState<ReviewSort>("newest");

    const reviewsScrollRef = useRef<HTMLDivElement | null>(null);
    const reviewsLoadMoreRef = useRef<HTMLDivElement | null>(null);
    const reviewsPendingRequestRef = useRef<string | null>(null);

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
    const addressLines = useMemo(() => formatAddressLines(title, address, unit?.slug ?? null), [address, title, unit?.slug]);

    const selectedPlaceId = (data?.placeId ?? unit?.placeId ?? null)?.toString().trim() || null;
    const reviewsLocationParam = (unit?.gbpLocation ?? selectedPlaceId ?? "").trim() || null;
    const agendarUrl = hasSelectedUnit ? unit?.contactUrl || null : null;
    const bookingHref = hasSelectedUnit && unit?.slug ? `/agendamento?unit=${encodeURIComponent(unit.slug)}` : "/agendamento";
    const reviewUrl = hasSelectedUnit && selectedPlaceId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(selectedPlaceId)}` : null;

    const mapOpenUrl = useMemo(() => buildOpenMapsUrl(data, unit, query), [data, unit, query]);
    const mapEmbedUrl = useMemo(() => buildGoogleEmbedUrl(data, unit, query), [data, unit, query]);
    const coordinatesLabel = useMemo(() => formatCoordinates(data?.location?.lat ?? unit?.lat, data?.location?.lng ?? unit?.lng), [data?.location?.lat, data?.location?.lng, unit?.lat, unit?.lng]);
    const isPlaceDataPending = hasSelectedUnit && (loading || data === null);
    // Keep the unit gallery fully local so "Sobre Nós" never depends on paid Places fetches.
    const isPhotoDataPending = isPlaceDataPending;
    const isReviewDataPending = hasSelectedUnit && reviewsLoadingInitial;

    const fetchReviewsPage = useCallback(
        async (pageToken: string | null, mode: "reset" | "append") => {
            if (!reviewsLocationParam) return;
            const requestKey = `${reviewsLocationParam}::${pageToken ?? "initial"}::${mode}`;
            if (reviewsPendingRequestRef.current === requestKey) return;
            reviewsPendingRequestRef.current = requestKey;

            if (mode === "reset") {
                setReviewsLoadingInitial(true);
            } else {
                setReviewsLoadingMore(true);
            }

            try {
                const url = new URL("/api/gbp/reviews", window.location.origin);
                url.searchParams.set("location", reviewsLocationParam);
                url.searchParams.set("pageSize", "12");
                if (pageToken) url.searchParams.set("pageToken", pageToken);

                const res = await fetch(url.toString(), { cache: "no-store" });
                const json = (await res.json()) as GbpReviewsPagePayload;

                if (!json.available) {
                    setReviewsAvailable(false);
                    if (mode === "reset") setLoadedReviews([]);
                    setNextReviewsPageToken(null);
                    return;
                }

                const incoming = json.reviews ?? [];
                setReviewsAvailable(true);
                setNextReviewsPageToken(json.nextPageToken ?? null);
                setLoadedReviews((current) => {
                    if (mode === "reset") return incoming;
                    const seen = new Set(current.map((review) => review.reviewId));
                    const merged = [...current];
                    for (const review of incoming) {
                        if (!seen.has(review.reviewId)) {
                            merged.push(review);
                            seen.add(review.reviewId);
                        }
                    }
                    return merged;
                });
            } catch {
                if (mode === "reset") setLoadedReviews([]);
                setReviewsAvailable(false);
                setNextReviewsPageToken(null);
            } finally {
                if (reviewsPendingRequestRef.current === requestKey) {
                    reviewsPendingRequestRef.current = null;
                }
                if (mode === "reset") {
                    setReviewsLoadingInitial(false);
                } else {
                    setReviewsLoadingMore(false);
                }
            }
        },
        [reviewsLocationParam],
    );

    useEffect(() => {
        if (!hasSelectedUnit || !reviewsLocationParam) {
            setLoadedReviews([]);
            setNextReviewsPageToken(null);
            setReviewsAvailable(false);
            setReviewsLoadingInitial(false);
            setReviewsLoadingMore(false);
            reviewsPendingRequestRef.current = null;
            return;
        }

        setLoadedReviews([]);
        setNextReviewsPageToken(null);
        setReviewsAvailable(false);
        reviewsPendingRequestRef.current = null;
        void fetchReviewsPage(null, "reset");
    }, [fetchReviewsPage, hasSelectedUnit, reviewsLocationParam]);

    const buildPlacePhotoUrl = useCallback((ref: string, maxwidth = 1200) => {
        return `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=${maxwidth}`;
    }, []);

    const allPhotos = useMemo(() => (hasSelectedUnit ? data?.photos ?? [] : []), [data?.photos, hasSelectedUnit]);
    const photos = useMemo(() => allPhotos.slice(0, visiblePhotosCount), [allPhotos, visiblePhotosCount]);
    const unitInstagramUrl = (unit?.instagram ?? "").trim() || "https://www.instagram.com/espacofacial/";
    const unitInstagramHandle = extractInstagramHandle(unitInstagramUrl);
    const galleryItems = useMemo<GalleryItem[]>(() => {
        if (!hasSelectedUnit) return [];

        const items: GalleryItem[] = photos.map((photo) => ({
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
    }, [buildPlacePhotoUrl, hasSelectedUnit, photos, unit?.slug, unitInstagramHandle, unitInstagramUrl]);
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
        const all = loadedReviews;

        const filtered = all.filter((r) => {
            if (ratingFilter !== "all" && typeof r.rating === "number" && Math.round(r.rating) !== ratingFilter) return false;
            if (ratingFilter !== "all" && typeof r.rating !== "number") return false;
            return true;
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
    }, [hasSelectedUnit, loadedReviews, ratingFilter, sort]);

    const reviews = baseReviews;

    useEffect(() => {
        setVisiblePhotosCount(8);
    }, [hasSelectedUnit, selectedPlaceId]);

    useEffect(() => {
        setActivePhotoIndex(null);
    }, [hasSelectedUnit, selectedPlaceId]);

    const loadMoreReviews = useCallback(() => {
        if (!nextReviewsPageToken || reviewsLoadingInitial || reviewsLoadingMore) return;
        void fetchReviewsPage(nextReviewsPageToken, "append");
    }, [fetchReviewsPage, nextReviewsPageToken, reviewsLoadingInitial, reviewsLoadingMore]);

    const loadMorePhotos = useCallback(() => {
        setVisiblePhotosCount((c) => {
            if (c >= allPhotos.length) return c;
            return Math.min(allPhotos.length, c + 4);
        });
    }, [allPhotos.length]);

    const maybeLoadMoreReviews = useCallback(() => {
        const el = reviewsScrollRef.current;
        if (!el) return;
        if (!nextReviewsPageToken || reviewsLoadingInitial || reviewsLoadingMore) {
            return;
        }
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 220;
        if (nearBottom) loadMoreReviews();
    }, [loadMoreReviews, nextReviewsPageToken, reviewsLoadingInitial, reviewsLoadingMore]);

    const maybeLoadMorePhotos = useCallback(() => {
        const el = photosScrollRef.current;
        if (!el) return;
        if (visiblePhotosCount >= allPhotos.length) {
            return;
        }
        const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 260;
        if (nearEnd) loadMorePhotos();
    }, [allPhotos.length, loadMorePhotos, visiblePhotosCount]);

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
        if (!nextReviewsPageToken || reviewsLoadingInitial || reviewsLoadingMore) return;
        if (el.scrollHeight <= el.clientHeight + 20) {
            loadMoreReviews();
        }
    }, [loadMoreReviews, nextReviewsPageToken, reviewsLoadingInitial, reviewsLoadingMore, reviews.length]);

    useEffect(() => {
        const root = reviewsScrollRef.current;
        const target = reviewsLoadMoreRef.current;
        if (!root || !target) return;
        if (!nextReviewsPageToken || reviewsLoadingInitial || reviewsLoadingMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreReviews();
                }
            },
            { root, rootMargin: "0px 0px 240px 0px", threshold: 0.01 },
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [loadMoreReviews, nextReviewsPageToken, reviewsLoadingInitial, reviewsLoadingMore, reviews.length]);

    useEffect(() => {
        const el = photosScrollRef.current;
        if (!el) return;
        if (visiblePhotosCount >= allPhotos.length) return;
        if (el.scrollWidth <= el.clientWidth + 20) {
            loadMorePhotos();
        }
    }, [allPhotos.length, loadMorePhotos, visiblePhotosCount]);

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

    if (!hasSelectedUnit) {
        return (
            <section id="sobre-nos" className="pageSection">
                <div className="pageNarrative">
                    <div className="pageNarrative__intro">
                        <span className="pageNarrative__eyebrow">Nosso cuidado</span>
                        <HeadingTag className="sectionTitle">{unselectedTitle}</HeadingTag>
                        <p className="sectionSub pageNarrative__sub">
                            A Espaço Facial une avaliação cuidadosa, especialistas e atendimento acolhedor
                            para quem busca harmonização facial com resultado elegante e natural.
                        </p>
                    </div>

                    <div className="pageNarrative__stats" role="group" aria-label="Princípios de atendimento">
                        <div className="pageNarrative__stat">
                            <strong>Avaliação cuidadosa</strong>
                            <span>Cada indicação respeita suas características e o efeito que você deseja alcançar.</span>
                        </div>
                        <div className="pageNarrative__stat">
                            <strong>Naturalidade</strong>
                            <span>O objetivo é valorizar sua beleza sem exageros e sem perder sua identidade.</span>
                        </div>
                        <div className="pageNarrative__stat">
                            <strong>Segurança</strong>
                            <span>O atendimento é pensado para orientar você com clareza em cada etapa.</span>
                        </div>
                    </div>
                </div>

                <div className="decisionCardsSection">
                    <div className="decisionCards">
                        <article className="decisionCard">
                            <div className="decisionCard__eyebrow">Avaliação</div>
                            <h2>Cada atendimento começa entendendo o que faz sentido para você.</h2>
                            <p>
                                Antes de qualquer procedimento, o mais importante é entender seu objetivo
                                e indicar o melhor caminho para o seu caso.
                            </p>
                        </article>

                        <article className="decisionCard">
                            <div className="decisionCard__eyebrow">Escolha com tranquilidade</div>
                            <h2>Conheça especialistas, unidades e reserve quando se sentir seguro.</h2>
                            <p>
                                Você pode conhecer as unidades, comparar especialistas e reservar quando quiser.
                            </p>
                        </article>
                    </div>
                </div>

                <div className="decisionCard__linksRow decisionCard__linksRow--spaced">
                    <Link className="decisionCard__primary" href="/agendamento">
                        Agendar avaliação
                    </Link>
                    <Link className="decisionCard__secondary" href="/unidades">
                        Ver unidades
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <section id="sobre-nos" className="pageSection">
            <HeadingTag className="sectionTitle">{selectedTitle}</HeadingTag>
            <p className="sectionSub">{selectedSubtitle}</p>

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
                                                        priority={index === 0}
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
                                {isPhotoDataPending ? "Preparando fotos da unidade…" : "As fotos desta unidade voltam a aparecer em breve."}
                            </div>
                        )}

                        {!galleryItems.length ? (
                            <div className="aboutMuted" style={{ padding: "0 18px", fontSize: 12 }}>
                                {isPhotoDataPending ? "Preparando fotos da unidade…" : "Novas fotos da unidade aparecem aqui em breve."}
                            </div>
                        ) : null}
                        <div className="aboutPhotosHint">Arraste a barra inferior ou use as setas para navegar com suavidade.</div>
                    </div>

                    <div className="aboutSplit">
                        <div className="aboutSplitIntro">
                            <div className="aboutReviewsIntro">
                                <h3 className="sectionTitle sectionTitle--display aboutReviewsIntro__title">Confira comentários de pacientes da unidade.</h3>
                                <div className="sectionCopyPair aboutReviewsIntro__body">
                                    <p className="sectionLead">Os trechos abaixo vêm de avaliações públicas reais.</p>
                                </div>
                            </div>
                        </div>

                        <div className="aboutSplitColumn aboutSplitColumn--map">
                            <div className="aboutMapCard">
                                <div className="aboutMapHeader">
                                    <div>
                                        <div className="aboutPlaceTitle">{title}</div>
                                        {addressLines.length ? (
                                            <div className="aboutPlaceSub">
                                                {addressLines.map((line) => (
                                                    <span key={line}>{line}</span>
                                                ))}
                                            </div>
                                        ) : null}
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
                            </div>

                            <p className="small aboutSplitNote aboutSplitNote--map">
                                Clique no mapa para ser redirecionado para saber <strong>Como Chegar</strong> na unidade.
                            </p>
                        </div>

                        <div className="aboutSplitColumn aboutSplitColumn--reviews">
                            <div className="aboutReviewsCard">
                                {hasSelectedUnit ? (
                                    <div className="aboutReviewsSection" aria-label="Avaliações">
                                        <div className="aboutControls">
                                            <div className="aboutControlsRow aboutControlsRow--top">
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
                                        </div>

                                        {isReviewDataPending ? (
                                            <div className="aboutMuted" style={{ padding: "0 14px 14px" }}>
                                                Preparando avaliações da unidade…
                                            </div>
                                        ) : reviews.length ? (
                                            <div className="aboutReviewsScroll" ref={reviewsScrollRef}>
                                                <div className="aboutReviews">
                                                    {reviews.map((r, idx) => (
                                                        <div key={r.reviewId || `${r.authorName}-${r.time ?? "t"}-${idx}`} className="aboutReview">
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
                                                {reviewsLoadingMore ? (
                                                    <div className="aboutLoadMore">
                                                        Carregando mais comentários…
                                                    </div>
                                                ) : nextReviewsPageToken ? (
                                                    <div className="aboutLoadMore">
                                                        Role para carregar mais avaliações.
                                                        <button type="button" className="aboutLoadMoreBtn" onClick={loadMoreReviews}>
                                                            + Avaliações
                                                        </button>
                                                    </div>
                                                ) : null}
                                                <div ref={reviewsLoadMoreRef} aria-hidden="true" style={{ height: 1 }} />
                                            </div>
                                        ) : (
                                            <div className="aboutMuted" style={{ padding: "0 14px 14px" }}>
                                                {reviewsAvailable
                                                    ? "Nenhuma avaliação encontrada com esses filtros."
                                                    : "As avaliações públicas desta unidade aparecem aqui em breve."}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>

                            <p className="small aboutSplitNote aboutSplitNote--reviews">
                                Role até o final da lista para carregar de forma dinâmica comentários adicionais.
                            </p>
                        </div>
                    </div>
                </div>

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
