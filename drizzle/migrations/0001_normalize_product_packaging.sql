CREATE OR REPLACE FUNCTION public.normalize_product_packaging()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_grams integer;
  v_type text;
  v_family text;
BEGIN
  -- One size figure: keep bag_size_g and grams_per_unit in step.
  IF NEW.grams_per_unit IS NULL AND COALESCE(NEW.bag_size_g, 0) > 0 THEN
    NEW.grams_per_unit := NEW.bag_size_g;
  ELSIF COALESCE(NEW.bag_size_g, 0) = 0 AND COALESCE(NEW.grams_per_unit, 0) > 0 THEN
    NEW.bag_size_g := NEW.grams_per_unit;
  END IF;

  v_grams := COALESCE(NULLIF(NEW.grams_per_unit, 0), NULLIF(NEW.bag_size_g, 0));

  -- Fill the size badge field whenever the type + size has a matching value.
  IF NEW.packaging_variant IS NULL AND v_grams IS NOT NULL THEN
    IF NEW.packaging_type_id IS NOT NULL THEN
      SELECT lower(name) INTO v_type FROM public.packaging_types WHERE id = NEW.packaging_type_id;
    END IF;
    v_family := CASE
      WHEN v_type LIKE '%crowler%' THEN 'CROWLER'
      WHEN v_type LIKE '%can%' THEN 'CAN'
      ELSE NULL END;
    NEW.packaging_variant := CASE
      WHEN v_family = 'CROWLER' AND v_grams = 200 THEN 'CROWLER_200G'
      WHEN v_family = 'CROWLER' AND v_grams = 250 THEN 'CROWLER_250G'
      WHEN v_family = 'CAN' AND v_grams = 125 THEN 'CAN_125G'
      WHEN v_family IS NULL AND v_grams = 200 THEN 'RETAIL_200G'
      WHEN v_family IS NULL AND v_grams = 250 THEN 'RETAIL_250G'
      WHEN v_family IS NULL AND v_grams = 300 THEN 'RETAIL_300G'
      WHEN v_family IS NULL AND v_grams = 340 THEN 'RETAIL_340G'
      WHEN v_family IS NULL AND v_grams = 454 THEN 'RETAIL_454G'
      WHEN v_family IS NULL AND v_grams IN (907, 908) THEN 'BULK_2LB'
      WHEN v_family IS NULL AND v_grams = 1000 THEN 'BULK_1KG'
      WHEN v_family IS NULL AND v_grams = 2000 THEN 'BULK_2KG'
      WHEN v_family IS NULL AND v_grams IN (2268, 2270) THEN 'BULK_5LB'
      ELSE NULL END::public.packaging_variant;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_product_packaging ON public.products;
CREATE TRIGGER trg_normalize_product_packaging
BEFORE INSERT OR UPDATE OF bag_size_g, grams_per_unit, packaging_variant, packaging_type_id
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.normalize_product_packaging();