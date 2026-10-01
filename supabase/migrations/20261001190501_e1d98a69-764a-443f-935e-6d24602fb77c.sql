CREATE OR REPLACE FUNCTION public.resolve_shopify_quarantined_line(p_line_id uuid, p_jim_product_id uuid, p_units_per_shopify_unit integer DEFAULT 1, p_needs_grind boolean DEFAULT NULL::boolean, p_grind_label text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line public.shopify_quarantined_lines%ROWTYPE;
  v_existing_li uuid;
  v_shipment_id uuid;
  v_price numeric;
  v_vtitle text;
  v_grind public.grind_option;
  v_needs_grind boolean;
  v_grind_label text;
  v_mult integer;
  v_qty numeric;
  v_rule text;
  v_rule_label text;
BEGIN
  IF NOT (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_mult := GREATEST(coalesce(p_units_per_shopify_unit, 1), 1);

  SELECT * INTO v_line FROM public.shopify_quarantined_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quarantined line % not found', p_line_id;
  END IF;
  IF v_line.status <> 'open' THEN
    RAISE EXCEPTION 'Line is already %', v_line.status;
  END IF;

  v_qty := GREATEST(v_line.quantity, 0) * v_mult;

  v_vtitle := upper(coalesce(v_line.shopify_variant_title, ''));
  v_grind := CASE
    WHEN v_vtitle LIKE '%WHOLE BEAN%' THEN 'WHOLE_BEAN'::grind_option
    WHEN v_vtitle LIKE '%ESPRESSO%' THEN 'ESPRESSO'::grind_option
    WHEN v_vtitle LIKE '%DRIP%'
      OR v_vtitle LIKE '%FILTER%'
      OR v_vtitle LIKE '%FRENCH PRESS%'
      OR v_vtitle LIKE '%POUR OVER%' THEN 'FILTER'::grind_option
    ELSE NULL
  END;

  IF p_needs_grind IS NULL THEN
    SELECT needs_grind, grind_label
      INTO v_needs_grind, v_grind_label
      FROM public.shopify_grind_signal(nullif(v_line.shopify_variant_title, ''));
  ELSE
    v_needs_grind := p_needs_grind;
    v_grind_label := CASE
      WHEN p_needs_grind
        THEN nullif(btrim(coalesce(p_grind_label, v_line.shopify_variant_title)), '')
      ELSE NULL
    END;
  END IF;

  -- Per-mapping grind rule overrides whatever the variant title implies.
  IF v_line.shopify_variant_id IS NOT NULL THEN
    SELECT grind_rule, grind_override_label
      INTO v_rule, v_rule_label
      FROM public.shopify_product_mappings
     WHERE source_id = v_line.source_id
       AND shopify_variant_id = v_line.shopify_variant_id
     LIMIT 1;

    IF v_rule = 'NEVER' THEN
      v_needs_grind := false;
      v_grind_label := NULL;
    ELSIF v_rule = 'ALWAYS' THEN
      v_needs_grind := true;
      v_grind_label := coalesce(nullif(btrim(coalesce(v_rule_label, '')), ''), v_grind_label);
    END IF;
  END IF;

  IF v_line.bundle_order_id IS NOT NULL THEN
    SELECT id INTO v_existing_li
      FROM public.order_line_items
     WHERE order_id = v_line.bundle_order_id
       AND product_id = p_jim_product_id
       AND coalesce(needs_grind, false) = coalesce(v_needs_grind, false)
       AND grind_label IS NOT DISTINCT FROM v_grind_label
     ORDER BY created_at
     LIMIT 1;

    IF v_existing_li IS NOT NULL THEN
      UPDATE public.order_line_items
         SET quantity_units = quantity_units + v_qty
       WHERE id = v_existing_li;
    ELSE
      SELECT id INTO v_shipment_id
        FROM public.order_shipments
       WHERE order_id = v_line.bundle_order_id
       ORDER BY shipment_number
       LIMIT 1;

      SELECT unit_price INTO v_price
        FROM public.price_list
       WHERE product_id = p_jim_product_id
         AND effective_date <= current_date
       ORDER BY effective_date DESC
       LIMIT 1;

      INSERT INTO public.order_line_items
        (order_id, product_id, quantity_units, unit_price_locked, grind, shipment_id, needs_grind, grind_label)
      VALUES
        (v_line.bundle_order_id, p_jim_product_id, v_qty,
         coalesce(v_price, 0), v_grind, v_shipment_id, v_needs_grind, v_grind_label);
    END IF;
  END IF;

  UPDATE public.shopify_quarantined_lines
     SET status = 'resolved',
         resolved_jim_product_id = p_jim_product_id,
         resolved_at = now(),
         resolved_by = auth.uid(),
         updated_at = now()
   WHERE id = p_line_id;

  IF v_line.shopify_variant_id IS NOT NULL THEN
    UPDATE public.shopify_product_mappings
       SET jim_product_id = p_jim_product_id,
           do_not_produce = false,
           units_per_shopify_unit = v_mult,
           shopify_product_id = coalesce(v_line.shopify_product_id, shopify_product_id),
           shopify_product_title = coalesce(v_line.shopify_product_title, shopify_product_title),
           shopify_sku = coalesce(v_line.shopify_sku, shopify_sku),
           mapped_at = now(),
           mapped_by = auth.uid(),
           last_seen_at = now(),
           updated_at = now()
     WHERE source_id = v_line.source_id
       AND shopify_variant_id = v_line.shopify_variant_id;
    IF NOT FOUND THEN
      INSERT INTO public.shopify_product_mappings
        (source_id, shopify_product_id, shopify_variant_id, jim_product_id, do_not_produce,
         units_per_shopify_unit, shopify_product_title, shopify_sku, mapped_at, mapped_by)
      VALUES
        (v_line.source_id, coalesce(v_line.shopify_product_id, ''), v_line.shopify_variant_id,
         p_jim_product_id, false, v_mult, v_line.shopify_product_title, v_line.shopify_sku, now(), auth.uid());
    END IF;
  END IF;
END;
$function$
;

-- Data repair: FNKXX-000195 Drop the Pressure was merged into one 38-unit grind line.
-- Split back into 37 whole bean + 1 "Ground Coffee - Drip".
UPDATE public.order_line_items SET quantity_units = 37, needs_grind = false, grind_label = NULL
 WHERE id = '958bc89e-6468-4b0a-b9c9-42e8949580a1' AND quantity_units = 38;
INSERT INTO public.order_line_items (order_id, product_id, quantity_units, unit_price_locked, grind, shipment_id, needs_grind, grind_label)
SELECT order_id, product_id, 1, unit_price_locked, 'FILTER'::grind_option, shipment_id, true, 'Ground Coffee - Drip'
  FROM public.order_line_items WHERE id = '958bc89e-6468-4b0a-b9c9-42e8949580a1' AND quantity_units = 37
   AND NOT EXISTS (SELECT 1 FROM public.order_line_items x WHERE x.order_id='57743433-40b1-4d0d-8637-2b87d4c6c92a'
     AND x.product_id='d29526e7-4434-4e73-95ae-d292f8b3acb7' AND x.needs_grind);

-- Same repair for Downtempo Decaf 250g Crowler on FNKXX-000195: 1 whole bean + 1 "Ground - Drip".
WITH l AS (
  SELECT id FROM public.order_line_items
   WHERE order_id='57743433-40b1-4d0d-8637-2b87d4c6c92a' AND product_id='3e748aeb-88be-4161-80d2-389acd9f6b14'
     AND quantity_units=2 AND needs_grind
), ins AS (
  INSERT INTO public.order_line_items (order_id, product_id, quantity_units, unit_price_locked, grind, shipment_id, needs_grind, grind_label)
  SELECT order_id, product_id, 1, unit_price_locked, 'FILTER'::grind_option, shipment_id, true, 'Ground - Drip'
    FROM public.order_line_items WHERE id IN (SELECT id FROM l)
  RETURNING id
)
UPDATE public.order_line_items SET quantity_units=1, needs_grind=false, grind_label=NULL, grind=NULL
 WHERE id IN (SELECT id FROM l);
