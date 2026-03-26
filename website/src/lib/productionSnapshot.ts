import { getCloudflareContext } from "@opennextjs/cloudflare";

const SNAPSHOT_BASE_PATH = "/production-snapshot";

type AssetFetcher = {
    fetch: (input: Request | string | URL) => Promise<Response>;
};

function trimLeadingSlash(value: string): string {
    return value.replace(/^\/+/, "");
}

export function normalizeSnapshotKey(value: string): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
}

export function buildSnapshotUrl(request: Request, relativePath: string): URL {
    const path = trimLeadingSlash(relativePath);
    return new URL(`${SNAPSHOT_BASE_PATH}/${path}`, request.url);
}

async function fetchSnapshot(request: Request, relativePath: string): Promise<Response | null> {
    const assetUrl = buildSnapshotUrl(request, relativePath);

    try {
        const { env } = getCloudflareContext();
        const assets = (env as { ASSETS?: AssetFetcher }).ASSETS;
        if (assets) {
            const response = await assets.fetch(new Request(assetUrl.toString()));
            if (response.ok) return response;
        }
    } catch {
        // Ignore and fall back to network fetch.
    }

    try {
        const response = await fetch(assetUrl, { cache: "no-store" });
        if (!response.ok) return null;
        return response;
    } catch {
        return null;
    }
}

export async function readSnapshotJson<T>(request: Request, relativePath: string): Promise<T | null> {
    const response = await fetchSnapshot(request, relativePath);
    if (!response) return null;

    try {
        return (await response.json()) as T;
    } catch {
        return null;
    }
}

export async function readSnapshotBinary(request: Request, relativePath: string): Promise<Response | null> {
    return fetchSnapshot(request, relativePath);
}

type PlaceSnapshotIndex = {
    byPlaceId?: Record<string, string>;
    byQuery?: Record<string, string>;
};

type PlaceDetailsSnapshotPayload = {
    available?: boolean;
    name?: string | null;
    address?: string | null;
    rating?: number | null;
    userRatingsTotal?: number | null;
    mapsUrl?: string | null;
    website?: string | null;
    location?: {
        lat?: number | null;
        lng?: number | null;
    } | null;
    placeId?: string | null;
    photos?: Array<{ photoReference: string; width: number | null; height: number | null }>;
    reviews?: Array<{ authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>;
};

export async function loadPlaceSnapshot(
    request: Request,
    params: { placeId?: string | null; query?: string | null },
): Promise<PlaceDetailsSnapshotPayload | null> {
    const index = await readSnapshotJson<PlaceSnapshotIndex>(request, "places/index.json");
    if (!index) return null;

    const placeId = (params.placeId ?? "").trim();
    const query = (params.query ?? "").trim();

    let relativePath: string | null = null;
    if (placeId) relativePath = index.byPlaceId?.[placeId] ?? null;
    if (!relativePath && query) relativePath = index.byQuery?.[normalizeSnapshotKey(query)] ?? null;
    if (!relativePath) return null;

    return readSnapshotJson<PlaceDetailsSnapshotPayload>(request, relativePath);
}

export type PlaceSnapshotPayload = NonNullable<Awaited<ReturnType<typeof loadPlaceSnapshot>>>;

export function paginatePlaceSnapshotPhotos(
    snapshot: PlaceSnapshotPayload,
    params: { pageSize: number; offset?: number | null; maxWidth?: number | null },
): {
    available: true;
    items: Array<{ name: string; thumbnailUrl: string; googleUrl: null }>;
    nextPageToken: string | null;
} {
    const allRefs = (snapshot.photos ?? [])
        .map((photo) => (photo.photoReference ?? "").trim())
        .filter(Boolean);

    const offset = Math.max(0, Math.floor(params.offset ?? 0));
    const pageSize = Math.max(1, Math.floor(params.pageSize));
    const maxWidth = Math.max(200, Math.floor(params.maxWidth ?? 900));
    const slice = allRefs.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    const nextPageToken = nextOffset < allRefs.length ? String(nextOffset) : null;

    return {
        available: true,
        items: slice.map((ref, index) => ({
            name: `photo_${offset + index + 1}`,
            thumbnailUrl: `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=${maxWidth}`,
            googleUrl: null,
        })),
        nextPageToken,
    };
}

export function paginatePlaceSnapshotReviews(
    snapshot: PlaceSnapshotPayload,
    params: { placeId: string; pageSize: number },
): {
    available: true;
    reviews: Array<{
        reviewId: string;
        authorName: string;
        profilePhotoUrl: null;
        rating: number | null;
        text: string;
        relativeTimeDescription: string;
        time: number | null;
    }>;
    nextPageToken: null;
} {
    const placeId = String(params.placeId ?? "").trim();
    const pageSize = Math.max(1, Math.floor(params.pageSize));
    const reviews = (snapshot.reviews ?? []).slice(0, pageSize).map((review, index) => ({
        reviewId: `${placeId}_${review.time ?? index}`,
        authorName: review.authorName ?? "",
        profilePhotoUrl: null,
        rating: typeof review.rating === "number" ? review.rating : null,
        text: review.text ?? "",
        relativeTimeDescription: review.relativeTimeDescription ?? "",
        time: typeof review.time === "number" ? review.time : null,
    }));

    return {
        available: true,
        reviews,
        nextPageToken: null,
    };
}

type PlacePhotoManifest = Record<string, { path: string; contentType?: string | null }>;

export async function loadPlacePhotoSnapshot(
    request: Request,
    photoReference: string,
): Promise<{ response: Response; contentType: string } | null> {
    const manifest = await readSnapshotJson<PlacePhotoManifest>(request, "place-photos/manifest.json");
    const entry = manifest?.[photoReference];
    if (!entry?.path) return null;

    const response = await readSnapshotBinary(request, entry.path);
    if (!response) return null;

    return {
        response,
        contentType: entry.contentType?.trim() || response.headers.get("content-type") || "image/jpeg",
    };
}
