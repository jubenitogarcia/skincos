"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

type InstagramMedia = {
    id: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    caption: string | null;
    takenAtMs: number | null;
    thumbnailUrl: string;
    videoUrl: string | null;
};

type InstagramFeedResponse =
    | {
          ok: true;
          user: { id: string; handle: string; name: string | null; bio: string | null };
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

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInstagramFeed(params: {
    handle: string;
    userId?: string | null;
    cursor?: string | null;
    count?: number;
    attempts?: number;
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
    const [instagramNextCursor, setInstagramNextCursor] = useState<string | null>(null);
    const [instagramHasMore, setInstagramHasMore] = useState(false);
    const [instagramLoading, setInstagramLoading] = useState(false);
    const [instagramLoadingMore, setInstagramLoadingMore] = useState(false);
    const [instagramError, setInstagramError] = useState<string | null>(null);
    const [activeInstagramMediaId, setActiveInstagramMediaId] = useState<string | null>(null);
    const [instagramReloadToken, setInstagramReloadToken] = useState(0);
    const instagramScrollRef = useRef<HTMLDivElement | null>(null);
    const instagramInfiniteSentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!profile) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Escape") return;
            if (activeInstagramMediaId) {
                setActiveInstagramMediaId(null);
                return;
            }
            onClose();
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [activeInstagramMediaId, onClose, profile]);

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
            setInstagramNextCursor(null);
            setInstagramHasMore(false);
            setActiveInstagramMediaId(null);
            if (instagramScrollRef.current) instagramScrollRef.current.scrollTop = 0;

            try {
                const json = await fetchInstagramFeed({
                    handle: currentProfile.handle,
                    count: INSTAGRAM_PAGE_SIZE,
                    attempts: 3,
                });
                if (cancelled) return;
                if (!json || !json.ok) {
                    setInstagramError("Não foi possível carregar as publicações agora.");
                    return;
                }

                setInstagramItems(Array.isArray(json.items) ? json.items : []);
                setInstagramUserId(json.user?.id || null);
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

    const hasPrevInstagramMedia = activeInstagramMediaIndex > 0;
    const hasNextInstagramMedia = activeInstagramMediaIndex >= 0 && activeInstagramMediaIndex < instagramItems.length - 1;

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
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="modalCard instagramModalCard">
                <div className="modalHeader">
                    <div>
                        <div className="modalTitle">{profile.name}</div>
                        <div className="modalSubtitle">@{profile.handle}</div>
                    </div>
                    <button className="modalClose" type="button" onClick={onClose} aria-label="Fechar">
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
                            <div className="instagramViewerTop">
                                <button className="btn btnGhost instagramViewerBack" type="button" onClick={() => setActiveInstagramMediaId(null)}>
                                    Voltar ao grid
                                </button>
                                <div className="instagramViewerNav">
                                    <button
                                        className="btn btnGhost instagramViewerStep"
                                        type="button"
                                        disabled={!hasPrevInstagramMedia}
                                        onClick={() => {
                                            if (!hasPrevInstagramMedia) return;
                                            setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex - 1]?.id ?? null);
                                        }}
                                    >
                                        Anterior
                                    </button>
                                    <button
                                        className="btn btnGhost instagramViewerStep"
                                        type="button"
                                        disabled={!hasNextInstagramMedia}
                                        onClick={() => {
                                            if (!hasNextInstagramMedia) return;
                                            setActiveInstagramMediaId(instagramItems[activeInstagramMediaIndex + 1]?.id ?? null);
                                        }}
                                    >
                                        Próximo
                                    </button>
                                </div>
                            </div>

                            <div className="instagramViewerMediaWrap">
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
                                        width={1200}
                                        height={1200}
                                        loading="lazy"
                                        unoptimized
                                    />
                                )}
                            </div>

                            {activeInstagramMedia.caption ? <p className="instagramViewerCaption">{activeInstagramMedia.caption}</p> : null}
                        </div>
                    ) : null}

                    {instagramItems.length > 0 ? (
                        <div className="instagramGrid">
                            {instagramItems.map((item) => {
                                const label = item.isReel ? "Reel" : item.mediaType === "video" ? "Vídeo" : item.mediaType === "carousel" ? "Carrossel" : "Post";
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
                                        {label !== "Post" ? <span className="instagramMediaBadge">{label}</span> : null}
                                    </button>
                                );
                            })}
                        </div>
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
                    <div className="modalNote">Posts e reels são exibidos dentro desta janela para manter você no site.</div>
                </div>
            </div>
        </div>
    );
}
