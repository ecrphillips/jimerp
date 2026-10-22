-- Run against an isolated database with the products schema and normalization
-- trigger installed. Every test change rolls back; never alters real products.
BEGIN;
DO $$
DECLARE
  v_type uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_row public.products%ROWTYPE;
BEGIN
  INSERT INTO public.packaging_types (id, name) VALUES (v_type, 'Retail Bag');
  INSERT INTO public.products (id, bag_size_g, grams_per_unit, packaging_variant, packaging_type_id)
    VALUES (v_product, 340, 340, 'RETAIL_340G', v_type);

  -- The regular editor changes bag_size_g while sending the old badge value.
  UPDATE public.products SET bag_size_g = 300, packaging_variant = 'RETAIL_340G' WHERE id = v_product;
  SELECT * INTO v_row FROM public.products WHERE id = v_product;
  IF v_row.bag_size_g IS DISTINCT FROM 300 OR v_row.grams_per_unit IS DISTINCT FROM 300
     OR v_row.packaging_variant IS DISTINCT FROM 'RETAIL_300G'::public.packaging_variant THEN
    RAISE EXCEPTION '340g to 300g edit must synchronize both size fields and the badge';
  END IF;

  -- Other workflows edit grams_per_unit instead.
  UPDATE public.products SET grams_per_unit = 340 WHERE id = v_product;
  SELECT * INTO v_row FROM public.products WHERE id = v_product;
  IF v_row.bag_size_g IS DISTINCT FROM 340 OR v_row.grams_per_unit IS DISTINCT FROM 340
     OR v_row.packaging_variant IS DISTINCT FROM 'RETAIL_340G'::public.packaging_variant THEN
    RAISE EXCEPTION 'Editing grams_per_unit must synchronize bag size and badge';
  END IF;

  -- Custom sizes must not keep a badge describing the previous size.
  UPDATE public.products SET bag_size_g = 310 WHERE id = v_product;
  SELECT * INTO v_row FROM public.products WHERE id = v_product;
  IF v_row.grams_per_unit IS DISTINCT FROM 310 OR v_row.packaging_variant IS NOT NULL THEN
    RAISE EXCEPTION 'Custom 310g size must clear the incompatible legacy badge';
  END IF;
END;
$$;
ROLLBACK;