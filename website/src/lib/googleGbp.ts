type TokenCache = {
    accessToken: string;
    expiresAtMs: number;
};

type GoogleBusinessReview = {
    reviewId: string;
    reviewer?: {
        displayName?: string | null;
    } | null;
    starRating?: string | null;
    comment?: string | null;
    createTime?: string | null;
    updateTime?: string | null;
    reviewReply?: {
        comment?: string | null;
        updateTime?: string | null;
    } | null;
};

type GoogleBusinessReviewsPage = {
    reviews?: GoogleBusinessReview[];
    nextPageToken?: string | null;
    averageRating?: number | null;
    totalReviewCount?: number | null;
};

type GoogleBusinessReviewReply = {
    comment?: string | null;
    updateTime?: string | null;
    reviewReplyState?: string | null;
};

export type GbpFetchedReview = {
    reviewId: string;
    reviewerName: string;
    starRating: number | null;
    comment: string | null;
    createTimeMs: number | null;
    updateTimeMs: number | null;
    reviewReplyComment: string | null;
    reviewReplyUpdateMs: number | null;
    payloadJson: string | null;
};

export type GbpFetchedLocationReviews = {
    locationResourceName: string;
    averageRating: number | null;
    totalReviewCount: number;
    reviews: GbpFetchedReview[];
};

export type GbpPublishedReviewReply = {
    comment: string;
    updateTimeMs: number | null;
    state: string | null;
};

let tokenCache: TokenCache | null = null;

function requireEnv(name: string): string {
    const value = (process.env[name] ?? "").trim();
    if (!value) throw new Error(`missing_env:${name}`);
    return value;
}

export async function getGoogleGbpAccessToken(): Promise<string> {
    const clientId = requireEnv("GOOGLE_GBP_CLIENT_ID");
    const clientSecret = requireEnv("GOOGLE_GBP_CLIENT_SECRET");
    const refreshToken = requireEnv("GOOGLE_GBP_REFRESH_TOKEN");

    const now = Date.now();
    if (tokenCache && tokenCache.expiresAtMs - 30_000 > now) {
        return tokenCache.accessToken;
    }

    const body = new URLSearchParams();
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("refresh_token", refreshToken);
    body.set("grant_type", "refresh_token");

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
    });

    if (!response.ok) throw new Error(`oauth_refresh_failed:${response.status}`);

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    const accessToken = (json.access_token ?? "").trim();
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 300;

    if (!accessToken) throw new Error("missing_access_token");

    tokenCache = {
        accessToken,
        expiresAtMs: now + expiresIn * 1000,
    };

    return accessToken;
}

function parseLocationId(input: string): string {
    const raw = (input ?? "").trim();
    if (!raw) throw new Error("missing_location_id");
    if (raw.startsWith("accounts/")) throw new Error("location_resource_name_not_supported_here");
    if (raw.startsWith("locations/")) return raw.slice("locations/".length).trim();
    return raw;
}

async function listAccountIds(accessToken: string): Promise<string[]> {
    const res = await fetch("https://mybusiness.googleapis.com/v4/accounts", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`accounts_fetch_failed:${res.status}`);

    const json = (await res.json()) as { accounts?: Array<{ name?: string }> };
    return Array.from(
        new Set(
            (json.accounts ?? [])
                .map((account) => (account?.name ?? "").trim())
                .filter((name) => name.startsWith("accounts/"))
                .map((name) => name.slice("accounts/".length))
                .map((id) => id.trim())
                .filter(Boolean),
        ),
    ).slice(0, 20);
}

export async function discoverGoogleGbpLocationResourceName(accessToken: string, rawLocationId: string): Promise<string> {
    const locationId = parseLocationId(rawLocationId);
    const accountIds = await listAccountIds(accessToken);

    for (const accountId of accountIds) {
        const candidate = `accounts/${accountId}/locations/${locationId}`;
        const probe = await fetch(`https://mybusiness.googleapis.com/v4/${candidate}`, {
            headers: { authorization: `Bearer ${accessToken}` },
            cache: "no-store",
        });
        if (probe.ok) return candidate;
    }

    throw new Error(`location_not_found:${locationId}`);
}

export function parseGoogleStarRating(value: string | null | undefined): number | null {
    const normalized = (value ?? "").trim().toUpperCase();
    if (!normalized) return null;
    const map: Record<string, number> = {
        ONE: 1,
        TWO: 2,
        THREE: 3,
        FOUR: 4,
        FIVE: 5,
    };
    return map[normalized] ?? null;
}

export function parseGoogleTimestampMs(value: string | null | undefined): number | null {
    const raw = (value ?? "").trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
}

function toNullableText(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    return trimmed || null;
}

export function formatReviewRelativeTimePtBr(timeMs: number | null | undefined, nowMs = Date.now()): string {
    if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) return "";
    const deltaMs = timeMs - nowMs;
    const absMs = Math.abs(deltaMs);

    const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
        { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
        { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
        { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
        { unit: "day", ms: 24 * 60 * 60 * 1000 },
        { unit: "hour", ms: 60 * 60 * 1000 },
        { unit: "minute", ms: 60 * 1000 },
    ];

    const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    for (const entry of units) {
        if (absMs >= entry.ms || entry.unit === "minute") {
            const value = Math.round(deltaMs / entry.ms);
            return formatter.format(value, entry.unit);
        }
    }

    return "";
}

export async function fetchAllGoogleGbpReviews(rawLocationId: string): Promise<GbpFetchedLocationReviews> {
    const accessToken = await getGoogleGbpAccessToken();
    const locationResourceName = await discoverGoogleGbpLocationResourceName(accessToken, rawLocationId);

    const reviews: GbpFetchedReview[] = [];
    let nextPageToken: string | null = null;
    let averageRating: number | null = null;
    let totalReviewCount = 0;

    do {
        const url = new URL(`https://mybusiness.googleapis.com/v4/${locationResourceName}/reviews`);
        url.searchParams.set("pageSize", "50");
        if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

        const response = await fetch(url, {
            headers: { authorization: `Bearer ${accessToken}` },
            cache: "no-store",
        });

        if (!response.ok) throw new Error(`reviews_fetch_failed:${response.status}`);

        const page = (await response.json()) as GoogleBusinessReviewsPage;
        if (typeof page.averageRating === "number") averageRating = page.averageRating;
        if (typeof page.totalReviewCount === "number") totalReviewCount = page.totalReviewCount;

        for (const review of page.reviews ?? []) {
            const fallbackReviewId = [
                toNullableText(review.reviewer?.displayName) ?? "paciente",
                parseGoogleTimestampMs(review.updateTime) ?? parseGoogleTimestampMs(review.createTime) ?? reviews.length,
            ].join("_");
            reviews.push({
                reviewId: (review.reviewId ?? "").trim() || fallbackReviewId,
                reviewerName: (review.reviewer?.displayName ?? "Paciente").trim() || "Paciente",
                starRating: parseGoogleStarRating(review.starRating),
                comment: toNullableText(review.comment),
                createTimeMs: parseGoogleTimestampMs(review.createTime),
                updateTimeMs: parseGoogleTimestampMs(review.updateTime),
                reviewReplyComment: toNullableText(review.reviewReply?.comment),
                reviewReplyUpdateMs: parseGoogleTimestampMs(review.reviewReply?.updateTime),
                payloadJson: JSON.stringify(review),
            });
        }

        nextPageToken = (page.nextPageToken ?? "").trim() || null;
    } while (nextPageToken);

    if (!totalReviewCount) totalReviewCount = reviews.length;
    if (averageRating === null && reviews.length) {
        const validRatings = reviews.map((review) => review.starRating).filter((rating): rating is number => typeof rating === "number");
        averageRating = validRatings.length
            ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length
            : null;
    }

    return {
        locationResourceName,
        averageRating,
        totalReviewCount,
        reviews,
    };
}

export async function publishGoogleGbpReviewReply(params: {
    locationResourceName: string;
    reviewId: string;
    comment: string;
}): Promise<GbpPublishedReviewReply> {
    const locationResourceName = (params.locationResourceName ?? "").trim();
    const reviewId = (params.reviewId ?? "").trim();
    const comment = (params.comment ?? "").trim();
    if (!/^accounts\/\d+\/locations\/\d+$/.test(locationResourceName)) throw new Error("invalid_location_resource_name");
    if (!reviewId || reviewId.length > 512 || reviewId.includes("/") || /[\u0000-\u001F\u007F]/.test(reviewId)) {
        throw new Error("invalid_review_id");
    }
    if (!comment || new TextEncoder().encode(comment).byteLength > 4096) throw new Error("invalid_reply_comment");

    const accessToken = await getGoogleGbpAccessToken();
    const response = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationResourceName}/reviews/${encodeURIComponent(reviewId)}/reply`,
        {
            method: "PUT",
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({ comment }),
            cache: "no-store",
        },
    );
    if (!response.ok) throw new Error(`review_reply_publish_failed:${response.status}`);

    const reply = (await response.json()) as GoogleBusinessReviewReply;
    return {
        comment: toNullableText(reply.comment) ?? comment,
        updateTimeMs: parseGoogleTimestampMs(reply.updateTime),
        state: toNullableText(reply.reviewReplyState),
    };
}
