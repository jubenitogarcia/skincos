import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INSTAGRAM_APP_ID = "936619743392459";
const FEED_PAGE_SIZE = 9;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const MIN_FEED_PAGE_SIZE = 1;
const MAX_FEED_PAGE_SIZE = 24;

type InstagramProfileResponse = {
    data?: {
        user?: {
            id?: string;
            username?: string;
            full_name?: string;
            biography?: string;
        };
    };
};

type InstagramProfileUser = NonNullable<InstagramProfileResponse["data"]>["user"];

type CfCacheStorage = {
    default?: Cache;
};

type InstagramFeedImageCandidate = {
    url?: string;
    width?: number;
    height?: number;
};

type InstagramFeedVideoVersion = {
    url?: string;
    width?: number;
    height?: number;
};

type InstagramFeedItem = {
    id?: string;
    pk?: string;
    code?: string;
    media_type?: number;
    product_type?: string;
    taken_at?: number;
    caption?: { text?: string | null } | null;
    image_versions2?: { candidates?: InstagramFeedImageCandidate[] } | null;
    video_versions?: InstagramFeedVideoVersion[] | null;
    carousel_media?: InstagramFeedItem[] | null;
};

type InstagramFeedResponse = {
    items?: InstagramFeedItem[];
    more_available?: boolean;
    next_max_id?: string | null;
};

type NormalizedInstagramMedia = {
    id: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    caption: string | null;
    takenAtMs: number | null;
    thumbnailUrl: string;
    videoUrl: string | null;
};

function sanitizeHandle(input: string): string {
    return (input ?? "").trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").toLowerCase();
}

function sanitizeUserId(input: string): string {
    return (input ?? "").trim().replace(/[^0-9]/g, "");
}

function sanitizeCursor(input: string): string {
    return (input ?? "").trim().slice(0, 500);
}

function sanitizeCount(input: string): number {
    const parsed = Number.parseInt((input ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) return FEED_PAGE_SIZE;
    return Math.min(MAX_FEED_PAGE_SIZE, Math.max(MIN_FEED_PAGE_SIZE, parsed));
}

function instagramRequestHeaders(): HeadersInit {
    return {
        "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "x-ig-app-id": INSTAGRAM_APP_ID,
        origin: "https://www.instagram.com",
        referer: "https://www.instagram.com/",
    };
}

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInstagramJson<T>(url: string): Promise<T | null> {
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                redirect: "follow",
                headers: instagramRequestHeaders(),
                next: { revalidate: 60 * 5 },
            });

            if (!res.ok) {
                if (attempt < MAX_FETCH_ATTEMPTS - 1 && isRetryableStatus(res.status)) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                    continue;
                }
                return null;
            }

            const raw = await res.text();
            const cleaned = raw.replace(/^for \(;;\);\s*/, "");

            try {
                return JSON.parse(cleaned) as T;
            } catch {
                if (attempt < MAX_FETCH_ATTEMPTS - 1) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                    continue;
                }
                return null;
            }
        } catch {
            if (attempt < MAX_FETCH_ATTEMPTS - 1) {
                await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                continue;
            }
            return null;
        }
    }
    return null;
}

async function fetchProfile(handle: string): Promise<InstagramProfileUser | null> {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
    const json = await fetchInstagramJson<InstagramProfileResponse>(url);
    return json?.data?.user ?? null;
}

async function fetchFeed(params: { userId: string; cursor?: string | null; count?: number }): Promise<InstagramFeedResponse | null> {
    const url = new URL(`https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(params.userId)}/`);
    url.searchParams.set("count", String(params.count ?? FEED_PAGE_SIZE));
    if (params.cursor) url.searchParams.set("max_id", params.cursor);
    return fetchInstagramJson<InstagramFeedResponse>(url.toString());
}

function pickLargestImage(candidates: InstagramFeedImageCandidate[] | null | undefined): string | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => {
        const areaA = (a.width ?? 0) * (a.height ?? 0);
        const areaB = (b.width ?? 0) * (b.height ?? 0);
        return areaB - areaA;
    });
    const best = sorted[0];
    return typeof best?.url === "string" ? best.url : null;
}

function pickLargestVideo(versions: InstagramFeedVideoVersion[] | null | undefined): string | null {
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const sorted = [...versions].sort((a, b) => {
        const areaA = (a.width ?? 0) * (a.height ?? 0);
        const areaB = (b.width ?? 0) * (b.height ?? 0);
        return areaB - areaA;
    });
    const best = sorted[0];
    return typeof best?.url === "string" ? best.url : null;
}

function normalizeItem(item: InstagramFeedItem): NormalizedInstagramMedia | null {
    const code = typeof item.code === "string" && item.code.trim() ? item.code.trim() : null;
    const id = `${item.id ?? item.pk ?? code ?? ""}`.trim();
    if (!id) return null;

    const mediaTypeNumber = item.media_type ?? 1;
    const isCarousel = mediaTypeNumber === 8;
    const isVideo = mediaTypeNumber === 2;

    let imageUrl = pickLargestImage(item.image_versions2?.candidates);
    let videoUrl = pickLargestVideo(item.video_versions);

    if (isCarousel && Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
        const first = item.carousel_media[0];
        imageUrl = imageUrl ?? pickLargestImage(first?.image_versions2?.candidates);
        if (!videoUrl) videoUrl = pickLargestVideo(first?.video_versions);
    }

    if (!imageUrl && !videoUrl) return null;

    return {
        id,
        code,
        mediaType: isCarousel ? "carousel" : isVideo ? "video" : "image",
        isReel: item.product_type === "clips",
        caption: typeof item.caption?.text === "string" && item.caption.text.trim() ? item.caption.text.trim() : null,
        takenAtMs: typeof item.taken_at === "number" ? item.taken_at * 1000 : null,
        thumbnailUrl: imageUrl ?? videoUrl ?? "",
        videoUrl: videoUrl ?? null,
    };
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const handle = sanitizeHandle(searchParams.get("handle") ?? "");
    const cursor = sanitizeCursor(searchParams.get("cursor") ?? "");
    const count = sanitizeCount(searchParams.get("count") ?? "");
    let userId = sanitizeUserId(searchParams.get("userId") ?? "");

    if (!handle) {
        return NextResponse.json({ ok: false, error: "invalid_handle" }, { status: 400 });
    }

    try {
        const cache = getCloudflareCache();
        const cacheKey = new Request(
            `https://espacofacial.com/__cache/instagram-feed?handle=${encodeURIComponent(handle)}&userId=${encodeURIComponent(userId)}&cursor=${encodeURIComponent(cursor)}&count=${count}`,
        );
        if (cache) {
            const cached = await cache.match(cacheKey);
            if (cached) {
                const payload = await cached.text();
                return new NextResponse(payload, {
                    status: 200,
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": cached.headers.get("cache-control") ?? "public, max-age=60, s-maxage=300",
                        "x-instagram-feed-source": "cache",
                    },
                });
            }
        }

        let profile: InstagramProfileUser | null = null;
        if (!userId) {
            profile = await fetchProfile(handle);
            userId = sanitizeUserId(profile?.id ?? "");
        }

        if (!userId) {
            return NextResponse.json({ ok: false, error: "profile_not_found" }, { status: 404 });
        }

        const feed = await fetchFeed({ userId, cursor: cursor || null, count });
        if (!feed) {
            return NextResponse.json({ ok: false, error: "feed_unavailable" }, { status: 502 });
        }

        const items = (feed.items ?? []).map(normalizeItem).filter((v): v is NormalizedInstagramMedia => !!v);
        const nextCursor = typeof feed.next_max_id === "string" && feed.next_max_id.trim() ? feed.next_max_id : null;
        const hasMore = Boolean(feed.more_available && nextCursor);

        const responseBody = {
            ok: true,
            user: {
                id: userId,
                handle: profile?.username ?? handle,
                name: profile?.full_name ?? null,
                bio: profile?.biography ?? null,
            },
            items,
            hasMore,
            nextCursor,
        };

        const payload = JSON.stringify(responseBody);
        if (cache) {
            await cache.put(
                cacheKey,
                new Response(payload, {
                    status: 200,
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": "public, max-age=60, s-maxage=300",
                    },
                }),
            );
        }

        return new NextResponse(payload, {
            status: 200,
            headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "public, max-age=60, s-maxage=300",
                "x-instagram-feed-source": "origin",
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "instagram_feed_error" }, { status: 500 });
    }
}
