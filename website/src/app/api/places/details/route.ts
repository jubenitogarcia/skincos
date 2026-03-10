import { NextResponse } from "next/server";

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
    rating?: number;
    relative_time_description?: string;
    time?: number;
    text?: string;
};

type PlacePhoto = {
    photo_reference?: string;
    height?: number;
    width?: number;
};

type FindPlaceResponse = {
    status?: string;
    candidates?: Array<{ place_id?: string; name?: string; formatted_address?: string }>;
    error_message?: string;
};

type FindPlaceCandidate = NonNullable<FindPlaceResponse["candidates"]>[number];

type PlaceDetailsResponse = {
    status?: string;
    result?: {
        place_id?: string;
        name?: string;
        formatted_address?: string;
        rating?: number;
        user_ratings_total?: number;
        url?: string;
        website?: string;
        reviews?: PlaceReview[];
        photos?: PlacePhoto[];
        geometry?: { location?: { lat?: number; lng?: number } };
    };
    error_message?: string;
};

function buildFindPlaceUrl(apiKey: string, query: string): string {
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("input", query);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "place_id,name,formatted_address");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("region", "BR");
    url.searchParams.set("key", apiKey);
    return url.toString();
}

function buildDetailsUrl(apiKey: string, placeId: string): string {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set(
        "fields",
        [
            "place_id",
            "name",
            "formatted_address",
            "rating",
            "user_ratings_total",
            "url",
            "website",
            "reviews",
            "photos",
            "geometry",
        ].join(","),
    );
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("region", "BR");
    url.searchParams.set("reviews_no_translations", "true");
    url.searchParams.set("key", apiKey);
    return url.toString();
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
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();

    const { searchParams } = new URL(req.url);
    const placeIdParam = (searchParams.get("placeId") ?? "").trim();
    const queryParam = (searchParams.get("query") ?? "").trim();

    if (!placeIdParam && !queryParam) {
        return NextResponse.json({ available: false, error: "missing_placeId_or_query" }, { status: 400 });
    }

    if (!apiKey) {
        return jsonOk({ available: false, error: "missing_api_key" }, { "x-places": "missing_key" });
    }

    const cache = getCloudflareCache();
    // Cloudflare Cache API entries can live for a long time; version + time-bucket the key to avoid serving stale payloads
    // when we change limits/shape (e.g., increasing photos/reviews returned).
    const cacheBucket = Math.floor(Date.now() / (1000 * 60 * 60)); // hourly bucket
    const cacheKey = new Request(
        `https://espacofacial.com/__cache/places/details?v=2&b=${cacheBucket}&placeId=${encodeURIComponent(placeIdParam)}&query=${encodeURIComponent(queryParam)}`,
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

    try {
        let resolvedPlaceId = placeIdParam;
        let findCandidate: FindPlaceCandidate | null = null;

        if (!resolvedPlaceId) {
            const findUrl = buildFindPlaceUrl(apiKey, queryParam);
            const findRes = await fetch(findUrl, { next: { revalidate: 60 * 60 } });
            const findJson = (await findRes.json()) as FindPlaceResponse;

            const first = findJson.candidates?.[0];
            resolvedPlaceId = (first?.place_id ?? "").trim();
            findCandidate = first ?? null;

            if (!resolvedPlaceId) {
                const payload = {
                    available: false,
                    error: "place_not_found",
                    query: queryParam,
                    status: findJson.status ?? null,
                };

                if (cache) void cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));

                return jsonOk(payload, { "x-places": "not_found" });
            }
        }

        const detailsUrl = buildDetailsUrl(apiKey, resolvedPlaceId);
        const detailsRes = await fetch(detailsUrl, { next: { revalidate: 60 * 60 } });
        const detailsJson = (await detailsRes.json()) as PlaceDetailsResponse;

        const result = detailsJson.result;
        if (!result || (detailsJson.status && detailsJson.status !== "OK")) {
            const payload = {
                available: false,
                error: "details_failed",
                placeId: resolvedPlaceId,
                status: detailsJson.status ?? null,
            };

            if (cache) void cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));

            return jsonOk(payload, { "x-places": "details_failed" });
        }

        const photos = (result.photos ?? [])
            .filter((p) => typeof p?.photo_reference === "string" && p.photo_reference)
            .slice(0, 30)
            .map((p) => ({
                photoReference: p.photo_reference as string,
                width: typeof p.width === "number" ? p.width : null,
                height: typeof p.height === "number" ? p.height : null,
            }));

        const reviews = (result.reviews ?? [])
            .filter((r) => typeof r?.text === "string" || typeof r?.author_name === "string")
            .slice(0, 20)
            .map((r) => ({
                authorName: r.author_name ?? "",
                rating: typeof r.rating === "number" ? r.rating : null,
                relativeTimeDescription: r.relative_time_description ?? "",
                time: typeof r.time === "number" ? r.time : null,
                text: r.text ?? "",
            }));

        const mapsUrl = typeof result.url === "string" && result.url ? result.url : null;

        const payload = {
            available: true,
            placeId: result.place_id ?? resolvedPlaceId,
            name: result.name ?? findCandidate?.name ?? null,
            address: result.formatted_address ?? findCandidate?.formatted_address ?? null,
            rating: typeof result.rating === "number" ? result.rating : null,
            userRatingsTotal: typeof result.user_ratings_total === "number" ? result.user_ratings_total : null,
            mapsUrl,
            website: typeof result.website === "string" ? result.website : null,
            photos,
            reviews,
            location: {
                lat: result.geometry?.location?.lat ?? null,
                lng: result.geometry?.location?.lng ?? null,
            },
        };

        if (cache) void cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));

        return jsonOk(payload, { "x-places": "ok" });
    } catch {
        return jsonOk({ available: false, error: "exception" }, { "x-places": "exception" });
    }
}
