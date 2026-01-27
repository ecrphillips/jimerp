-- Create a case-insensitive unique index on products.sku
-- First clean up any null SKUs that might conflict
-- Then add a unique index (case-insensitive)

-- Create a unique index that ignores nulls and is case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique_ci 
ON public.products (UPPER(TRIM(sku))) 
WHERE sku IS NOT NULL;