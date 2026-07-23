BEGIN;
CREATE TABLE IF NOT EXISTS public.skincos_schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
  IF to_regclass('harmonia.units') IS NULL OR to_regclass('harmonia.conversations') IS NULL OR to_regclass('harmonia.messages') IS NULL THEN
    RAISE EXCEPTION 'Harmonia baseline is absent; use a reviewed bootstrap migration, never application startup.';
  END IF;
END $$;
INSERT INTO public.skincos_schema_migrations(id, checksum) VALUES ('harmonia/20260723_adopt_existing_schema', 'versioned-adoption-v1') ON CONFLICT (id) DO NOTHING;
COMMIT;
