import { NextResponse } from "next/server";
import { units } from "@/data/units";

export const dynamic = "force-dynamic";

type CfCacheStorage = {
    default?: Cache;
};

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

type PlaceReview = {
    author_name?: string;
    profile_photo_url?: string;
    rating?: number;
    relative_time_description?: string;
    time?: number;
    text?: string;
};

type PlaceDetailsResponse = {
    status?: string;
    result?: {
        place_id?: string;
        reviews?: PlaceReview[];
    };
    error_message?: string;
};

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

function buildDetailsUrl(apiKey: string, placeId: string): string {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "place_id,reviews");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("region", "BR");
    url.searchParams.set("key", apiKey);
    return url.toString();
}

export async function GET(req: Request) {
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
    const { searchParams } = new URL(req.url);

    const locationParam = (searchParams.get("location") ?? "").trim();
    const pageSize = clamp(parsePositiveInt(searchParams.get("pageSize"), 5), 1, 50);

    if (!locationParam) {
        return NextResponse.json({ available: false, error: "missing_location" }, { status: 400 });
    }

    if (!apiKey) {
        return NextResponse.json(
            { available: false, error: "missing_gbp_places_api_key" },
            { status: 503, headers: { "cache-control": "no-store", "x-gbp": "places_missing_key" } },
        );
    }

    const placeId = resolvePlaceIdFromLocation(locationParam);
    if (!placeId) {
        return NextResponse.json(
            { available: false, error: "missing_gbp_place_id" },
            { status: 404, headers: { "cache-control": "no-store", "x-gbp": "places_no_place" } },
        );
    }

    const cache = getCloudflareCache();
    const cacheBucket = Math.floor(Date.now() / (1000 * 60 * 10)); // 10 minutes
    const cacheKey = new Request(
        `https://espacofacial.com/__cache/gbp/reviews?v=2&src=places&b=${cacheBucket}&placeId=${encodeURIComponent(placeId)}&pageSize=${pageSize}`,
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

    try {
        const res = await fetch(buildDetailsUrl(apiKey, placeId), { next: { revalidate: 60 * 60 } });
        const json = (await res.json()) as PlaceDetailsResponse;

        if (!res.ok || (json.status && json.status !== "OK") || !json.result) {
            const payload = {
                available: false,
                error: "places_details_failed",
                status: json.status ?? null,
                httpStatus: res.status,
            };
            return NextResponse.json(payload, {
                status: 502,
                headers: { "cache-control": "no-store", "x-gbp": "places_upstream" },
            });
        }

        const rawReviews = (json.result.reviews ?? []).slice(0, pageSize);
        const reviews = rawReviews.map((r, idx) => ({
            reviewId: `${placeId}_${r.time ?? idx}`,
            authorName: r.author_name ?? "",
            profilePhotoUrl: r.profile_photo_url ?? null,
            rating: typeof r.rating === "number" ? r.rating : null,
            text: r.text ?? "",
            relativeTimeDescription: r.relative_time_description ?? "",
            time: typeof r.time === "number" ? r.time : null,
        }));

        const payload = {
            available: true,
            reviews,
            nextPageToken: null,
        };

        if (cache) void cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));

        return NextResponse.json(payload, {
            status: 200,
            headers: { "cache-control": "public, max-age=60, s-maxage=600", "x-gbp": "ok" },
        });
    } catch {
        return NextResponse.json({ available: false, error: "exception" }, { status: 500, headers: { "cache-control": "no-store" } });
    }
}
