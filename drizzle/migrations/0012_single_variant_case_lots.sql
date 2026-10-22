ALTER TABLE public.products ADD COLUMN case_lot_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT;
ALTER TABLE public.products ADD COLUMN case_lot_units integer;
ALTER TABLE public.products ADD CONSTRAINT products_case_lot_composition_check CHECK ((case_lot_product_id IS NULL AND case_lot_units IS NULL) OR (case_lot_product_id IS NOT NULL AND case_lot_units > 0 AND case_lot_units IS NOT NULL AND case_lot_product_id <> id));
CREATE INDEX products_case_lot_product_idx ON public.products(case_lot_product_id) WHERE case_lot_product_id IS NOT NULL;
COMMENT ON COLUMN public.products.case_lot_product_id IS 'Phase-one Case Lot contents: one ordinary variant from the same product family. Delete restricted while used.';
COMMENT ON COLUMN public.products.case_lot_units IS 'Number of contained variant units per Case Lot; case weight is contained variant weight multiplied by this quantity.';
CREATE OR REPLACE FUNCTION public.validate_case_lot_product() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_type text; v_component public.products%ROWTYPE; v_weight bigint; v_component_type text;
BEGIN
  SELECT lower(btrim(name)) INTO v_type FROM public.packaging_types WHERE id = NEW.packaging_type_id;
  IF v_type = 'case lot' THEN
    IF NEW.case_lot_product_id IS NULL OR NEW.case_lot_units IS NULL OR NEW.case_lot_units <= 0 OR NEW.case_lot_product_id = NEW.id THEN
      RAISE EXCEPTION 'Case Lot requires an existing variant and a positive whole-number quantity';
    END IF;
    SELECT * INTO v_component FROM public.products WHERE id = NEW.case_lot_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Case Lot contents are not accessible'; END IF;
    SELECT lower(btrim(name)) INTO v_component_type FROM public.packaging_types WHERE id = v_component.packaging_type_id;
    IF v_component.case_lot_product_id IS NOT NULL OR v_component_type = 'case lot' THEN RAISE EXCEPTION 'Cases cannot contain other cases'; END IF;
    IF COALESCE(NEW.account_id, NEW.client_id) IS DISTINCT FROM COALESCE(v_component.account_id, v_component.client_id)
       OR btrim(regexp_replace(NEW.product_name, '[\s\-]+\d+(\.\d+)?(g|kg|lb)(\s+[A-Za-z]+){0,3}$', '', 'i')) IS DISTINCT FROM btrim(regexp_replace(v_component.product_name, '[\s\-]+\d+(\.\d+)?(g|kg|lb)(\s+[A-Za-z]+){0,3}$', '', 'i'))
       OR NEW.roast_group IS DISTINCT FROM v_component.roast_group THEN
      RAISE EXCEPTION 'Case Lot contents must belong to the same account and product family';
    END IF;
    IF TG_OP = 'INSERT' AND NOT v_component.is_active THEN RAISE EXCEPTION 'Choose an active variant for Case Lot contents'; END IF;
    v_weight := COALESCE(v_component.grams_per_unit, v_component.bag_size_g)::bigint * NEW.case_lot_units;
    IF v_weight IS NULL OR v_weight <= 0 OR v_weight > 2147483647 THEN RAISE EXCEPTION 'Case Lot weight is invalid'; END IF;
    NEW.bag_size_g := v_weight::integer;
    NEW.grams_per_unit := v_weight::integer;
    NEW.packaging_variant := NULL;
    NEW.format := v_component.format;
    NEW.grind_options := v_component.grind_options;
  ELSIF NEW.case_lot_product_id IS NOT NULL OR NEW.case_lot_units IS NOT NULL THEN
    RAISE EXCEPTION 'Case contents are only supported for Case Lot packaging';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_validate_case_lot_product BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_case_lot_product();
NOTIFY pgrst, 'reload schema';