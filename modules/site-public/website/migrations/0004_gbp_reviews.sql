-- Google Business Profile reviews cache for highlighted units
-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

CREATE TABLE IF NOT EXISTS gbp_review_summaries (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gbp_review_summaries_place_id
ON gbp_review_summaries(place_id);

CREATE TABLE IF NOT EXISTS gbp_reviews (
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
);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_unit_updated
ON gbp_reviews(unit_slug, update_time_ms DESC, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_place_updated
ON gbp_reviews(place_id, update_time_ms DESC, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS gbp_review_sync_runs (
    id TEXT PRIMARY KEY,
    unit_slug TEXT NOT NULL,
    place_id TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER,
    success INTEGER NOT NULL DEFAULT 0,
    fetched_reviews INTEGER NOT NULL DEFAULT 0,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_gbp_review_sync_runs_unit_started
ON gbp_review_sync_runs(unit_slug, started_at_ms DESC);
