CREATE TABLE IF NOT EXISTS crm_sessions.sessions (sid varchar NOT NULL COLLATE "default", sess json NOT NULL, expire timestamp(6) NOT NULL, CONSTRAINT "crm_sessions_pkey" PRIMARY KEY (sid));
CREATE INDEX IF NOT EXISTS "crm_sessions_expire_idx" ON crm_sessions.sessions (expire);
