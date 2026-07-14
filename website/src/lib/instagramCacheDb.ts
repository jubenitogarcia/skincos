import { getCloudflareContext } from "@opennextjs/cloudflare";

export type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    first: <T = unknown>() => Promise<T | null>;
    run: () => Promise<{ success: boolean; error?: string } | unknown>;
};

export type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
};

type CloudflareEnv = {
    BOOKING_DB?: D1DatabaseLike;
};

export type InstagramCachedProfile = {
    handle: string;
    user_id: string | null;
    username: string | null;
    full_name: string | null;
    biography: string | null;
    avatar_url: string | null;
    is_verified: number | null;
    is_private: number | null;
    is_business: number | null;
    is_professional: number | null;
    external_url: string | null;
    category_name: string | null;
    public_email: string | null;
    public_phone: string | null;
    profile_payload_json: string | null;
    last_success_sync_ms: number;
    last_attempt_sync_ms: number;
    last_error: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

export type InstagramCachedProfileStats = {
    handle: string;
    followers_count: number | null;
    following_count: number | null;
    media_count: number | null;
    updated_at_ms: number;
};

export type InstagramCachedMediaRow = {
    id: string;
    handle: string;
    media_id: string;
    code: string | null;
    media_type: "image" | "video" | "carousel";
    is_reel: number;
    is_story: number;
    caption: string | null;
    like_count: number | null;
    comment_count: number | null;
    play_count: number | null;
    view_count: number | null;
    duration_seconds: number | null;
    location_name: string | null;
    product_type: string | null;
    resources_count: number | null;
    is_pinned: number;
    taken_at_ms: number | null;
    thumbnail_url: string | null;
    video_url: string | null;
    permalink: string | null;
    payload_json: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

export type UpsertProfileInput = {
    handle: string;
    userId: string | null;
    username: string | null;
    fullName: string | null;
    biography: string | null;
    avatarUrl: string | null;
    isVerified: boolean | null;
    isPrivate: boolean | null;
    isBusiness: boolean | null;
    isProfessional: boolean | null;
    externalUrl: string | null;
    categoryName: string | null;
    publicEmail: string | null;
    publicPhone: string | null;
    profilePayloadJson: string | null;
    lastError?: string | null;
    syncedAtMs: number;
};

export type UpsertProfileStatsInput = {
    handle: string;
    followersCount: number | null;
    followingCount: number | null;
    mediaCount: number | null;
    syncedAtMs: number;
};

export type UpsertMediaInput = {
    id: string;
    handle: string;
    mediaId: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    isStory: boolean;
    caption: string | null;
    likeCount: number | null;
    commentCount: number | null;
    playCount: number | null;
    viewCount: number | null;
    durationSeconds: number | null;
    locationName: string | null;
    productType: string | null;
    resourcesCount: number | null;
    isPinned: boolean;
    takenAtMs: number | null;
    thumbnailUrl: string | null;
    videoUrl: string | null;
    permalink: string | null;
    payloadJson: string | null;
    updatedAtMs: number;
};

let ensured = false;

async function runSchemaStatement(db: D1DatabaseLike, query: string, ignoredErrors: string[] = []): Promise<void> {
    try {
        await db.prepare(query).run();
    } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (ignoredErrors.some((entry) => message.includes(entry.toLowerCase()))) {
            return;
        }
        throw error;
    }
}

function getDbOrNull(): D1DatabaseLike | null {
    try {
        const { env } = getCloudflareContext();
        const typed = env as unknown as CloudflareEnv;
        return typed.BOOKING_DB ?? null;
    } catch {
        return null;
    }
}

export async function getInstagramCacheDb(): Promise<D1DatabaseLike | null> {
    const db = getDbOrNull();
    if (!db) return null;
    if (!ensured) {
        await ensureSchema(db);
        ensured = true;
    }
    return db;
}

async function ensureSchema(db: D1DatabaseLike): Promise<void> {
    await runSchemaStatement(
        db,
        `CREATE TABLE IF NOT EXISTS instagram_profiles (
                handle TEXT PRIMARY KEY,
                user_id TEXT,
                username TEXT,
                full_name TEXT,
                biography TEXT,
                avatar_url TEXT,
                is_verified INTEGER,
                is_private INTEGER,
                is_business INTEGER,
                is_professional INTEGER,
                external_url TEXT,
                category_name TEXT,
                public_email TEXT,
                public_phone TEXT,
                profile_payload_json TEXT,
                last_success_sync_ms INTEGER NOT NULL DEFAULT 0,
                last_attempt_sync_ms INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );`,
    );

    await runSchemaStatement(
        db,
        `CREATE TABLE IF NOT EXISTS instagram_media (
                id TEXT PRIMARY KEY,
                handle TEXT NOT NULL,
                media_id TEXT NOT NULL,
                code TEXT,
                media_type TEXT NOT NULL,
                is_reel INTEGER NOT NULL DEFAULT 0,
                is_story INTEGER NOT NULL DEFAULT 0,
                caption TEXT,
                like_count INTEGER,
                comment_count INTEGER,
                play_count INTEGER,
                view_count INTEGER,
                duration_seconds REAL,
                location_name TEXT,
                product_type TEXT,
                resources_count INTEGER,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                taken_at_ms INTEGER,
                thumbnail_url TEXT,
                video_url TEXT,
                permalink TEXT,
                payload_json TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                UNIQUE(handle, media_id, is_story)
            );`,
    );

    await runSchemaStatement(
        db,
        `CREATE INDEX IF NOT EXISTS idx_instagram_media_handle_taken
             ON instagram_media(handle, is_story, taken_at_ms DESC, updated_at_ms DESC);`,
    );

    await runSchemaStatement(
        db,
        `CREATE TABLE IF NOT EXISTS instagram_sync_runs (
                id TEXT PRIMARY KEY,
                source TEXT,
                handle TEXT,
                started_at_ms INTEGER NOT NULL,
                finished_at_ms INTEGER,
                success INTEGER NOT NULL DEFAULT 0,
                fetched_items INTEGER NOT NULL DEFAULT 0,
                fetched_stories INTEGER NOT NULL DEFAULT 0,
                upserted_items INTEGER NOT NULL DEFAULT 0,
                error TEXT
            );`,
    );

    await runSchemaStatement(
        db,
        `CREATE INDEX IF NOT EXISTS idx_instagram_sync_runs_handle_started
             ON instagram_sync_runs(handle, started_at_ms DESC);`,
    );

    await runSchemaStatement(
        db,
        `CREATE TABLE IF NOT EXISTS instagram_profile_stats (
                handle TEXT PRIMARY KEY,
                followers_count INTEGER,
                following_count INTEGER,
                media_count INTEGER,
                updated_at_ms INTEGER NOT NULL
            );`,
    );

    // Online evolution for workers that already have the base tables from previous deployments.
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN username TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN is_verified INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN is_private INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN is_business INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN is_professional INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN external_url TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN category_name TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN public_email TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN public_phone TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_profiles ADD COLUMN profile_payload_json TEXT;", ["duplicate column name"]);

    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN like_count INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN comment_count INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN play_count INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN view_count INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN duration_seconds REAL;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN location_name TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN product_type TEXT;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN resources_count INTEGER;", ["duplicate column name"]);
    await runSchemaStatement(db, "ALTER TABLE instagram_media ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;", ["duplicate column name"]);
}

export async function getInstagramCachedProfile(handle: string): Promise<InstagramCachedProfile | null> {
    const db = await getInstagramCacheDb();
    if (!db) return null;
    return db
        .prepare(
            `SELECT handle, user_id, username, full_name, biography, avatar_url,
                is_verified, is_private, is_business, is_professional,
                external_url, category_name, public_email, public_phone, profile_payload_json,
                    last_success_sync_ms, last_attempt_sync_ms, last_error, created_at_ms, updated_at_ms
             FROM instagram_profiles
             WHERE handle = ?
             LIMIT 1;`,
        )
        .bind(handle)
        .first<InstagramCachedProfile>();
}

export async function upsertInstagramCachedProfile(input: UpsertProfileInput): Promise<void> {
    const db = await getInstagramCacheDb();
    if (!db) return;

    const now = input.syncedAtMs;
    await db
        .prepare(
            `INSERT INTO instagram_profiles (
                handle, user_id, username, full_name, biography, avatar_url,
                is_verified, is_private, is_business, is_professional,
                external_url, category_name, public_email, public_phone, profile_payload_json,
                last_success_sync_ms, last_attempt_sync_ms, last_error,
                created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(handle) DO UPDATE SET
                user_id = excluded.user_id,
                username = excluded.username,
                full_name = excluded.full_name,
                biography = excluded.biography,
                avatar_url = excluded.avatar_url,
                is_verified = excluded.is_verified,
                is_private = excluded.is_private,
                is_business = excluded.is_business,
                is_professional = excluded.is_professional,
                external_url = excluded.external_url,
                category_name = excluded.category_name,
                public_email = excluded.public_email,
                public_phone = excluded.public_phone,
                profile_payload_json = excluded.profile_payload_json,
                last_success_sync_ms = excluded.last_success_sync_ms,
                last_attempt_sync_ms = excluded.last_attempt_sync_ms,
                last_error = excluded.last_error,
                updated_at_ms = excluded.updated_at_ms;`,
        )
        .bind(
            input.handle,
            input.userId,
            input.username,
            input.fullName,
            input.biography,
            input.avatarUrl,
            input.isVerified == null ? null : input.isVerified ? 1 : 0,
            input.isPrivate == null ? null : input.isPrivate ? 1 : 0,
            input.isBusiness == null ? null : input.isBusiness ? 1 : 0,
            input.isProfessional == null ? null : input.isProfessional ? 1 : 0,
            input.externalUrl,
            input.categoryName,
            input.publicEmail,
            input.publicPhone,
            input.profilePayloadJson,
            now,
            now,
            input.lastError ?? null,
            now,
            now,
        )
        .run();
}

export async function getInstagramCachedProfileStats(handle: string): Promise<InstagramCachedProfileStats | null> {
    const db = await getInstagramCacheDb();
    if (!db) return null;

    return db
        .prepare(
            `SELECT handle, followers_count, following_count, media_count, updated_at_ms
             FROM instagram_profile_stats
             WHERE handle = ?
             LIMIT 1;`,
        )
        .bind(handle)
        .first<InstagramCachedProfileStats>();
}

export async function upsertInstagramCachedProfileStats(input: UpsertProfileStatsInput): Promise<void> {
    const db = await getInstagramCacheDb();
    if (!db) return;

    await db
        .prepare(
            `INSERT INTO instagram_profile_stats (
                handle, followers_count, following_count, media_count, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(handle) DO UPDATE SET
                followers_count = excluded.followers_count,
                following_count = excluded.following_count,
                media_count = excluded.media_count,
                updated_at_ms = excluded.updated_at_ms;`,
        )
        .bind(
            input.handle,
            input.followersCount,
            input.followingCount,
            input.mediaCount,
            input.syncedAtMs,
        )
        .run();
}

export async function markInstagramSyncAttempt(params: {
    handle: string;
    attemptAtMs: number;
    error: string | null;
}): Promise<void> {
    const db = await getInstagramCacheDb();
    if (!db) return;

    await db
        .prepare(
            `INSERT INTO instagram_profiles (
                handle, user_id, full_name, biography, avatar_url,
                last_success_sync_ms, last_attempt_sync_ms, last_error,
                created_at_ms, updated_at_ms
            ) VALUES (?, NULL, NULL, NULL, NULL, 0, ?, ?, ?, ?)
            ON CONFLICT(handle) DO UPDATE SET
                last_attempt_sync_ms = excluded.last_attempt_sync_ms,
                last_error = excluded.last_error,
                updated_at_ms = excluded.updated_at_ms;`,
        )
        .bind(params.handle, params.attemptAtMs, params.error, params.attemptAtMs, params.attemptAtMs)
        .run();
}

export async function upsertInstagramMediaBatch(items: UpsertMediaInput[]): Promise<number> {
    const db = await getInstagramCacheDb();
    if (!db || !items.length) return 0;

    for (const item of items) {
        const createdAtMs = item.takenAtMs ?? item.updatedAtMs;
        await db
            .prepare(
                `INSERT INTO instagram_media (
                    id, handle, media_id, code, media_type, is_reel, is_story, caption,
                    like_count, comment_count, play_count, view_count,
                    duration_seconds, location_name, product_type, resources_count, is_pinned,
                    taken_at_ms, thumbnail_url, video_url, permalink, payload_json,
                    created_at_ms, updated_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    handle = excluded.handle,
                    media_id = excluded.media_id,
                    code = excluded.code,
                    media_type = excluded.media_type,
                    is_reel = excluded.is_reel,
                    is_story = excluded.is_story,
                    caption = excluded.caption,
                        like_count = excluded.like_count,
                        comment_count = excluded.comment_count,
                        play_count = excluded.play_count,
                        view_count = excluded.view_count,
                        duration_seconds = excluded.duration_seconds,
                        location_name = excluded.location_name,
                        product_type = excluded.product_type,
                        resources_count = excluded.resources_count,
                        is_pinned = excluded.is_pinned,
                    taken_at_ms = excluded.taken_at_ms,
                    thumbnail_url = excluded.thumbnail_url,
                    video_url = excluded.video_url,
                    permalink = excluded.permalink,
                    payload_json = excluded.payload_json,
                    updated_at_ms = excluded.updated_at_ms;`,
            )
            .bind(
                item.id,
                item.handle,
                item.mediaId,
                item.code,
                item.mediaType,
                item.isReel ? 1 : 0,
                item.isStory ? 1 : 0,
                item.caption,
                item.likeCount,
                item.commentCount,
                item.playCount,
                item.viewCount,
                item.durationSeconds,
                item.locationName,
                item.productType,
                item.resourcesCount,
                item.isPinned ? 1 : 0,
                item.takenAtMs,
                item.thumbnailUrl,
                item.videoUrl,
                item.permalink,
                item.payloadJson,
                createdAtMs,
                item.updatedAtMs,
            )
            .run();
    }

    return items.length;
}

export async function listInstagramCachedMedia(params: {
    handle: string;
    includeStories: boolean;
    limit: number;
    offset: number;
}): Promise<InstagramCachedMediaRow[]> {
    const db = await getInstagramCacheDb();
    if (!db) return [];

    const rows = await db
        .prepare(
            `SELECT id, handle, media_id, code, media_type, is_reel, is_story, caption,
                    like_count, comment_count, play_count, view_count,
                    duration_seconds, location_name, product_type, resources_count, is_pinned,
                    taken_at_ms, thumbnail_url, video_url, permalink, payload_json,
                    created_at_ms, updated_at_ms
             FROM instagram_media
             WHERE handle = ? AND (? = 1 OR is_story = 0)
             ORDER BY COALESCE(taken_at_ms, 0) DESC, updated_at_ms DESC
             LIMIT ? OFFSET ?;`,
        )
        .bind(params.handle, params.includeStories ? 1 : 0, params.limit, params.offset)
        .all<InstagramCachedMediaRow>();

    return rows.results ?? [];
}

export async function pruneInstagramCache(params: {
    handle: string;
    keepPosts: number;
    removeStoriesOlderThanMs: number;
}): Promise<void> {
    const db = await getInstagramCacheDb();
    if (!db) return;

    await db
        .prepare(
            `DELETE FROM instagram_media
             WHERE handle = ?
               AND is_story = 1
               AND COALESCE(taken_at_ms, updated_at_ms, 0) < ?;`,
        )
        .bind(params.handle, params.removeStoriesOlderThanMs)
        .run();

    await db
        .prepare(
            `DELETE FROM instagram_media
             WHERE id IN (
                SELECT id FROM instagram_media
                WHERE handle = ? AND is_story = 0
                ORDER BY COALESCE(taken_at_ms, 0) DESC, updated_at_ms DESC
                LIMIT -1 OFFSET ?
             );`,
        )
        .bind(params.handle, params.keepPosts)
        .run();
}

export async function insertInstagramSyncRun(params: {
    id: string;
    source: string | null;
    handle: string;
    startedAtMs: number;
    finishedAtMs: number;
    success: boolean;
    fetchedItems: number;
    fetchedStories: number;
    upsertedItems: number;
    error: string | null;
}): Promise<void> {
    const db = await getInstagramCacheDb();
    if (!db) return;

    await db
        .prepare(
            `INSERT INTO instagram_sync_runs (
                id, source, handle, started_at_ms, finished_at_ms, success,
                fetched_items, fetched_stories, upserted_items, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .bind(
            params.id,
            params.source,
            params.handle,
            params.startedAtMs,
            params.finishedAtMs,
            params.success ? 1 : 0,
            params.fetchedItems,
            params.fetchedStories,
            params.upsertedItems,
            params.error,
        )
        .run();
}

export function newInstagramSyncRunId(): string {
    const random = Math.random().toString(16).slice(2);
    return `igsync_${Date.now()}_${random}`;
}
