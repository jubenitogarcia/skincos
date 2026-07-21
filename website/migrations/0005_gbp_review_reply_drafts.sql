-- Approval-gated Google Business Profile review replies.
CREATE TABLE IF NOT EXISTS gbp_review_reply_drafts (
    id TEXT PRIMARY KEY,
    unit_slug TEXT NOT NULL,
    review_id TEXT NOT NULL,
    location_resource_name TEXT NOT NULL,
    comment TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'approved', 'publishing', 'published', 'failed')),
    approved_by TEXT,
    approved_at_ms INTEGER,
    published_at_ms INTEGER,
    google_reply_update_ms INTEGER,
    last_error TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gbp_review_reply_drafts_status
ON gbp_review_reply_drafts(status, updated_at_ms DESC);
