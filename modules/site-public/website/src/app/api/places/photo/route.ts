import { NextResponse } from "next/server";
import { loadPlacePhotoSnapshot } from "@/lib/productionSnapshot";

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

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);

    const ref = (searchParams.get("ref") ?? "").trim();
    const maxWidth = clamp(parsePositiveInt(searchParams.get("maxwidth"), 900), 200, 1600);

    if (!ref) {
        return new NextResponse("missing_ref", { status: 400 });
    }

    const cache = getCloudflareCache();
    const cacheKey = new Request(`https://espacofacial.com/__cache/places/photo?v=2&src=snapshot&ref=${encodeURIComponent(ref)}&w=${maxWidth}`);

    if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) {
            const contentType = hit.headers.get("content-type") ?? "image/jpeg";
            const cacheControl = hit.headers.get("cache-control") ?? "public, max-age=604800";

            return new NextResponse(hit.body, {
                status: 200,
                headers: {
                    "content-type": contentType,
                    "cache-control": cacheControl,
                    "x-places-photo": "cache",
                },
            });
        }
    }

    const snapshotPhoto = await loadPlacePhotoSnapshot(req, ref);
    if (snapshotPhoto) {
        const resp = new NextResponse(snapshotPhoto.response.body, {
            status: 200,
            headers: {
                "content-type": snapshotPhoto.contentType,
                "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=604800",
                "x-places-photo": "snapshot_only",
            },
        });

        if (cache) void cache.put(cacheKey, resp.clone());

        return resp;
    }
    return new NextResponse("snapshot_photo_not_found", { status: 404 });
}
