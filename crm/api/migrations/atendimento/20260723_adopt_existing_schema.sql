BEGIN;
CREATE TABLE IF NOT EXISTS public.skincos_schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
  IF to_regclass('crm_atendimento.units') IS NULL OR to_regclass('crm_atendimento.attendances') IS NULL OR to_regclass('crm_atendimento.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Atendimento baseline is absent; use a reviewed bootstrap migration, never application startup.';
  END IF;
END $$;
INSERT INTO public.skincos_schema_migrations(id, checksum) VALUES ('atendimento/20260723_adopt_existing_schema', 'versioned-adoption-v1') ON CONFLICT (id) DO NOTHING;
COMMIT;
