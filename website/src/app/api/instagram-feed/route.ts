import { NextResponse } from "next/server";
import {
    fetchLiveInstagramFeedPage,
    getCachedInstagramFeed,
    INSTAGRAM_SYNC_TTL_MS,
    isInstagramProfileStale,
    normalizeInstagramHandleInput,
    syncInstagramHandle,
} from "@/lib/instagramSync";

export const dynamic = "force-dynamic";

const FEED_PAGE_SIZE = 9;
const MIN_FEED_PAGE_SIZE = 1;
const MAX_FEED_PAGE_SIZE = 24;

type CfCacheStorage = {
    default?: Cache;
};

function sanitizeCursor(input: string): string {
    return (input ?? "").trim().slice(0, 128);
}

function sanitizeCount(input: string): number {
    const parsed = Number.parseInt((input ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) return FEED_PAGE_SIZE;
    return Math.min(MAX_FEED_PAGE_SIZE, Math.max(MIN_FEED_PAGE_SIZE, parsed));
}

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function isTrue(raw: string | null): boolean {
    const normalized = (raw ?? "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);

    const handle = normalizeInstagramHandleInput(searchParams.get("handle") ?? "");
    const cursor = sanitizeCursor(searchParams.get("cursor") ?? "");
    const count = sanitizeCount(searchParams.get("count") ?? "");
    const includeStories = isTrue(searchParams.get("includeStories")) || searchParams.get("includeStories") === null;
    const forceRefresh = isTrue(searchParams.get("refresh"));

    if (!handle) {
        return NextResponse.json({ ok: false, error: "invalid_handle" }, { status: 400 });
    }

    const cache = getCloudflareCache();
    const cacheKey = new Request(
        `https://espacofacial.com/__cache/instagram-feed?handle=${encodeURIComponent(handle)}&cursor=${encodeURIComponent(cursor)}&count=${count}&stories=${includeStories ? 1 : 0}`,
    );

    try {
        if (cache && !forceRefresh) {
            const cached = await cache.match(cacheKey);
            if (cached) {
                const payload = await cached.text();
                return new NextResponse(payload, {
                    status: 200,
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": cached.headers.get("cache-control") ?? "public, max-age=60, s-maxage=300",
                        "x-instagram-feed-source": "edge-cache",
                    },
                });
            }
        }

        let page = await getCachedInstagramFeed({
            handle,
            cursor,
            count,
            includeStories,
        });

        const isFirstPage = !cursor;
        const stale = isFirstPage ? await isInstagramProfileStale(handle, INSTAGRAM_SYNC_TTL_MS) : false;
        const shouldSync = forceRefresh || !page || (isFirstPage && stale && !page?.items?.length);

        if (shouldSync) {
            await syncInstagramHandle(handle, {
                includeStories,
                maxFeedItems: 72,
                source: forceRefresh ? "api_refresh" : "api_cache_miss",
            });

            page = await getCachedInstagramFeed({
                handle,
                cursor,
                count,
                includeStories,
            });
        }

        if (!page) {
            const liveFallback = await fetchLiveInstagramFeedPage({
                handle,
                cursor,
                count,
                includeStories,
            });
            if (!liveFallback) {
                return NextResponse.json({ ok: false, error: "feed_unavailable" }, { status: 502 });
            }
            return NextResponse.json(liveFallback, {
                status: 200,
                headers: {
                    "cache-control": "public, max-age=30, s-maxage=30",
                    "x-instagram-feed-source": "live-fallback",
                },
            });
        }

        const payload = JSON.stringify(page);
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
                "x-instagram-feed-source": shouldSync ? "db-sync" : "db-cache",
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "instagram_feed_error" }, { status: 500 });
    }
}
