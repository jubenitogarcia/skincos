"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

type InstagramMedia = {
    id: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    isStory?: boolean;
    caption: string | null;
    takenAtMs: number | null;
    thumbnailUrl: string;
    videoUrl: string | null;
    permalink?: string | null;
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
        };
        items: InstagramMedia[];
        hasMore: boolean;
        nextCursor: string | null;
    }
    | { ok: false; error: string };

export type DoctorInstagramProfile = {
    name: string;
    handle: string;
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
        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }).format(new Date(timestampMs));
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

export default function DoctorInstagramModal(props: {
    profile: DoctorInstagramProfile | null;
    onClose: () => void;
}) {
    const { profile, onClose } = props;
    const [instagramItems, setInstagramItems] = useState<InstagramMedia[]>([]);
    const [instagramUserId, setInstagramUserId] = useState<string | null>(null);
    const [instagramUserName, setInstagramUserName] = useState<string | null>(null);
    const [instagramUserBio, setInstagramUserBio] = useState<string | null>(null);
    const [instagramFollowersCount, setInstagramFollowersCount] = useState<number | null>(null);
    const [instagramFollowingCount, setInstagramFollowingCount] = useState<number | null>(null);
    const [instagramMediaCount, setInstagramMediaCount] = useState<number | null>(null);
    const [instagramNextCursor, setInstagramNextCursor] = useState<string | null>(null);
    const [instagramHasMore, setInstagramHasMore] = useState(false);
    const [instagramLoading, setInstagramLoading] = useState(false);
    const [instagramLoadingMore, setInstagramLoadingMore] = useState(false);
    const [instagramError, setInstagramError] = useState<string | null>(null);
    const [activeInstagramMediaId, setActiveInstagramMediaId] = useState<string | null>(null);
    const [instagramReloadToken, setInstagramReloadToken] = useState(0);
    const instagramScrollRef = useRef<HTMLDivElement | null>(null);
    const instagramInfiniteSentinelRef = useRef<HTMLDivElement | null>(null);
    const modalCardRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
        if (!profile) return;
        const currentProfile = profile;
        let cancelled = false;

        async function loadInstagramFeed() {
            setInstagramLoading(true);
            setInstagramLoadingMore(false);
            setInstagramError(null);
            setInstagramItems([]);
            setInstagramUserId(null);
            setInstagramUserName(null);
            setInstagramUserBio(null);
            setInstagramFollowersCount(null);
            setInstagramFollowingCount(null);
            setInstagramMediaCount(null);
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
                setInstagramUserName(json.user?.name || null);
                setInstagramUserBio(json.user?.bio || null);
                setInstagramFollowersCount(typeof json.user?.followersCount === "number" ? json.user.followersCount : null);
                setInstagramFollowingCount(typeof json.user?.followingCount === "number" ? json.user.followingCount : null);
                setInstagramMediaCount(typeof json.user?.mediaCount === "number" ? json.user.mediaCount : null);
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
    const activeInstagramMediaDate = useMemo(() => formatInstagramDate(activeInstagramMedia?.takenAtMs ?? null), [activeInstagramMedia?.takenAtMs]);

    const hasPrevInstagramMedia = activeInstagramMediaIndex > 0;
    const hasNextInstagramMedia = activeInstagramMediaIndex >= 0 && activeInstagramMediaIndex < instagramItems.length - 1;

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

            if (event.key === "ArrowLeft" && hasPrevInstagramMedia) {
                event.preventDefault();
                setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex - 1]?.id ?? null);
            }

            if (event.key === "ArrowRight" && hasNextInstagramMedia) {
                event.preventDefault();
                setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex + 1]?.id ?? null);
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
    }, [activeInstagramMediaId, activeInstagramMediaIndex, hasNextInstagramMedia, hasPrevInstagramMedia, instagramItems, onClose, profile]);

    useEffect(() => {
        if (!activeInstagramMediaId) return;
        if (instagramScrollRef.current) instagramScrollRef.current.scrollTop = 0;
    }, [activeInstagramMediaId]);

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

    const profileUrl = `https://www.instagram.com/${profile.handle}/`;
    const activeInstagramMediaUrl = activeInstagramMedia?.permalink || profileUrl;

    return (
        <div
            className="modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Instagram de ${profile.name}`}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="modalCard instagramModalCard" ref={modalCardRef}>
                <div className="modalHeader">
                    <div>
                        <div className="modalTitle">{profile.name}</div>
                        <div className="modalSubtitle">
                            @{profile.handle}
                            {instagramUserName && instagramUserName !== profile.name ? <span className="instagramHeaderMeta">· {instagramUserName}</span> : null}
                        </div>
                    </div>
                    <button className="modalClose" type="button" onClick={onClose} aria-label="Fechar" ref={closeButtonRef}>
                        ×
                    </button>
                </div>
                <div className="modalBody instagramModalBody" ref={instagramScrollRef}>
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
                        <div className="instagramViewer">
                            <div className="instagramViewerShell">
                                <div className="instagramViewerStage">
                                    <div
                                        className="instagramViewerMediaWrap"
                                        style={
                                            {
                                                "--instagram-viewer-image": `url("${activeInstagramMedia.thumbnailUrl}")`,
                                            } as CSSProperties
                                        }
                                    >
                                        {hasPrevInstagramMedia ? (
                                            <button
                                                className="instagramViewerArrow instagramViewerArrow--left"
                                                type="button"
                                                onClick={() => setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex - 1]?.id ?? null)}
                                                aria-label="Ver publicação anterior"
                                            >
                                                ‹
                                            </button>
                                        ) : null}

                                        {activeInstagramMedia.mediaType === "video" && activeInstagramMedia.videoUrl ? (
                                            <video
                                                className="instagramViewerMedia"
                                                src={activeInstagramMedia.videoUrl}
                                                poster={activeInstagramMedia.thumbnailUrl}
                                                controls
                                                playsInline
                                                preload="metadata"
                                            />
                                        ) : (
                                            <Image
                                                className="instagramViewerMedia"
                                                src={activeInstagramMedia.thumbnailUrl}
                                                alt={`Publicação de ${profile.name}`}
                                                width={1400}
                                                height={1400}
                                                loading="lazy"
                                                unoptimized
                                            />
                                        )}

                                        {hasNextInstagramMedia ? (
                                            <button
                                                className="instagramViewerArrow instagramViewerArrow--right"
                                                type="button"
                                                onClick={() => setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex + 1]?.id ?? null)}
                                                aria-label="Ver próxima publicação"
                                            >
                                                ›
                                            </button>
                                        ) : null}
                                    </div>
                                </div>

                                <aside className="instagramViewerSidebar">
                                    <div className="instagramViewerTop">
                                        <div className="instagramViewerMeta">
                                            <span className="instagramViewerBadge">{getInstagramMediaLabel(activeInstagramMedia)}</span>
                                            <span className="instagramViewerCounter">
                                                {activeInstagramMediaIndex + 1} de {instagramItems.length}
                                            </span>
                                        </div>
                                        <div className="instagramViewerNav">
                                            <button className="btn btnGhost instagramViewerBack" type="button" onClick={() => setActiveInstagramMediaId(null)}>
                                                Ver grade
                                            </button>
                                        </div>
                                    </div>

                                    <div className="instagramViewerCopy">
                                        <div className="instagramViewerHandleRow">
                                            <div className="instagramViewerHandle">@{profile.handle}</div>
                                            {activeInstagramMediaDate ? <div className="instagramViewerDate">{activeInstagramMediaDate}</div> : null}
                                        </div>
                                        {activeInstagramMedia.caption ? (
                                            <p className="instagramViewerCaption">{activeInstagramMedia.caption}</p>
                                        ) : (
                                            <p className="instagramViewerCaption instagramViewerCaption--muted">
                                                Sem legenda pública nesta publicação.
                                            </p>
                                        )}
                                    </div>

                                    <div className="modalActions">
                                        <a className="btn btnPrimary" href={activeInstagramMediaUrl} target="_blank" rel="noreferrer">
                                            Ver no Instagram
                                        </a>
                                        <a className="btn btnGhost" href={profileUrl} target="_blank" rel="noreferrer">
                                            Abrir perfil
                                        </a>
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
                                                {item.isReel || item.mediaType !== "image" ? (
                                                    <span className="instagramViewerThumbBadge">{getInstagramMediaLabel(item)}</span>
                                                ) : null}
                                            </button>
                                        ))}
                                    </div>
                                </aside>
                            </div>
                        </div>
                    ) : null}

                    {instagramItems.length > 0 && !activeInstagramMedia ? (
                        <>
                            <div className="instagramGalleryIntro">
                                <div className="instagramGalleryIntroCopy">
                                    <div className="instagramGalleryEyebrow">Galeria do Instagram</div>
                                    <p className="instagramGalleryLead">
                                        Toque em qualquer publicação para abrir um viewer com navegação lateral, atalhos de teclado e acesso direto ao Instagram.
                                    </p>
                                    {instagramUserBio ? <p className="instagramGalleryBio">{instagramUserBio}</p> : null}
                                </div>
                                <div className="instagramGalleryStats" aria-label="Resumo do perfil">
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
                                    <div className="instagramGalleryStat">
                                        <strong>{instagramHasMore ? "Ao vivo" : "Completo"}</strong>
                                        <span>{instagramHasMore ? "mais publicações disponíveis" : "feed carregado"}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="instagramGrid">
                                {instagramItems.map((item) => {
                                    const label = getInstagramMediaLabel(item);
                                    const itemDate = formatInstagramDate(item.takenAtMs);
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
                                                <span className="instagramMediaOverlayLabel">{label}</span>
                                                <span className="instagramMediaOverlayAction">Abrir</span>
                                            </span>
                                            {label !== "Post" ? <span className="instagramMediaBadge">{label}</span> : null}
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
                    <div className="modalNote">Posts, reels e stories são exibidos nesta janela para você navegar sem sair da página. Use `Esc` para fechar e as setas do teclado para navegar.</div>
                </div>
            </div>
        </div>
    );
}
