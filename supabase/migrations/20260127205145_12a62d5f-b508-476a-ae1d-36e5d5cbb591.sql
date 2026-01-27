-- Add display_name column to roast_groups (nullable, falls back to roast_group in UI)
ALTER TABLE public.roast_groups
ADD COLUMN display_name text NULL;