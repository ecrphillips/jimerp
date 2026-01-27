-- Move citext out of public schema to satisfy linter
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext') THEN
    -- Move extension if it's currently in public
    IF EXISTS (
      SELECT 1
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'citext' AND n.nspname = 'public'
    ) THEN
      EXECUTE 'ALTER EXTENSION citext SET SCHEMA extensions';
    END IF;
  END IF;
END $$;