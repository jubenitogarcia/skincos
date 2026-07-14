import { NextResponse } from "next/server";
import { units } from "@/data/units";
import { getPersistedGbpPlacePayload } from "@/lib/gbpReviewsDb";
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

function resolveUnitForFallback(placeId: string, query: string) {
    const byPlaceId = (placeId ?? "").trim()
        ? units.find((unit) => (unit.placeId ?? "").trim() === (placeId ?? "").trim()) ?? null
        : null;
    if (byPlaceId) return byPlaceId;

    const normalizedQuery = (query ?? "").trim().toLowerCase();
    if (!normalizedQuery) return null;
    return (
        units.find((unit) => {
            const haystack = [unit.name, unit.addressLine, unit.state].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(normalizedQuery);
        }) ?? null
    );
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const placeIdParam = (searchParams.get("placeId") ?? "").trim();
    const queryParam = (searchParams.get("query") ?? "").trim();

    if (!placeIdParam && !queryParam) {
        return NextResponse.json({ available: false, error: "missing_placeId_or_query" }, { status: 400 });
    }

    const persisted = placeIdParam ? await getPersistedGbpPlacePayload(placeIdParam) : null;
    const snapshotPayload = await loadPlaceSnapshot(req, { placeId: placeIdParam, query: queryParam });

    if (persisted) {
        const fallbackUnit = resolveUnitForFallback(placeIdParam, queryParam);
        const mergedPayload = {
            available: true,
            ...(snapshotPayload ?? {}),
            name: snapshotPayload?.name ?? fallbackUnit?.name ?? null,
            address: snapshotPayload?.address ?? fallbackUnit?.addressLine ?? null,
            mapsUrl: snapshotPayload?.mapsUrl ?? fallbackUnit?.maps ?? null,
            location: snapshotPayload?.location ?? {
                lat: fallbackUnit?.lat ?? null,
                lng: fallbackUnit?.lng ?? null,
            },
            placeId: snapshotPayload?.placeId ?? placeIdParam ?? null,
            rating: persisted.rating,
            userRatingsTotal: persisted.userRatingsTotal,
            reviews: persisted.reviews,
        };

        return jsonOk(mergedPayload, {
            "cache-control": "public, max-age=60, s-maxage=300",
            "x-places": "db",
        });
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
