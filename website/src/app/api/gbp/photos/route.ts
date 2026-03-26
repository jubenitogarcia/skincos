import { NextResponse } from "next/server";
import { units } from "@/data/units";
import { loadPlaceSnapshot, paginatePlaceSnapshotPhotos } from "@/lib/productionSnapshot";

export const dynamic = "force-dynamic";

type CfCacheStorage = {
    default?: Cache;
};

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function parsePositiveInt(value: string | null, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.floor(n));
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function isPlaceId(value: string): boolean {
    const v = (value ?? "").trim();
    if (!v) return false;
    return v.startsWith("ChI") && v.length >= 15;
}

function resolvePlaceIdFromLocation(locationParam: string): string | null {
    const raw = (locationParam ?? "").trim();
    if (!raw) return null;
    if (isPlaceId(raw)) return raw;

    const unit = units.find((u) => (u.gbpLocation ?? "").trim() === raw);
    const placeId = (unit?.placeId ?? "").trim();
    return placeId || null;
}

function parseOffsetToken(token: string | null): number {
    const t = (token ?? "").trim();
    if (!t) return 0;
    const n = Number(t);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);

    const locationParam = (searchParams.get("location") ?? "").trim();
    const pageToken = (searchParams.get("pageToken") ?? "").trim();
    const pageSize = clamp(parsePositiveInt(searchParams.get("pageSize"), 12), 1, 50);

    if (!locationParam) {
        return NextResponse.json({ available: false, error: "missing_location" }, { status: 400 });
    }

    const placeId = resolvePlaceIdFromLocation(locationParam);
    if (!placeId) {
        return NextResponse.json(
            { available: false, error: "missing_gbp_place_id" },
            { status: 404, headers: { "cache-control": "no-store", "x-gbp": "places_no_place" } },
        );
    }

    const cache = getCloudflareCache();
    const cacheKey = new Request(
        `https://espacofacial.com/__cache/gbp/photos?v=3&src=snapshot&placeId=${encodeURIComponent(placeId)}&pageToken=${encodeURIComponent(
            pageToken,
        )}&pageSize=${pageSize}`,
    );

    if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) {
            const payload = await hit.json().catch(() => null);
            if (payload) {
                return NextResponse.json(payload, {
                    status: 200,
                    headers: { "cache-control": "public, max-age=60, s-maxage=600", "x-gbp": "cache" },
                });
            }
        }
    }

    const snapshot = await loadPlaceSnapshot(req, { placeId });
    if (snapshot) {
        const payload = paginatePlaceSnapshotPhotos(snapshot, {
            offset: parseOffsetToken(pageToken),
            pageSize,
            maxWidth: 900,
        });
        if (cache) void cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
        return NextResponse.json(payload, {
            status: 200,
            headers: { "cache-control": "public, max-age=60, s-maxage=600", "x-gbp": "snapshot_only" },
        });
    }

    return NextResponse.json(
        { available: false, error: "snapshot_not_found" },
        { status: 404, headers: { "cache-control": "no-store", "x-gbp": "snapshot_missing" } },
    );
}
