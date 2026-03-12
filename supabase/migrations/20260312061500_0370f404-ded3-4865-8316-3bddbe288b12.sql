
-- Step 1: Create new enum type
CREATE TYPE public.green_coffee_category_new AS ENUM ('BLENDER', 'SINGLE_ORIGIN');

-- Step 2: Alter green_samples to use new enum
ALTER TABLE public.green_samples 
  ALTER COLUMN category TYPE public.green_coffee_category_new 
  USING CASE 
    WHEN category::text = 'BULK_BLENDER' THEN 'BLENDER'::public.green_coffee_category_new
    WHEN category::text = 'SUPER_NICE' THEN 'SINGLE_ORIGIN'::public.green_coffee_category_new
    ELSE category::text::public.green_coffee_category_new
  END;

-- Step 3: Alter green_contracts to use new enum
ALTER TABLE public.green_contracts 
  ALTER COLUMN category TYPE public.green_coffee_category_new 
  USING CASE 
    WHEN category::text = 'BULK_BLENDER' THEN 'BLENDER'::public.green_coffee_category_new
    WHEN category::text = 'SUPER_NICE' THEN 'SINGLE_ORIGIN'::public.green_coffee_category_new
    ELSE category::text::public.green_coffee_category_new
  END;

-- Step 4: Drop old enum and rename new one
DROP TYPE public.green_coffee_category;
ALTER TYPE public.green_coffee_category_new RENAME TO green_coffee_category;

-- Step 5: Add new columns to green_samples
ALTER TABLE public.green_samples ADD COLUMN crop_year text;
ALTER TABLE public.green_samples ADD COLUMN sample_relationship text;
ALTER TABLE public.green_samples ADD COLUMN related_lot_id uuid REFERENCES public.green_lots(id) ON DELETE SET NULL;
ALTER TABLE public.green_samples ADD COLUMN same_coffee_as_previous boolean;
