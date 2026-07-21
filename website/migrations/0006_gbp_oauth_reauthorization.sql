-- Encrypted OAuth refresh-token storage for Google Business Profile reauthorization.
CREATE TABLE IF NOT EXISTS gbp_oauth_authorizations (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL UNIQUE,
    expires_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gbp_oauth_refresh_tokens (
    provider TEXT PRIMARY KEY,
    encrypted_refresh_token TEXT NOT NULL,
    iv TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
