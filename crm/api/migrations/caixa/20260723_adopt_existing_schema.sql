BEGIN;
CREATE TABLE IF NOT EXISTS public.skincos_schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
  IF to_regclass('crm_caixa.customers') IS NULL OR to_regclass('crm_caixa.sales') IS NULL THEN
    RAISE EXCEPTION 'Caixa baseline is absent; use a reviewed bootstrap migration, never application startup.';
  END IF;
END $$;
INSERT INTO public.skincos_schema_migrations(id, checksum) VALUES ('caixa/20260723_adopt_existing_schema', 'versioned-adoption-v1') ON CONFLICT (id) DO NOTHING;
COMMIT;
