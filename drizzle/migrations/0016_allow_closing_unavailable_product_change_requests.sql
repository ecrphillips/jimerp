CREATE OR REPLACE FUNCTION public.validate_customer_order_change_products()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line jsonb; v_product_id uuid;
BEGIN
  IF NEW.status IN ('DECLINED', 'WITHDRAWN') THEN RETURN NEW; END IF;
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