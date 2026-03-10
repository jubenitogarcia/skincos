import { NextResponse } from "next/server";

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
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
    const { searchParams } = new URL(req.url);

    const ref = (searchParams.get("ref") ?? "").trim();
    const maxWidth = clamp(parsePositiveInt(searchParams.get("maxwidth"), 900), 200, 1600);

    if (!ref) {
        return new NextResponse("missing_ref", { status: 400 });
    }

    if (!apiKey) {
        return new NextResponse("missing_api_key", { status: 503 });
    }

    const cache = getCloudflareCache();
    const cacheKey = new Request(`https://espacofacial.com/__cache/places/photo?ref=${encodeURIComponent(ref)}&w=${maxWidth}`);

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

    const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
    url.searchParams.set("photoreference", ref);
    url.searchParams.set("maxwidth", String(maxWidth));
    url.searchParams.set("key", apiKey);

    try {
        const res = await fetch(url.toString(), {
            redirect: "follow",
            next: { revalidate: 60 * 60 * 12 },
        });

        if (!res.ok) {
            return new NextResponse("photo_fetch_failed", { status: 502 });
        }

        const contentType = res.headers.get("content-type") ?? "image/jpeg";
        if (!contentType.toLowerCase().startsWith("image/")) {
            return new NextResponse("unexpected_content_type", { status: 502 });
        }

        const resp = new NextResponse(res.body, {
            status: 200,
            headers: {
                "content-type": contentType,
                "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=604800",
                "x-places-photo": "ok",
            },
        });

        if (cache) void cache.put(cacheKey, resp.clone());

        return resp;
    } catch {
        return new NextResponse("exception", { status: 500 });
    }
}
