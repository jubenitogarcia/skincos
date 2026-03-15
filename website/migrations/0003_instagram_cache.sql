-- Instagram cache (posts/reels/stories) for website-native loading
-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

CREATE TABLE IF NOT EXISTS instagram_profiles (
    handle TEXT PRIMARY KEY,
    user_id TEXT,
    full_name TEXT,
    biography TEXT,
    avatar_url TEXT,
    last_success_sync_ms INTEGER NOT NULL DEFAULT 0,
    last_attempt_sync_ms INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_media (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    media_id TEXT NOT NULL,
    code TEXT,
    media_type TEXT NOT NULL,
    is_reel INTEGER NOT NULL DEFAULT 0,
    is_story INTEGER NOT NULL DEFAULT 0,
    caption TEXT,
    taken_at_ms INTEGER,
    thumbnail_url TEXT,
    video_url TEXT,
    permalink TEXT,
    payload_json TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(handle, media_id, is_story)
);

CREATE INDEX IF NOT EXISTS idx_instagram_media_handle_taken
ON instagram_media(handle, is_story, taken_at_ms DESC, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS instagram_sync_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_instagram_sync_runs_handle_started
ON instagram_sync_runs(handle, started_at_ms DESC);
