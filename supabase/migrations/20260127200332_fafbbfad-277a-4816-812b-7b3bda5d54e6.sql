-- Add roast_group_code and metadata to roast_groups
ALTER TABLE public.roast_groups 
ADD COLUMN IF NOT EXISTS roast_group_code TEXT,
ADD COLUMN IF NOT EXISTS is_blend BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS origin TEXT,
ADD COLUMN IF NOT EXISTS blend_name TEXT;

-- Backfill existing roast groups with generated codes (first 3 chars uppercase)
UPDATE public.roast_groups 
SET roast_group_code = UPPER(SUBSTRING(REGEXP_REPLACE(roast_group, '[^a-zA-Z]', '', 'g'), 1, 3))
WHERE roast_group_code IS NULL;

-- Handle any duplicates by appending numbers
WITH duplicates AS (
  SELECT roast_group, roast_group_code,
         ROW_NUMBER() OVER (PARTITION BY roast_group_code ORDER BY created_at) as rn
  FROM public.roast_groups
  WHERE roast_group_code IS NOT NULL
)
UPDATE public.roast_groups rg
SET roast_group_code = rg.roast_group_code || d.rn::TEXT
FROM duplicates d
WHERE rg.roast_group = d.roast_group AND d.rn > 1;

-- Now make it NOT NULL and UNIQUE
ALTER TABLE public.roast_groups 
ALTER COLUMN roast_group_code SET NOT NULL;

ALTER TABLE public.roast_groups 
ADD CONSTRAINT roast_groups_code_unique UNIQUE (roast_group_code);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_roast_groups_code ON public.roast_groups(roast_group_code);