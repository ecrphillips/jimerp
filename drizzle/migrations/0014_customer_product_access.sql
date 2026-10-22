CREATE TABLE public.account_product_access (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  visible boolean NOT NULL DEFAULT true,
  orderable boolean NOT NULL DEFAULT true,
  case_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, product_id),
  CONSTRAINT hidden_not_orderable CHECK (visible OR NOT orderable)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_product_access TO authenticated;
GRANT ALL ON public.account_product_access TO service_role;
ALTER TABLE public.account_product_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_manage_product_access ON public.account_product_access FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));
CREATE POLICY members_read_product_access ON public.account_product_access FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.account_users au WHERE au.account_id = account_product_access.account_id AND au.user_id = auth.uid() AND au.is_active));

CREATE FUNCTION public._customer_product_access(p_account_id uuid, p_product_id uuid, p_mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_mode = 'case_held' THEN EXISTS (
    SELECT 1 FROM public.products c JOIN public.account_product_access ca ON ca.product_id = c.id AND ca.account_id = p_account_id
    WHERE c.case_lot_product_id = p_product_id AND c.is_active AND ca.case_only
  ) ELSE EXISTS (
    SELECT 1 FROM public.products p
    LEFT JOIN public.account_product_access a ON a.account_id = p_account_id AND a.product_id = p.id
    WHERE p.id = p_product_id AND p.is_active
    AND ((NOT EXISTS (SELECT 1 FROM public.client_allowed_products cap WHERE cap.account_id = p_account_id) AND p.account_id = p_account_id)
      OR EXISTS (SELECT 1 FROM public.client_allowed_products cap WHERE cap.account_id = p_account_id AND cap.product_id = p.id))
    AND COALESCE(a.visible, true)
    AND (p_mode = 'visible' OR (COALESCE(a.orderable, true) AND NOT EXISTS (
      SELECT 1 FROM public.products c JOIN public.account_product_access ca ON ca.product_id = c.id AND ca.account_id = p_account_id
      WHERE c.case_lot_product_id = p.id AND c.is_active AND ca.case_only
    )))
  ) END;
$$;
REVOKE ALL ON FUNCTION public._customer_product_access(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_customer_products(p_account_id uuid, p_catalog boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS') OR EXISTS (
      SELECT 1 FROM public.account_users au WHERE au.account_id = p_account_id AND au.user_id = auth.uid() AND au.is_active
    )
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
    'packaging_types', CASE WHEN pt.id IS NULL THEN NULL ELSE jsonb_build_object('name', pt.name) END,
    'customer_orderable', public._customer_product_access(p_account_id, p.id, 'orderable')
  ) ORDER BY p.product_name, COALESCE(p.grams_per_unit, p.bag_size_g))
  FROM public.products p LEFT JOIN public.packaging_types pt ON pt.id = p.packaging_type_id
  WHERE public._customer_product_access(p_account_id, p.id, CASE WHEN p_catalog THEN 'visible' ELSE 'orderable' END)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_products(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_products(uuid, boolean) TO authenticated;

CREATE FUNCTION public.validate_customer_products(p_account_id uuid, p_product_ids uuid[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS') OR EXISTS (
      SELECT 1 FROM public.account_users au WHERE au.account_id = p_account_id AND au.user_id = auth.uid() AND au.is_active
    )
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM unnest(p_product_ids) id WHERE NOT public._customer_product_access(p_account_id, id, 'orderable'));
END;
$$;
REVOKE ALL ON FUNCTION public.validate_customer_products(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_customer_products(uuid, uuid[]) TO authenticated;

CREATE FUNCTION public.validate_account_product_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product public.products;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id;
  IF NOT (v_product.account_id = NEW.account_id OR EXISTS (
    SELECT 1 FROM public.client_allowed_products cap WHERE cap.account_id = NEW.account_id AND cap.product_id = NEW.product_id
  )) THEN RAISE EXCEPTION 'Product is not linked to this account'; END IF;
  IF NEW.case_only AND v_product.case_lot_product_id IS NULL THEN RAISE EXCEPTION 'Case lot only requires a Case Lot variant'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_account_product_access BEFORE INSERT OR UPDATE ON public.account_product_access
FOR EACH ROW EXECUTE FUNCTION public.validate_account_product_access();

CREATE FUNCTION public.customer_can_view_product(p_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS') OR EXISTS (
    SELECT 1 FROM public.account_users au WHERE au.user_id = auth.uid() AND au.is_active
    AND public._customer_product_access(au.account_id, p_product_id, 'visible')
  );
$$;
REVOKE ALL ON FUNCTION public.customer_can_view_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_can_view_product(uuid) TO authenticated;
CREATE POLICY customer_product_visibility ON public.products AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.customer_can_view_product(id));

ALTER TABLE public.order_line_items ADD COLUMN case_only_override_confirmed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.order_line_items.case_only_override_confirmed IS 'Staff explicitly confirmed an internal loose-unit order for an account with Case Lot only enabled.';
CREATE FUNCTION public.enforce_customer_product_ordering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account_id uuid; v_staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
    AND NEW.quantity_units IS NOT DISTINCT FROM OLD.quantity_units AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id THEN RETURN NEW; END IF;
  SELECT account_id INTO v_account_id FROM public.orders WHERE id = NEW.order_id;
  v_staff := public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS');
  IF v_staff THEN
    IF public._customer_product_access(v_account_id, NEW.product_id, 'case_held') AND NOT NEW.case_only_override_confirmed THEN
      RAISE EXCEPTION 'Confirm ordering individual units for this case-only customer';
    END IF;
  ELSE
    IF NOT public._customer_product_access(v_account_id, NEW.product_id, 'orderable') THEN
      RAISE EXCEPTION 'This product is not available for customer ordering' USING ERRCODE = '42501';
    END IF;
    NEW.case_only_override_confirmed := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_customer_product_ordering BEFORE INSERT OR UPDATE ON public.order_line_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_product_ordering();

CREATE FUNCTION public.validate_customer_order_change_products()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line jsonb; v_product_id uuid;
BEGIN
  IF NEW.proposed ? 'line_items' THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.proposed->'line_items') LOOP
      IF NULLIF(v_line->>'line_item_id', '') IS NOT NULL THEN
        SELECT product_id INTO v_product_id FROM public.order_line_items WHERE id = (v_line->>'line_item_id')::uuid AND order_id = NEW.order_id;
      ELSE v_product_id := NULLIF(v_line->>'product_id', '')::uuid; END IF;
      IF v_product_id IS NULL OR NOT public._customer_product_access(NEW.account_id, v_product_id, 'orderable') THEN
        RAISE EXCEPTION 'This product is no longer available for customer ordering' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_customer_order_change_products BEFORE INSERT OR UPDATE OF proposed, status ON public.order_change_requests
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_order_change_products();
NOTIFY pgrst, 'reload schema';