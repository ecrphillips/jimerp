-- First, update any NULL display_names to use the roast_group value
UPDATE public.roast_groups
SET display_name = REPLACE(roast_group, '_', ' ')
WHERE display_name IS NULL OR display_name = '';

-- Make display_name NOT NULL and add UNIQUE constraint
ALTER TABLE public.roast_groups
ALTER COLUMN display_name SET NOT NULL;

-- Add unique constraint on display_name
ALTER TABLE public.roast_groups
ADD CONSTRAINT roast_groups_display_name_unique UNIQUE (display_name);