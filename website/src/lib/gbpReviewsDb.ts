import { getCloudflareContext } from "@opennextjs/cloudflare";
import { units } from "@/data/units";
import { formatReviewRelativeTimePtBr, type GbpFetchedReview } from "@/lib/googleGbp";

type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    first: <T = unknown>() => Promise<T | null>;
    run: () => Promise<{ success: boolean; error?: string } | unknown>;
};

type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
};

type CloudflareEnv = {
    BOOKING_DB?: D1DatabaseLike;
};

type GbpReviewSummaryRow = {
    unit_slug: string;
    place_id: string;
    gbp_location: string | null;
    location_resource_name: string | null;
    average_rating: number | null;
    total_reviews: number;
    reviews_synced: number;
    synced_at_ms: number;
    created_at_ms: number;
    updated_at_ms: number;
};

type GbpReviewRow = {
    id: string;
    unit_slug: string;
    place_id: string;
    reviewer_name: string;
    star_rating: number | null;
    comment: string | null;
    create_time_ms: number | null;
    update_time_ms: number | null;
    review_reply_comment: string | null;
    review_reply_update_ms: number | null;
    payload_json: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

type GbpReviewPayload = {
    reviewId: string;
    authorName: string;
    profilePhotoUrl: null;
    rating: number | null;
    text: string;
    relativeTimeDescription: string;
    time: number | null;
};

export type PersistedGbpUnitReviews = {
    summary: {
        unitSlug: string;
        placeId: string;
        averageRating: number | null;
        totalReviews: number;
        reviewsSynced: number;
        syncedAtMs: number;
    };
    reviews: GbpReviewPayload[];
    nextPageToken: string | null;
};

export type TrustEvidenceDbSummary = {
    totalReviews: number;
    weightedRating: number;
    capturedAtMs: number | null;
};

let ensured = false;

function getDbOrNull(): D1DatabaseLike | null {
    try {
        const { env } = getCloudflareContext();
        const typedEnv = env as unknown as CloudflareEnv;
        return typedEnv.BOOKING_DB ?? null;
    } catch {
        return null;
    }
}

async function ensureSchema(db: D1DatabaseLike): Promise<void> {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS gbp_review_summaries (
                unit_slug TEXT PRIMARY KEY,
                place_id TEXT NOT NULL,
                gbp_location TEXT,
                location_resource_name TEXT,
                average_rating REAL,
                total_reviews INTEGER NOT NULL DEFAULT 0,
                reviews_synced INTEGER NOT NULL DEFAULT 0,
                synced_at_ms INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_gbp_review_summaries_place_id ON gbp_review_summaries(place_id);")
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS gbp_reviews (
                id TEXT PRIMARY KEY,
                unit_slug TEXT NOT NULL,
                place_id TEXT NOT NULL,
                reviewer_name TEXT NOT NULL,
                star_rating INTEGER,
                comment TEXT,
                create_time_ms INTEGER,
                update_time_ms INTEGER,
                review_reply_comment TEXT,
                review_reply_update_ms INTEGER,
                payload_json TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_gbp_reviews_unit_updated ON gbp_reviews(unit_slug, update_time_ms DESC, created_at_ms DESC);")
        .run();

    await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_gbp_reviews_place_updated ON gbp_reviews(place_id, update_time_ms DESC, created_at_ms DESC);")
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS gbp_review_sync_runs (
                id TEXT PRIMARY KEY,
                unit_slug TEXT NOT NULL,
                place_id TEXT NOT NULL,
                started_at_ms INTEGER NOT NULL,
                finished_at_ms INTEGER,
                success INTEGER NOT NULL DEFAULT 0,
                fetched_reviews INTEGER NOT NULL DEFAULT 0,
                error TEXT
            );`,
        )
        .run();

    await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_gbp_review_sync_runs_unit_started ON gbp_review_sync_runs(unit_slug, started_at_ms DESC);")
        .run();
}

async function getDb(): Promise<D1DatabaseLike | null> {
    const db = getDbOrNull();
    if (!db) return null;
    if (!ensured) {
        await ensureSchema(db);
        ensured = true;
    }
    return db;
}

function toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function computeWeightedRatingFromRows(rows: Array<{ averageRating: number | null; totalReviews: number }>): number {
    const totalReviews = rows.reduce((sum, row) => sum + Math.max(0, row.totalReviews), 0);
    if (!totalReviews) return 0;
    const weightedBase = rows.reduce((sum, row) => sum + (row.averageRating ?? 0) * Math.max(0, row.totalReviews), 0);
    return weightedBase / totalReviews;
}

function mapReviewRow(row: GbpReviewRow): GbpReviewPayload {
    const time = row.update_time_ms ?? row.create_time_ms ?? null;
    return {
        reviewId: row.id,
        authorName: row.reviewer_name,
        profilePhotoUrl: null,
        rating: typeof row.star_rating === "number" ? row.star_rating : null,
        text: row.comment ?? "",
        relativeTimeDescription: formatReviewRelativeTimePtBr(time),
        time,
    };
}

function resolveUnitByPlaceId(placeId: string): string | null {
    const normalized = (placeId ?? "").trim();
    if (!normalized) return null;
    const unit = units.find((entry) => (entry.placeId ?? "").trim() === normalized);
    return unit?.slug ?? null;
}

export async function replaceUnitGbpReviews(params: {
    unitSlug: string;
    placeId: string;
    gbpLocation: string | null;
    locationResourceName: string | null;
    averageRating: number | null;
    totalReviews: number;
    reviews: GbpFetchedReview[];
    syncedAtMs: number;
}): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const now = params.syncedAtMs;
    await db
        .prepare(
            `INSERT INTO gbp_review_summaries (
                unit_slug, place_id, gbp_location, location_resource_name,
                average_rating, total_reviews, reviews_synced, synced_at_ms,
                created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(unit_slug) DO UPDATE SET
                place_id = excluded.place_id,
                gbp_location = excluded.gbp_location,
                location_resource_name = excluded.location_resource_name,
                average_rating = excluded.average_rating,
                total_reviews = excluded.total_reviews,
                reviews_synced = excluded.reviews_synced,
                synced_at_ms = excluded.synced_at_ms,
                updated_at_ms = excluded.updated_at_ms;`,
        )
        .bind(
            params.unitSlug,
            params.placeId,
            params.gbpLocation,
            params.locationResourceName,
            params.averageRating,
            params.totalReviews,
            params.reviews.length,
            params.syncedAtMs,
            now,
            now,
        )
        .run();

    await db.prepare("DELETE FROM gbp_reviews WHERE unit_slug = ?;").bind(params.unitSlug).run();

    for (const review of params.reviews) {
        const createdAtMs = review.createTimeMs ?? review.updateTimeMs ?? now;
        await db
            .prepare(
                `INSERT INTO gbp_reviews (
                    id, unit_slug, place_id, reviewer_name, star_rating, comment,
                    create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
                    payload_json, created_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            )
            .bind(
                review.reviewId,
                params.unitSlug,
                params.placeId,
                review.reviewerName,
                review.starRating,
                review.comment,
                review.createTimeMs,
                review.updateTimeMs,
                review.reviewReplyComment,
                review.reviewReplyUpdateMs,
                review.payloadJson,
                createdAtMs,
                now,
            )
            .run();
    }
}

export async function recordGbpReviewSyncRun(params: {
    id: string;
    unitSlug: string;
    placeId: string;
    startedAtMs: number;
    finishedAtMs: number;
    success: boolean;
    fetchedReviews: number;
    error?: string | null;
}): Promise<void> {
    const db = await getDb();
    if (!db) return;

    await db
        .prepare(
            `INSERT INTO gbp_review_sync_runs (
                id, unit_slug, place_id, started_at_ms, finished_at_ms, success, fetched_reviews, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .bind(
            params.id,
            params.unitSlug,
            params.placeId,
            params.startedAtMs,
            params.finishedAtMs,
            params.success ? 1 : 0,
            params.fetchedReviews,
            params.error ?? null,
        )
        .run();
}

async function readSummaryWhere(field: "unit_slug" | "place_id", value: string): Promise<GbpReviewSummaryRow | null> {
    const db = await getDb();
    if (!db) return null;

    return db
        .prepare(
            `SELECT unit_slug, place_id, gbp_location, location_resource_name, average_rating, total_reviews,
                    reviews_synced, synced_at_ms, created_at_ms, updated_at_ms
             FROM gbp_review_summaries
             WHERE ${field} = ?
             LIMIT 1;`,
        )
        .bind(value)
        .first<GbpReviewSummaryRow>();
}

async function readReviewsWhere(
    field: "unit_slug" | "place_id",
    value: string,
    limit?: number,
    offset?: number,
): Promise<GbpReviewRow[]> {
    const db = await getDb();
    if (!db) return [];

    const finalLimit = typeof limit === "number" && limit > 0 ? Math.floor(limit) : 500;
    const finalOffset = typeof offset === "number" && offset > 0 ? Math.floor(offset) : 0;
    const result = await db
        .prepare(
            `SELECT id, unit_slug, place_id, reviewer_name, star_rating, comment,
                    create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
                    payload_json, created_at_ms, updated_at_ms
             FROM gbp_reviews
             WHERE ${field} = ?
             ORDER BY COALESCE(update_time_ms, create_time_ms, created_at_ms) DESC
             LIMIT ?
             OFFSET ?;`,
        )
        .bind(value, finalLimit, finalOffset)
        .all<GbpReviewRow>();

    return result.results ?? [];
}

export async function getPersistedGbpUnitReviews(params: {
    unitSlug?: string | null;
    placeId?: string | null;
    limit?: number;
    offset?: number;
}): Promise<PersistedGbpUnitReviews | null> {
    const byUnitSlug = (params.unitSlug ?? "").trim();
    const byPlaceId = (params.placeId ?? "").trim();
    const offset = typeof params.offset === "number" && params.offset > 0 ? Math.floor(params.offset) : 0;

    const summary =
        (byUnitSlug ? await readSummaryWhere("unit_slug", byUnitSlug) : null) ??
        (byPlaceId ? await readSummaryWhere("place_id", byPlaceId) : null);
    if (!summary) return null;

    const reviews = byUnitSlug
        ? await readReviewsWhere("unit_slug", summary.unit_slug, params.limit, offset)
        : await readReviewsWhere("place_id", summary.place_id, params.limit, offset);
    const totalReviews = toNumber(summary.total_reviews);
    const nextOffset = offset + reviews.length;

    return {
        summary: {
            unitSlug: summary.unit_slug,
            placeId: summary.place_id,
            averageRating: summary.average_rating,
            totalReviews,
            reviewsSynced: toNumber(summary.reviews_synced),
            syncedAtMs: toNumber(summary.synced_at_ms),
        },
        reviews: reviews.map(mapReviewRow),
        nextPageToken: nextOffset < totalReviews ? String(nextOffset) : null,
    };
}

export async function getPersistedGbpPlacePayload(placeId: string): Promise<{
    rating: number | null;
    userRatingsTotal: number;
    reviews: Array<{ authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>;
    syncedAtMs: number;
    unitSlug: string | null;
} | null> {
    const summary = await readSummaryWhere("place_id", placeId);
    if (!summary) return null;

    return {
        rating: summary.average_rating,
        userRatingsTotal: toNumber(summary.total_reviews),
        reviews: [],
        syncedAtMs: toNumber(summary.synced_at_ms),
        unitSlug: summary.unit_slug ?? resolveUnitByPlaceId(placeId),
    };
}

export async function getPersistedGbpPlacePayloadWithReviews(placeId: string, limit?: number): Promise<{
    rating: number | null;
    userRatingsTotal: number;
    reviews: Array<{ authorName: string; rating: number | null; relativeTimeDescription: string; time: number | null; text: string }>;
    syncedAtMs: number;
    unitSlug: string | null;
} | null> {
    const persisted = await getPersistedGbpUnitReviews({ placeId, limit });
    if (!persisted) return null;

    return {
        rating: persisted.summary.averageRating,
        userRatingsTotal: persisted.summary.totalReviews,
        reviews: persisted.reviews.map((review) => ({
            authorName: review.authorName,
            rating: review.rating,
            relativeTimeDescription: review.relativeTimeDescription,
            time: review.time,
            text: review.text,
        })),
        syncedAtMs: persisted.summary.syncedAtMs,
        unitSlug: persisted.summary.unitSlug ?? resolveUnitByPlaceId(placeId),
    };
}

export async function getTrustEvidenceDbSummary(unitSlugs: string[]): Promise<TrustEvidenceDbSummary | null> {
    const cleaned = Array.from(new Set(unitSlugs.map((slug) => slug.trim()).filter(Boolean)));
    if (!cleaned.length) return null;

    const rows = await Promise.all(cleaned.map((slug) => readSummaryWhere("unit_slug", slug)));
    const validRows = rows.filter((row): row is GbpReviewSummaryRow => Boolean(row));
    if (!validRows.length) return null;

    const totalReviews = validRows.reduce((sum, row) => sum + toNumber(row.total_reviews), 0);
    return {
        totalReviews,
        weightedRating: computeWeightedRatingFromRows(
            validRows.map((row) => ({
                averageRating: row.average_rating,
                totalReviews: toNumber(row.total_reviews),
            })),
        ),
        capturedAtMs: validRows.reduce((max, row) => Math.max(max, toNumber(row.synced_at_ms)), 0) || null,
    };
}
