-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

CREATE TABLE IF NOT EXISTS site_behavior_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    page_url TEXT,
    page_path TEXT,
    page_host TEXT,
    referrer TEXT,
    landing_page TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    fbclid TEXT,
    fbp TEXT,
    fbc TEXT,
    link_url TEXT,
    link_host TEXT,
    link_path TEXT,
    link_type TEXT,
    placement TEXT,
    source TEXT,
    unit_slug TEXT,
    service_id TEXT,
    booking_id TEXT,
    consent_analytics INTEGER NOT NULL DEFAULT 0,
    consent_marketing INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_behavior_created_at ON site_behavior_events(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_site_behavior_event_name ON site_behavior_events(event_name, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_site_behavior_campaign ON site_behavior_events(utm_campaign, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_site_behavior_page_path ON site_behavior_events(page_path, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_site_behavior_unit ON site_behavior_events(unit_slug, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_site_behavior_service ON site_behavior_events(service_id, created_at_ms);
