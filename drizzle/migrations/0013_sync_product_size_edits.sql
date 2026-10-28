CREATE OR REPLACE FUNCTION public.normalize_product_packaging()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_grams integer;
  v_type text;
  v_family text;
  v_refresh boolean;
BEGIN
  v_refresh := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_refresh := NEW.bag_size_g IS DISTINCT FROM OLD.bag_size_g
      OR NEW.grams_per_unit IS DISTINCT FROM OLD.grams_per_unit
      OR NEW.packaging_type_id IS DISTINCT FROM OLD.packaging_type_id;
    IF NEW.bag_size_g IS DISTINCT FROM OLD.bag_size_g THEN
      NEW.grams_per_unit := NEW.bag_size_g;
    ELSIF NEW.grams_per_unit IS DISTINCT FROM OLD.grams_per_unit THEN
      NEW.bag_size_g := COALESCE(NEW.grams_per_unit, NEW.bag_size_g);
    END IF;
  END IF;

  IF NEW.grams_per_unit IS NULL AND COALESCE(NEW.bag_size_g, 0) > 0 THEN
    NEW.grams_per_unit := NEW.bag_size_g;
  ELSIF COALESCE(NEW.bag_size_g, 0) = 0 AND COALESCE(NEW.grams_per_unit, 0) > 0 THEN
    NEW.bag_size_g := NEW.grams_per_unit;
  ELSIF NEW.bag_size_g IS DISTINCT FROM NEW.grams_per_unit THEN
    NEW.grams_per_unit := NEW.bag_size_g;
  END IF;

  v_grams := COALESCE(NULLIF(NEW.grams_per_unit, 0), NULLIF(NEW.bag_size_g, 0));
  IF v_refresh OR NEW.packaging_variant IS NULL THEN
    IF NEW.packaging_type_id IS NOT NULL THEN
      SELECT lower(name) INTO v_type FROM public.packaging_types WHERE id = NEW.packaging_type_id;
    END IF;
    v_family := CASE
      WHEN v_type LIKE '%case%' THEN 'CASE'
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