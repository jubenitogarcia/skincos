-- Rich Instagram profile/media metadata for faster doctor modal rendering
-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

ALTER TABLE instagram_profiles ADD COLUMN username TEXT;
ALTER TABLE instagram_profiles ADD COLUMN is_verified INTEGER;
ALTER TABLE instagram_profiles ADD COLUMN is_private INTEGER;
ALTER TABLE instagram_profiles ADD COLUMN is_business INTEGER;
ALTER TABLE instagram_profiles ADD COLUMN is_professional INTEGER;
ALTER TABLE instagram_profiles ADD COLUMN external_url TEXT;
ALTER TABLE instagram_profiles ADD COLUMN category_name TEXT;
ALTER TABLE instagram_profiles ADD COLUMN public_email TEXT;
ALTER TABLE instagram_profiles ADD COLUMN public_phone TEXT;
ALTER TABLE instagram_profiles ADD COLUMN profile_payload_json TEXT;

ALTER TABLE instagram_media ADD COLUMN like_count INTEGER;
ALTER TABLE instagram_media ADD COLUMN comment_count INTEGER;
ALTER TABLE instagram_media ADD COLUMN play_count INTEGER;
ALTER TABLE instagram_media ADD COLUMN view_count INTEGER;
ALTER TABLE instagram_media ADD COLUMN duration_seconds REAL;
ALTER TABLE instagram_media ADD COLUMN location_name TEXT;
ALTER TABLE instagram_media ADD COLUMN product_type TEXT;
ALTER TABLE instagram_media ADD COLUMN resources_count INTEGER;
ALTER TABLE instagram_media ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
