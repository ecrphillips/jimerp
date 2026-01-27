-- Make display_name uniqueness case-insensitive via CITEXT
-- (DEV/TEST safe: preserves schema, just changes column type)
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE public.roast_groups
  ALTER COLUMN display_name TYPE citext
  USING display_name::citext;

-- Ensure the unique constraint exists (it may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roast_groups_display_name_unique'
      AND conrelid = 'public.roast_groups'::regclass
  ) THEN
    ALTER TABLE public.roast_groups
      ADD CONSTRAINT roast_groups_display_name_unique UNIQUE (display_name);
  END IF;
END $$;