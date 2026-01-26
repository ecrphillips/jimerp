-- Add display_order column to roast_groups for manual ordering
ALTER TABLE public.roast_groups 
ADD COLUMN IF NOT EXISTS display_order integer;

-- Add pack_display_order column to products for Pack tab manual ordering
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS pack_display_order integer;

-- Backfill roast_groups.display_order with current alphabetical order
WITH ordered_groups AS (
  SELECT roast_group, ROW_NUMBER() OVER (ORDER BY roast_group) * 10 AS new_order
  FROM public.roast_groups
)
UPDATE public.roast_groups rg
SET display_order = og.new_order
FROM ordered_groups og
WHERE rg.roast_group = og.roast_group;

-- Backfill products.pack_display_order with current alphabetical order
WITH ordered_products AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY product_name) * 10 AS new_order
  FROM public.products
  WHERE is_active = true
)
UPDATE public.products p
SET pack_display_order = op.new_order
FROM ordered_products op
WHERE p.id = op.id;