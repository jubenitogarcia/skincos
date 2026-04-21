"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { trackBookingStart } from "@/lib/leadTracking";

type InstagramMedia = {
    id: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    isStory: boolean;
    caption: string | null;
    likeCount?: number | null;
    commentCount?: number | null;
    playCount?: number | null;
    viewCount?: number | null;
    durationSeconds?: number | null;
    locationName?: string | null;
    productType?: string | null;
    resourcesCount?: number | null;
    isPinned?: boolean;
    takenAtMs: number | null;
    thumbnailUrl: string;
    videoUrl: string | null;
    permalink?: string | null;
    payloadJson?: string | null;
};

type InstagramFeedResponse =
    | {
        ok: true;
        user: {
            id: string;
            handle: string;
            name: string | null;
            bio: string | null;
            followersCount?: number | null;
            followingCount?: number | null;
            mediaCount?: number | null;
            isVerified?: boolean | null;
            isPrivate?: boolean | null;
            isBusiness?: boolean | null;
            isProfessional?: boolean | null;
            categoryName?: string | null;
            externalUrl?: string | null;
            publicEmail?: string | null;
            publicPhone?: string | null;
        };
        items: InstagramMedia[];
        hasMore: boolean;
        nextCursor: string | null;
    }
    | { ok: false; error: string };

export type DoctorInstagramProfile = {
    name: string;
    handle: string;
    bookingHref?: string | null;
    unitSlug?: string | null;
};

type InstagramViewerSlide = {
    id: string;
    mediaType: "image" | "video";
    thumbnailUrl: string;
    videoUrl: string | null;
    width: number | null;
    height: number | null;
};

type InstagramViewerFact =
    | { kind: "likes" | "comments" | "plays"; value: string }
    | { kind: "text"; value: string };

type InstagramPreviewComment = {
    id: string;
    author: string;
    authorIsHandle: boolean;
    text: string;
};

type InstagramPayloadAsset = {
    url: string;
    width: number | null;
    height: number | null;
};

const INSTAGRAM_PAGE_SIZE = 9;
const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(",");

function getInstagramMediaLabel(item: InstagramMedia): string {
    if (item.isStory) return "Story";
    if (item.isReel) return "Reel";
    if (item.mediaType === "video") return "Vídeo";
    if (item.mediaType === "carousel") return "Carrossel";
    return "Post";
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInstagramFeed(params: {
    handle: string;
    userId?: string | null;
    cursor?: string | null;
    count?: number;
    attempts?: number;
    forceRefreshOnLastAttempt?: boolean;
}): Promise<InstagramFeedResponse | null> {
    const attempts = Math.max(1, params.attempts ?? 3);
    for (let i = 0; i < attempts; i++) {
        try {
            const qs = new URLSearchParams({ handle: params.handle });
            if (params.userId) qs.set("userId", params.userId);
            if (params.cursor) qs.set("cursor", params.cursor);
            if (typeof params.count === "number" && Number.isFinite(params.count)) {
                qs.set("count", String(Math.max(1, Math.floor(params.count))));
            }
            const shouldForceRefresh = Boolean(
                params.forceRefreshOnLastAttempt && !params.cursor && i === attempts - 1,
            );
            if (shouldForceRefresh) qs.set("refresh", "1");
            const res = await fetch(`/api/instagram-feed?${qs.toString()}`, { cache: "no-store" });
            const json = (await res.json().catch(() => null)) as InstagramFeedResponse | null;
            if (json && json.ok) return json;

            if (i < attempts - 1) {
                await sleep(250 * (i + 1));
                continue;
            }
            return json;
        } catch {
            if (i < attempts - 1) {
                await sleep(250 * (i + 1));
                continue;
            }
            return null;
        }
    }
    return null;
}

function formatInstagramDate(timestampMs: number | null): string | null {
    if (!timestampMs || !Number.isFinite(timestampMs)) return null;
    try {
        const parts = new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "short",
        }).formatToParts(new Date(timestampMs));
        const day = parts.find((part) => part.type === "day")?.value ?? "";
        const month = (parts.find((part) => part.type === "month")?.value ?? "").toLowerCase();
        if (!day || !month) return null;
        return `${day} de ${month}`;
    } catch {
        return null;
    }
}

function formatSocialCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    if (value < 1000) return String(value);
    if (value < 1000000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} mil`;
    return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} mi`;
}

function pickLargestPayloadMediaAsset(candidates: unknown): InstagramPayloadAsset | null {
    if (!Array.isArray(candidates)) return null;
    let fallback: InstagramPayloadAsset | null = null;
    let winner: (InstagramPayloadAsset & { area: number }) | null = null;

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const entry = candidate as { url?: unknown; width?: unknown; height?: unknown };
        if (typeof entry.url !== "string" || !entry.url.trim()) continue;
        const width = Number(entry.width);
        const height = Number(entry.height);
        const normalizedWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : null;
        const normalizedHeight = Number.isFinite(height) && height > 0 ? Math.floor(height) : null;
        const asset = {
            url: entry.url.trim(),
            width: normalizedWidth,
            height: normalizedHeight,
        } satisfies InstagramPayloadAsset;
        if (!fallback) fallback = asset;

        const area = normalizedWidth && normalizedHeight ? normalizedWidth * normalizedHeight : 0;

        if (!winner || area > winner.area) {
            winner = { ...asset, area };
        }
    }

    return winner ?? fallback;
}

function getInstagramPayloadPrimaryAsset(payloadJson: string | null | undefined): InstagramPayloadAsset | null {
    if (!payloadJson) return null;
    try {
        const payload = JSON.parse(payloadJson) as {
            image_versions2?: { candidates?: unknown } | null;
            video_versions?: unknown;
        };
        return (
            pickLargestPayloadMediaAsset(payload.image_versions2?.candidates) ??
            pickLargestPayloadMediaAsset(payload.video_versions)
        );
    } catch {
        return null;
    }
}

function getInstagramViewerSlides(item: InstagramMedia | null): InstagramViewerSlide[] {
    if (!item) return [];
    const fallbackAsset = getInstagramPayloadPrimaryAsset(item.payloadJson) ?? {
        url: item.thumbnailUrl,
        width: null,
        height: null,
    };

    const fallbackSlide: InstagramViewerSlide = {
        id: `${item.id}:0`,
        mediaType: item.mediaType === "video" && item.videoUrl ? "video" : "image",
        thumbnailUrl: fallbackAsset.url,
        videoUrl: item.videoUrl ?? null,
        width: fallbackAsset.width,
        height: fallbackAsset.height,
    };

    if (item.mediaType !== "carousel" || !item.payloadJson) return [fallbackSlide];

    try {
        const payload = JSON.parse(item.payloadJson) as { carousel_media?: unknown };
        if (!Array.isArray(payload.carousel_media)) return [fallbackSlide];

        const slides = payload.carousel_media
            .map((entry, index) => {
                if (!entry || typeof entry !== "object") return null;
                const media = entry as {
                    id?: unknown;
                    pk?: unknown;
                    media_type?: unknown;
                    image_versions2?: { candidates?: unknown } | null;
                    video_versions?: unknown;
                };
                const thumbnailAsset =
                    pickLargestPayloadMediaAsset(media.image_versions2?.candidates) ??
                    pickLargestPayloadMediaAsset(media.video_versions);
                if (!thumbnailAsset) return null;

                const videoAsset = pickLargestPayloadMediaAsset(media.video_versions);
                const mediaType = Number(media.media_type) === 2 && videoAsset?.url ? "video" : "image";
                const mediaId = `${media.id ?? media.pk ?? index}`.trim();

                return {
                    id: `${item.id}:${mediaId || index}`,
                    mediaType,
                    thumbnailUrl: thumbnailAsset.url,
                    videoUrl: videoAsset?.url ?? null,
                    width: thumbnailAsset.width,
                    height: thumbnailAsset.height,
                } satisfies InstagramViewerSlide;
            })
            .filter((entry): entry is InstagramViewerSlide => !!entry);

        return slides.length ? slides : [fallbackSlide];
    } catch {
        return [fallbackSlide];
    }
}

function extractInstagramPreviewComments(payloadJson: string | null | undefined): InstagramPreviewComment[] {
    if (!payloadJson) return [];

    try {
        const payload = JSON.parse(payloadJson) as {
            preview_comments?: unknown;
            latest_comments?: unknown;
            comments?: unknown;
            comment_threading_info?: { preview_comments?: unknown } | null;
        };

        const candidateLists = [
            payload.preview_comments,
            payload.latest_comments,
            payload.comment_threading_info?.preview_comments,
            payload.comments,
        ];

        for (const candidate of candidateLists) {
            if (!Array.isArray(candidate) || candidate.length === 0) continue;

            const comments = candidate
                .map((entry, index) => {
                    if (!entry || typeof entry !== "object") return null;
                    const comment = entry as {
                        pk?: unknown;
                        id?: unknown;
                        text?: unknown;
                        user?: { username?: unknown; full_name?: unknown } | null;
                    };

                    const text = typeof comment.text === "string" ? comment.text.trim() : "";
                    if (!text) return null;

                    const username = typeof comment.user?.username === "string" ? comment.user.username.trim() : "";
                    const fullName = typeof comment.user?.full_name === "string" ? comment.user.full_name.trim() : "";
                    const author = username || fullName || "Instagram";
                    const id = `${comment.pk ?? comment.id ?? index}`.trim();

                    return {
                        id: id || String(index),
                        author,
                        authorIsHandle: Boolean(username),
                        text,
                    } satisfies InstagramPreviewComment;
                })
                .filter((entry): entry is InstagramPreviewComment => !!entry);

            if (comments.length) return comments.slice(0, 3);
        }

        return [];
    } catch {
        return [];
    }
}

export function InstagramIcon(props: { size?: number }) {
    const size = props.size ?? 16;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm5.25-.9a1.15 1.15 0 1 1 0 2.3a1.15 1.15 0 0 1 0-2.3Z"
            />
        </svg>
    );
}

function InstagramHeartIcon(props: { size?: number }) {
    const size = props.size ?? 14;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.5L12 21.35Z"
            />
        </svg>
    );
}

function InstagramCommentIcon(props: { size?: number }) {
    const size = props.size ?? 14;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z"
            />
        </svg>
    );
}

function InstagramPlayIcon(props: { size?: number }) {
    const size = props.size ?? 14;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M8 5.5a1 1 0 0 1 1.52-.86l9 5.5a1 1 0 0 1 0 1.72l-9 5.5A1 1 0 0 1 8 16.5v-11Z"
            />
        </svg>
    );
}

function InstagramCarouselIcon(props: { size?: number }) {
    const size = props.size ?? 14;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M7 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-3 4H3v11a3 3 0 0 0 3 3h11v-1H6a2 2 0 0 1-2-2V7Z"
            />
        </svg>
    );
}

function InstagramReelIcon(props: { size?: number }) {
    const size = props.size ?? 14;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M8 5.25h8c3.18 0 4.77 0 5.76.98c.99.99.99 2.58.99 5.77v.01c0 3.18 0 4.77-.99 5.76c-.99.99-2.58.99-5.76.99H8c-3.18 0-4.77 0-5.76-.99c-.99-.99-.99-2.58-.99-5.76V12c0-3.19 0-4.78.99-5.77c.99-.98 2.58-.98 5.76-.98Zm2.26 3.9a.78.78 0 0 0-1.2.66v4.38a.78.78 0 0 0 1.2.66l3.6-2.19a.78.78 0 0 0 0-1.32l-3.6-2.19Z"
            />
        </svg>
    );
}

export default function DoctorInstagramModal(props: {
    profile: DoctorInstagramProfile | null;
    onClose: () => void;
}) {
    const { profile, onClose } = props;
    const [viewportMetrics, setViewportMetrics] = useState({ width: 1440, height: 900 });
    const [instagramItems, setInstagramItems] = useState<InstagramMedia[]>([]);
    const [instagramUserId, setInstagramUserId] = useState<string | null>(null);
    const [instagramFollowersCount, setInstagramFollowersCount] = useState<number | null>(null);
    const [instagramFollowingCount, setInstagramFollowingCount] = useState<number | null>(null);
    const [instagramMediaCount, setInstagramMediaCount] = useState<number | null>(null);
    const [instagramIsPrivate, setInstagramIsPrivate] = useState<boolean | null>(null);
    const [instagramIsBusiness, setInstagramIsBusiness] = useState<boolean | null>(null);
    const [instagramCategoryName, setInstagramCategoryName] = useState<string | null>(null);
    const [instagramPublicEmail, setInstagramPublicEmail] = useState<string | null>(null);
    const [instagramPublicPhone, setInstagramPublicPhone] = useState<string | null>(null);
    const [instagramNextCursor, setInstagramNextCursor] = useState<string | null>(null);
    const [instagramHasMore, setInstagramHasMore] = useState(false);
    const [instagramLoading, setInstagramLoading] = useState(false);
    const [instagramLoadingMore, setInstagramLoadingMore] = useState(false);
    const [instagramError, setInstagramError] = useState<string | null>(null);
    const [activeInstagramMediaId, setActiveInstagramMediaId] = useState<string | null>(null);
    const [activeInstagramViewerSlideIndex, setActiveInstagramViewerSlideIndex] = useState(0);
    const [instagramViewerCaptionLineClamp, setInstagramViewerCaptionLineClamp] = useState(8);
    const [instagramFeedScrolling, setInstagramFeedScrolling] = useState(false);
    const [instagramReloadToken, setInstagramReloadToken] = useState(0);
    const instagramScrollRef = useRef<HTMLDivElement | null>(null);
    const instagramInfiniteSentinelRef = useRef<HTMLDivElement | null>(null);
    const modalCardRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const instagramViewerCopyRef = useRef<HTMLDivElement | null>(null);
    const instagramViewerCaptionRef = useRef<HTMLParagraphElement | null>(null);
    const instagramViewerFactsRef = useRef<HTMLDivElement | null>(null);
    const instagramViewerCommentsRef = useRef<HTMLDivElement | null>(null);
    const instagramFeedScrollHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadMoreInstagram = useCallback(async () => {
        if (!profile || !instagramUserId || !instagramNextCursor || instagramLoadingMore) return;

        setInstagramLoadingMore(true);
        setInstagramError(null);
        try {
            const json = await fetchInstagramFeed({
                handle: profile.handle,
                userId: instagramUserId,
                cursor: instagramNextCursor,
                count: INSTAGRAM_PAGE_SIZE,
                attempts: 3,
            });
            if (!json || !json.ok) {
                setInstagramError("Não foi possível carregar mais publicações.");
                return;
            }

            setInstagramItems((prev) => {
                const seen = new Set(prev.map((item) => item.id));
                const nextItems = json.items.filter((item) => !seen.has(item.id));
                return [...prev, ...nextItems];
            });
            setInstagramNextCursor(json.nextCursor ?? null);
            setInstagramHasMore(Boolean(json.hasMore && json.nextCursor));
        } catch {
            setInstagramError("Falha de rede ao carregar mais publicações.");
        } finally {
            setInstagramLoadingMore(false);
        }
    }, [instagramLoadingMore, instagramNextCursor, instagramUserId, profile]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const syncViewportMetrics = () => {
            const visualViewport = window.visualViewport;
            setViewportMetrics({
                width: Math.round(visualViewport?.width ?? window.innerWidth),
                height: Math.round(visualViewport?.height ?? window.innerHeight),
            });
        };

        syncViewportMetrics();
        window.addEventListener("resize", syncViewportMetrics);
        window.visualViewport?.addEventListener("resize", syncViewportMetrics);
        return () => {
            window.removeEventListener("resize", syncViewportMetrics);
            window.visualViewport?.removeEventListener("resize", syncViewportMetrics);
        };
    }, []);

    useEffect(() => {
        if (!profile) return;
        const currentProfile = profile;
        let cancelled = false;

        async function loadInstagramFeed() {
            setInstagramLoading(true);
            setInstagramLoadingMore(false);
            setInstagramError(null);
            setInstagramItems([]);
            setInstagramUserId(null);
            setInstagramFollowersCount(null);
            setInstagramFollowingCount(null);
            setInstagramMediaCount(null);
            setInstagramIsPrivate(null);
            setInstagramIsBusiness(null);
            setInstagramCategoryName(null);
            setInstagramPublicEmail(null);
            setInstagramPublicPhone(null);
            setInstagramNextCursor(null);
            setInstagramHasMore(false);
            setActiveInstagramMediaId(null);
            if (instagramScrollRef.current) instagramScrollRef.current.scrollTop = 0;

            try {
                const json = await fetchInstagramFeed({
                    handle: currentProfile.handle,
                    count: INSTAGRAM_PAGE_SIZE,
                    attempts: 3,
                    forceRefreshOnLastAttempt: true,
                });
                if (cancelled) return;
                if (!json || !json.ok) {
                    setInstagramError("Não foi possível carregar as publicações agora.");
                    return;
                }

                setInstagramItems(Array.isArray(json.items) ? json.items : []);
                setInstagramUserId(json.user?.id || null);
                setInstagramFollowersCount(typeof json.user?.followersCount === "number" ? json.user.followersCount : null);
                setInstagramFollowingCount(typeof json.user?.followingCount === "number" ? json.user.followingCount : null);
                setInstagramMediaCount(typeof json.user?.mediaCount === "number" ? json.user.mediaCount : null);
                setInstagramIsPrivate(typeof json.user?.isPrivate === "boolean" ? json.user.isPrivate : null);
                setInstagramIsBusiness(typeof json.user?.isBusiness === "boolean" ? json.user.isBusiness : null);
                setInstagramCategoryName(typeof json.user?.categoryName === "string" && json.user.categoryName.trim() ? json.user.categoryName.trim() : null);
                setInstagramPublicEmail(typeof json.user?.publicEmail === "string" && json.user.publicEmail.trim() ? json.user.publicEmail.trim() : null);
                setInstagramPublicPhone(typeof json.user?.publicPhone === "string" && json.user.publicPhone.trim() ? json.user.publicPhone.trim() : null);
                setInstagramNextCursor(json.nextCursor ?? null);
                setInstagramHasMore(Boolean(json.hasMore && json.nextCursor));
            } catch {
                if (cancelled) return;
                setInstagramError("Falha de rede ao carregar publicações.");
            } finally {
                if (!cancelled) setInstagramLoading(false);
            }
        }

        void loadInstagramFeed();
        return () => {
            cancelled = true;
        };
    }, [instagramReloadToken, profile]);

    const activeInstagramMediaIndex = useMemo(() => {
        if (!activeInstagramMediaId) return -1;
        return instagramItems.findIndex((item) => item.id === activeInstagramMediaId);
    }, [activeInstagramMediaId, instagramItems]);

    const activeInstagramMedia = useMemo(() => {
        if (activeInstagramMediaIndex < 0) return null;
        return instagramItems[activeInstagramMediaIndex] ?? null;
    }, [activeInstagramMediaIndex, instagramItems]);
    const activeInstagramViewerSlides = useMemo(() => getInstagramViewerSlides(activeInstagramMedia), [activeInstagramMedia]);
    const normalizedActiveInstagramViewerSlideIndex = useMemo(() => {
        if (!activeInstagramViewerSlides.length) return -1;
        return Math.min(activeInstagramViewerSlideIndex, activeInstagramViewerSlides.length - 1);
    }, [activeInstagramViewerSlideIndex, activeInstagramViewerSlides.length]);
    const activeInstagramViewerSlide = useMemo(() => {
        if (normalizedActiveInstagramViewerSlideIndex < 0) return null;
        return activeInstagramViewerSlides[normalizedActiveInstagramViewerSlideIndex] ?? null;
    }, [activeInstagramViewerSlides, normalizedActiveInstagramViewerSlideIndex]);
    const activeInstagramViewerAspectRatio = useMemo(() => {
        const width = activeInstagramViewerSlide?.width ?? null;
        const height = activeInstagramViewerSlide?.height ?? null;
        if (typeof width === "number" && width > 0 && typeof height === "number" && height > 0) {
            return Math.max(0.45, Math.min(2.4, width / height));
        }
        return 1;
    }, [activeInstagramViewerSlide?.height, activeInstagramViewerSlide?.width]);
    const activeInstagramMediaDate = useMemo(() => formatInstagramDate(activeInstagramMedia?.takenAtMs ?? null), [activeInstagramMedia?.takenAtMs]);
    const activeInstagramMediaFacts = useMemo<InstagramViewerFact[]>(() => {
        if (!activeInstagramMedia) return [];
        const playbackMetric = typeof activeInstagramMedia.playCount === "number" && Number.isFinite(activeInstagramMedia.playCount)
            ? activeInstagramMedia.playCount
            : typeof activeInstagramMedia.viewCount === "number" && Number.isFinite(activeInstagramMedia.viewCount)
                ? activeInstagramMedia.viewCount
                : null;

        const facts = [
            typeof activeInstagramMedia.likeCount === "number" && Number.isFinite(activeInstagramMedia.likeCount)
                ? { kind: "likes", value: formatSocialCount(activeInstagramMedia.likeCount) }
                : null,
            typeof activeInstagramMedia.commentCount === "number" && Number.isFinite(activeInstagramMedia.commentCount)
                ? { kind: "comments", value: formatSocialCount(activeInstagramMedia.commentCount) }
                : null,
            typeof playbackMetric === "number" && Number.isFinite(playbackMetric)
                ? { kind: "plays", value: formatSocialCount(playbackMetric) }
                : null,
            activeInstagramMedia.isPinned ? "post fixado" : null,
        ]
            .map((entry) => {
                if (!entry) return null;
                if (typeof entry === "string") return { kind: "text", value: entry } satisfies InstagramViewerFact;
                return entry;
            })
            .filter((entry): entry is InstagramViewerFact => !!entry);

        return facts;
    }, [activeInstagramMedia]);
    const activeInstagramHasInternalCarousel = activeInstagramViewerSlides.length > 1;
    const activeInstagramPreviewComments = useMemo(
        () => extractInstagramPreviewComments(activeInstagramMedia?.payloadJson),
        [activeInstagramMedia?.payloadJson],
    );
    const activeInstagramViewerLayoutStyle = useMemo<CSSProperties | undefined>(() => {
        if (!activeInstagramMediaId) return undefined;
        const viewportWidth = Math.max(360, viewportMetrics.width);
        const viewportHeight = Math.max(640, viewportMetrics.height);
        const shellGap = 14;
        const shellHorizontalMargin = viewportWidth > 900 ? 120 : 48;
        const modalChromeWidth = 56;
        const baseMinSidebarWidth = viewportWidth > 1200 ? 340 : 300;
        const maxShellWidth = Math.max(320, viewportWidth - shellHorizontalMargin);
        const maxStageHeight = Math.max(280, viewportHeight - (viewportWidth > 900 ? 250 : 280));
        const stageWidthFromHeight = Math.round(maxStageHeight * activeInstagramViewerAspectRatio);
        const preferredSidebarWidth = viewportWidth > 1400 ? 420 : viewportWidth > 1100 ? 380 : 340;
        const reservedSidebarWidth = Math.min(preferredSidebarWidth, Math.max(baseMinSidebarWidth, Math.round(maxShellWidth * 0.42)));
        const stageWidthFromWidth = Math.max(220, maxShellWidth - reservedSidebarWidth - shellGap);
        const stageWidth = Math.max(220, Math.min(stageWidthFromHeight, stageWidthFromWidth));
        const stageHeight = Math.max(220, Math.round(stageWidth / activeInstagramViewerAspectRatio));
        const minSidebarWidth = Math.min(baseMinSidebarWidth, stageWidth);
        const maxSidebarWidth = Math.min(stageWidth, preferredSidebarWidth);
        const sidebarWidth = Math.max(
            minSidebarWidth,
            Math.min(maxSidebarWidth, maxShellWidth - stageWidth - shellGap),
        );
        const cardWidth = stageWidth + sidebarWidth + shellGap + modalChromeWidth;

        return {
            "--instagram-viewer-aspect-ratio": String(activeInstagramViewerAspectRatio),
            "--instagram-viewer-stage-width": `${stageWidth}px`,
            "--instagram-viewer-stage-height": `${stageHeight}px`,
            "--instagram-viewer-sidebar-width": `${sidebarWidth}px`,
            "--instagram-viewer-card-width": `${cardWidth}px`,
            "--instagram-viewer-caption-lines": String(instagramViewerCaptionLineClamp),
        } as CSSProperties;
    }, [activeInstagramMediaId, activeInstagramViewerAspectRatio, instagramViewerCaptionLineClamp, viewportMetrics.height, viewportMetrics.width]);

    const hasPrevInstagramMedia = activeInstagramMediaIndex > 0;
    const hasNextInstagramMedia = activeInstagramMediaIndex >= 0 && activeInstagramMediaIndex < instagramItems.length - 1;
    const prevInstagramViewerActionKind = activeInstagramHasInternalCarousel && normalizedActiveInstagramViewerSlideIndex > 0 ? "slide" : "media";
    const nextInstagramViewerActionKind = activeInstagramHasInternalCarousel &&
        normalizedActiveInstagramViewerSlideIndex >= 0 &&
        normalizedActiveInstagramViewerSlideIndex < activeInstagramViewerSlides.length - 1
        ? "slide"
        : "media";
    const prevInstagramViewerUsesJumpArrow = activeInstagramHasInternalCarousel && prevInstagramViewerActionKind === "media";
    const nextInstagramViewerUsesJumpArrow = activeInstagramHasInternalCarousel && nextInstagramViewerActionKind === "media";
    const hasPrevInstagramViewerSlide = prevInstagramViewerActionKind === "slide" ? true : hasPrevInstagramMedia;
    const hasNextInstagramViewerSlide = nextInstagramViewerActionKind === "slide" ? true : hasNextInstagramMedia;

    const goToPrevInstagramViewerSlide = useCallback(() => {
        if (prevInstagramViewerActionKind === "slide") {
            setActiveInstagramViewerSlideIndex((current) => Math.max(0, current - 1));
            return;
        }
        if (hasPrevInstagramMedia) {
            setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex - 1]?.id ?? null);
        }
    }, [activeInstagramMediaIndex, hasPrevInstagramMedia, instagramItems, prevInstagramViewerActionKind]);

    const goToNextInstagramViewerSlide = useCallback(() => {
        if (nextInstagramViewerActionKind === "slide") {
            setActiveInstagramViewerSlideIndex((current) => Math.min(activeInstagramViewerSlides.length - 1, current + 1));
            return;
        }
        if (hasNextInstagramMedia) {
            setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex + 1]?.id ?? null);
        }
    }, [activeInstagramMediaIndex, activeInstagramViewerSlides.length, hasNextInstagramMedia, instagramItems, nextInstagramViewerActionKind]);

    useEffect(() => {
        if (!profile) return;

        const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.setTimeout(() => closeButtonRef.current?.focus(), 0);

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                if (activeInstagramMediaId) {
                    setActiveInstagramMediaId(null);
                    return;
                }
                onClose();
                return;
            }

            if (!activeInstagramMediaId) return;

            if (event.key === "ArrowLeft" && hasPrevInstagramViewerSlide) {
                event.preventDefault();
                goToPrevInstagramViewerSlide();
            }

            if (event.key === "ArrowRight" && hasNextInstagramViewerSlide) {
                event.preventDefault();
                goToNextInstagramViewerSlide();
            }

            if (event.key === "Tab") {
                const container = modalCardRef.current;
                if (!container) return;
                const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
                    (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
                );
                if (focusableElements.length === 0) return;
                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];
                const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

                if (event.shiftKey && activeElement === firstElement) {
                    event.preventDefault();
                    lastElement.focus();
                } else if (!event.shiftKey && activeElement === lastElement) {
                    event.preventDefault();
                    firstElement.focus();
                }
            }
        }

        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
            previousActiveElement?.focus?.();
        };
    }, [
        activeInstagramMediaId,
        goToNextInstagramViewerSlide,
        goToPrevInstagramViewerSlide,
        hasNextInstagramViewerSlide,
        hasPrevInstagramViewerSlide,
        onClose,
        profile,
    ]);

    useEffect(() => {
        if (!activeInstagramMediaId) return;
        if (instagramScrollRef.current) instagramScrollRef.current.scrollTop = 0;
    }, [activeInstagramMediaId]);

    useEffect(() => {
        return () => {
            if (instagramFeedScrollHideTimeoutRef.current) {
                clearTimeout(instagramFeedScrollHideTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        setActiveInstagramViewerSlideIndex(0);
    }, [activeInstagramMediaId]);

    useEffect(() => {
        if (!activeInstagramViewerSlides.length) return;
        setActiveInstagramViewerSlideIndex((current) => Math.min(current, activeInstagramViewerSlides.length - 1));
    }, [activeInstagramViewerSlides.length]);

    useEffect(() => {
        if (!activeInstagramMediaId) return;
        const copy = instagramViewerCopyRef.current;
        const caption = instagramViewerCaptionRef.current;
        if (!copy || !caption) return;

        const computeCaptionClamp = () => {
            const copyStyle = window.getComputedStyle(copy);
            const captionStyle = window.getComputedStyle(caption);
            const factsHeight = instagramViewerFactsRef.current?.offsetHeight ?? 0;
            const commentsHeight = instagramViewerCommentsRef.current?.offsetHeight ?? 0;
            const rowGapRaw = copyStyle.rowGap || copyStyle.gap || "0";
            const rowGap = Number.parseFloat(rowGapRaw);
            const lineHeight = Number.parseFloat(captionStyle.lineHeight);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
                setInstagramViewerCaptionLineClamp(8);
                return;
            }

            let occupiedHeight = factsHeight + commentsHeight;
            if (Number.isFinite(rowGap)) {
                if (factsHeight > 0) occupiedHeight += rowGap;
                if (commentsHeight > 0) occupiedHeight += rowGap;
            }

            const availableHeight = copy.clientHeight - occupiedHeight;
            const nextClamp = Math.max(2, Math.floor(availableHeight / lineHeight));
            setInstagramViewerCaptionLineClamp(nextClamp);
        };

        computeCaptionClamp();

        const observer = new ResizeObserver(() => computeCaptionClamp());
        observer.observe(copy);
        observer.observe(caption);
        if (instagramViewerFactsRef.current) observer.observe(instagramViewerFactsRef.current);
        if (instagramViewerCommentsRef.current) observer.observe(instagramViewerCommentsRef.current);
        return () => observer.disconnect();
    }, [activeInstagramMediaId, activeInstagramMediaFacts.length, activeInstagramPreviewComments.length, activeInstagramViewerAspectRatio, viewportMetrics.height, viewportMetrics.width]);

    useEffect(() => {
        if (!activeInstagramMediaId || !instagramHasMore || instagramLoadingMore) return;
        if (activeInstagramMediaIndex < 0) return;
        if (activeInstagramMediaIndex >= instagramItems.length - 3) {
            void loadMoreInstagram();
        }
    }, [activeInstagramMediaId, activeInstagramMediaIndex, instagramHasMore, instagramItems.length, instagramLoadingMore, loadMoreInstagram]);

    useEffect(() => {
        if (!profile || !instagramHasMore || instagramLoading || instagramLoadingMore) return;
        const root = instagramScrollRef.current;
        const sentinel = instagramInfiniteSentinelRef.current;
        if (!root || !sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    void loadMoreInstagram();
                }
            },
            {
                root,
                rootMargin: "300px 0px 300px 0px",
                threshold: 0.01,
            },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [instagramHasMore, instagramItems.length, instagramLoading, instagramLoadingMore, loadMoreInstagram, profile]);

    if (!profile) return null;

    return (
        <div
            className="modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Instagram de ${profile.name}`}
            onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (activeInstagramMediaId) {
                    setActiveInstagramMediaId(null);
                    return;
                }
                onClose();
            }}
        >
            <div
                className={`modalCard instagramModalCard ${activeInstagramMediaId ? "instagramModalCard--viewer" : ""}`.trim()}
                ref={modalCardRef}
                style={activeInstagramViewerLayoutStyle}
            >
                <div className="modalHeader instagramModalHeader">
                    <div className="instagramModalHeaderCopy">
                        <div className="modalTitle">{profile.name}</div>
                        <div className="instagramModalHandle">@{profile.handle}</div>
                    </div>
                    <div className="instagramModalHeaderActions">
                        <div className="instagramGalleryStats instagramGalleryStats--header" aria-label="Resumo do perfil">
                            <div className="instagramGalleryStat">
                                <strong>{formatSocialCount(instagramMediaCount ?? instagramItems.length)}</strong>
                                <span>publicações</span>
                            </div>
                            <div className="instagramGalleryStat">
                                <strong>{formatSocialCount(instagramFollowersCount)}</strong>
                                <span>seguidores</span>
                            </div>
                            <div className="instagramGalleryStat">
                                <strong>{formatSocialCount(instagramFollowingCount)}</strong>
                                <span>seguindo</span>
                            </div>
                        </div>
                        {profile.bookingHref ? (
                            <Link
                                className="cta cta--agende instagramModalBookBtn"
                                href={profile.bookingHref}
                                onClick={() =>
                                    trackBookingStart({
                                        placement: "doctor_grid",
                                        unitSlug: profile.unitSlug ?? null,
                                        doctorName: profile.name,
                                        bookingUrl: profile.bookingHref ?? undefined,
                                    })
                                }
                            >
                                AGENDE
                            </Link>
                        ) : null}
                        <button
                            className={`modalClose ${activeInstagramMediaId ? "modalClose--back" : ""}`.trim()}
                            type="button"
                            onClick={activeInstagramMediaId ? () => setActiveInstagramMediaId(null) : onClose}
                            aria-label={activeInstagramMediaId ? "Voltar para o feed" : "Fechar"}
                            ref={closeButtonRef}
                        >
                            {activeInstagramMediaId ? "↩" : "×"}
                        </button>
                    </div>
                </div>
                <div
                    className="modalBody instagramModalBody"
                    ref={instagramScrollRef}
                    data-scrolling={instagramFeedScrolling ? "true" : "false"}
                    onScroll={() => {
                        setInstagramFeedScrolling(true);
                        if (instagramFeedScrollHideTimeoutRef.current) {
                            clearTimeout(instagramFeedScrollHideTimeoutRef.current);
                        }
                        instagramFeedScrollHideTimeoutRef.current = setTimeout(() => {
                            setInstagramFeedScrolling(false);
                        }, 560);
                    }}
                >
                    {instagramLoading && instagramItems.length === 0 ? <div className="instagramFallback">Carregando publicações e reels…</div> : null}

                    {!instagramLoading && instagramItems.length === 0 ? (
                        <div className="instagramFallback">
                            {instagramError ? "Não foi possível carregar o Instagram agora. Tente novamente em instantes." : "Nenhuma publicação visível neste perfil no momento."}
                            {instagramError ? (
                                <div className="modalActions">
                                    <button
                                        className="btn btnGhost instagramLoadMoreBtn"
                                        type="button"
                                        onClick={() => setInstagramReloadToken((value) => value + 1)}
                                        disabled={instagramLoading}
                                    >
                                        Tentar novamente
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {activeInstagramMedia ? (
                        <div className="instagramViewerShell">
                                <div className="instagramViewerStage">
                                    <div
                                        className="instagramViewerMediaWrap"
                                        style={
                                            {
                                                "--instagram-viewer-image": `url("${(activeInstagramViewerSlide ?? activeInstagramMedia).thumbnailUrl}")`,
                                            } as CSSProperties
                                        }
                                    >
                                        {hasPrevInstagramViewerSlide ? (
                                            <button
                                                className={`instagramViewerArrow instagramViewerArrow--left ${prevInstagramViewerUsesJumpArrow ? "instagramViewerArrow--jump" : ""}`.trim()}
                                                type="button"
                                                onClick={goToPrevInstagramViewerSlide}
                                                aria-label={prevInstagramViewerActionKind === "slide" ? "Ver imagem anterior do carrossel" : "Ver publicação anterior"}
                                            >
                                                {prevInstagramViewerActionKind === "slide" ? "‹" : prevInstagramViewerUsesJumpArrow ? "«" : "‹"}
                                            </button>
                                        ) : null}

                                        {activeInstagramViewerSlide?.mediaType === "video" && activeInstagramViewerSlide.videoUrl ? (
                                            <video
                                                key={activeInstagramViewerSlide.id}
                                                className="instagramViewerMedia"
                                                src={activeInstagramViewerSlide.videoUrl}
                                                poster={activeInstagramViewerSlide.thumbnailUrl}
                                                autoPlay
                                                controls
                                                muted
                                                playsInline
                                                preload="metadata"
                                            />
                                        ) : (
                                            <Image
                                                className="instagramViewerMedia"
                                                src={(activeInstagramViewerSlide ?? activeInstagramMedia).thumbnailUrl}
                                                alt={`Publicação de ${profile.name}`}
                                                width={1400}
                                                height={1400}
                                                loading="lazy"
                                                unoptimized
                                            />
                                        )}

                                        {activeInstagramHasInternalCarousel ? (
                                            <div className="instagramViewerDots" aria-label="Imagens do carrossel">
                                                {activeInstagramViewerSlides.map((slide, index) => (
                                                    <button
                                                        key={slide.id}
                                                        type="button"
                                                        className={`instagramViewerDot ${normalizedActiveInstagramViewerSlideIndex === index ? "instagramViewerDot--active" : ""}`.trim()}
                                                        onClick={() => setActiveInstagramViewerSlideIndex(index)}
                                                        aria-label={`Abrir imagem ${index + 1} do carrossel`}
                                                    >
                                                        <span className="instagramViewerDot__core" />
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}

                                        {hasNextInstagramViewerSlide ? (
                                            <button
                                                className={`instagramViewerArrow instagramViewerArrow--right ${nextInstagramViewerUsesJumpArrow ? "instagramViewerArrow--jump" : ""}`.trim()}
                                                type="button"
                                                onClick={goToNextInstagramViewerSlide}
                                                aria-label={nextInstagramViewerActionKind === "slide" ? "Ver próxima imagem do carrossel" : "Ver próxima publicação"}
                                            >
                                                {nextInstagramViewerActionKind === "slide" ? "›" : nextInstagramViewerUsesJumpArrow ? "»" : "›"}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>

                                <aside className="instagramViewerSidebar">
                                    <div className="instagramViewerCopy" ref={instagramViewerCopyRef}>
                                        <div className="instagramViewerCopyHeader">
                                            {activeInstagramMedia.caption ? (
                                                <p className="instagramViewerCaption" ref={instagramViewerCaptionRef}>{activeInstagramMedia.caption}</p>
                                            ) : (
                                                <p className="instagramViewerCaption instagramViewerCaption--muted" ref={instagramViewerCaptionRef}>
                                                    Sem legenda pública nesta publicação.
                                                </p>
                                            )}
                                            {activeInstagramMediaDate ? <div className="instagramViewerDate">{activeInstagramMediaDate}</div> : null}
                                        </div>
                                        {activeInstagramMediaFacts.length ? (
                                            <div className="instagramViewerFacts" aria-label="Métricas e metadados da publicação" ref={instagramViewerFactsRef}>
                                                {activeInstagramMediaFacts.map((fact) => (
                                                    <span key={`${fact.kind}:${fact.value}`} className={`instagramViewerFact instagramViewerFact--${fact.kind}`.trim()}>
                                                        {fact.kind === "likes" ? <InstagramHeartIcon /> : null}
                                                        {fact.kind === "comments" ? <InstagramCommentIcon /> : null}
                                                        {fact.kind === "plays" ? <InstagramPlayIcon /> : null}
                                                        <span>{fact.value}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        ) : null}
                                        {activeInstagramPreviewComments.length ? (
                                            <div className="instagramViewerComments" aria-label="Comentários em destaque" ref={instagramViewerCommentsRef}>
                                                {activeInstagramPreviewComments.map((comment) => (
                                                    <article key={comment.id} className="instagramViewerComment">
                                                        <div className="instagramViewerCommentAuthor">{comment.authorIsHandle ? `@${comment.author}` : comment.author}</div>
                                                        <p className="instagramViewerCommentText">{comment.text}</p>
                                                    </article>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="instagramViewerThumbs" aria-label="Outras publicações">
                                        {instagramItems.map((item, index) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={`instagramViewerThumb ${activeInstagramMediaId === item.id ? "instagramViewerThumb--active" : ""}`.trim()}
                                                onClick={() => setActiveInstagramMediaId(item.id)}
                                                aria-label={`Abrir ${getInstagramMediaLabel(item).toLowerCase()} ${index + 1}`}
                                            >
                                                <Image
                                                    className="instagramViewerThumbImage"
                                                    src={item.thumbnailUrl}
                                                    alt=""
                                                    width={120}
                                                    height={120}
                                                    loading="lazy"
                                                    unoptimized
                                                />
                                                {item.isReel ? (
                                                    <span className="instagramViewerThumbBadge" aria-label="Reel">
                                                        <InstagramReelIcon />
                                                    </span>
                                                ) : item.mediaType === "carousel" ? (
                                                    <span className="instagramViewerThumbBadge" aria-label="Carrossel">
                                                        <InstagramCarouselIcon />
                                                    </span>
                                                ) : null}
                                            </button>
                                        ))}
                                    </div>
                                </aside>
                        </div>
                    ) : null}

                    {instagramItems.length > 0 && !activeInstagramMedia ? (
                        <>
                            {instagramCategoryName || instagramPublicEmail || instagramPublicPhone || instagramIsPrivate != null || instagramIsBusiness != null ? (
                                <div className="instagramGalleryFacts" aria-label="Metadados do perfil">
                                    {instagramCategoryName ? <span className="instagramGalleryFact">categoria: {instagramCategoryName}</span> : null}
                                    {instagramIsPrivate === true ? <span className="instagramGalleryFact">perfil privado</span> : null}
                                    {instagramIsBusiness === true ? <span className="instagramGalleryFact">conta business</span> : null}
                                    {instagramPublicEmail ? <span className="instagramGalleryFact">{instagramPublicEmail}</span> : null}
                                    {instagramPublicPhone ? <span className="instagramGalleryFact">{instagramPublicPhone}</span> : null}
                                </div>
                            ) : null}

                            <div className="instagramGrid">
                                {instagramItems.map((item) => {
                                    const label = getInstagramMediaLabel(item);
                                    const itemDate = formatInstagramDate(item.takenAtMs);
                                    const likeCountLabel = typeof item.likeCount === "number" && Number.isFinite(item.likeCount)
                                        ? formatSocialCount(item.likeCount)
                                        : null;
                                    const commentCountLabel = typeof item.commentCount === "number" && Number.isFinite(item.commentCount)
                                        ? formatSocialCount(item.commentCount)
                                        : null;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`instagramMediaBtn ${activeInstagramMediaId === item.id ? "instagramMediaBtn--active" : ""}`.trim()}
                                            onClick={() => setActiveInstagramMediaId(item.id)}
                                            aria-label={`Abrir ${label.toLowerCase()} de ${profile.name}`}
                                        >
                                            <Image
                                                className="instagramMediaThumb"
                                                src={item.thumbnailUrl}
                                                alt={`Publicação de ${profile.name}`}
                                                width={320}
                                                height={320}
                                                loading="lazy"
                                                unoptimized
                                            />
                                            <span className="instagramMediaOverlay" aria-hidden="true">
                                                {likeCountLabel ? (
                                                    <span className="instagramMediaOverlayStat">
                                                        <InstagramHeartIcon />
                                                        <span>{likeCountLabel}</span>
                                                    </span>
                                                ) : null}
                                                {commentCountLabel ? (
                                                    <span className="instagramMediaOverlayStat">
                                                        <InstagramCommentIcon />
                                                        <span>{commentCountLabel}</span>
                                                    </span>
                                                ) : null}
                                            </span>
                                            {item.isReel ? (
                                                <span className="instagramMediaBadge" aria-label="Reel">
                                                    <InstagramReelIcon />
                                                </span>
                                            ) : item.mediaType === "carousel" ? (
                                                <span className="instagramMediaBadge" aria-label="Carrossel">
                                                    <InstagramCarouselIcon />
                                                </span>
                                            ) : null}
                                            {itemDate ? <span className="instagramMediaDate">{itemDate}</span> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : null}

                    {instagramError && instagramItems.length > 0 ? (
                        <div className="instagramInlineError">
                            {instagramError}
                            <div className="modalActions">
                                <button
                                    className="btn btnGhost instagramLoadMoreBtn"
                                    type="button"
                                    onClick={() => setInstagramReloadToken((value) => value + 1)}
                                    disabled={instagramLoading}
                                >
                                    Recarregar feed
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {instagramHasMore ? <div className="instagramInfiniteSentinel" ref={instagramInfiniteSentinelRef} aria-hidden="true" /> : null}
                    {instagramLoadingMore ? <div className="instagramLoadingMoreInline">Carregando mais publicações…</div> : null}
                </div>
            </div>
        </div>
    );
}
