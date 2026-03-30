import { NextResponse } from "next/server";
import { loadPlaceSnapshot } from "@/lib/productionSnapshot";

export const dynamic = "force-dynamic";

type CfCacheStorage = {
    default?: Cache;
};

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function jsonOk(body: unknown, headers?: HeadersInit) {
    return NextResponse.json(body, {
        status: 200,
        headers: {
            "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
            ...(headers ?? {}),
        },
    });
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const placeIdParam = (searchParams.get("placeId") ?? "").trim();
    const queryParam = (searchParams.get("query") ?? "").trim();

    if (!placeIdParam && !queryParam) {
        return NextResponse.json({ available: false, error: "missing_placeId_or_query" }, { status: 400 });
    }

    const cache = getCloudflareCache();
    const cacheKey = new Request(
        `https://espacofacial.com/__cache/places/details?v=5&src=snapshot&placeId=${encodeURIComponent(placeIdParam)}&query=${encodeURIComponent(queryParam)}`,
    );

    if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) {
            const payload = await hit.json().catch(() => null);
            if (payload) {
                return jsonOk(payload, { "x-places": "cache" });
            }
        }
    }

    const snapshotPayload = await loadPlaceSnapshot(req, { placeId: placeIdParam, query: queryParam });
    if (snapshotPayload) {
        if (cache) void cache.put(cacheKey, new Response(JSON.stringify(snapshotPayload), { headers: { "content-type": "application/json" } }));
        return jsonOk(snapshotPayload, { "x-places": "snapshot_only" });
    }

    const payload = {
        available: false,
        error: "snapshot_not_found",
        placeId: placeIdParam || null,
        query: queryParam || null,
    };

    return jsonOk(payload, { "x-places": "snapshot_missing" });
}
