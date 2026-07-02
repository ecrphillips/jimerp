-- Shopify variant unit multiplier: units_per_shopify_unit
--
-- *** Already applied to live DB on 2026-07-02 via Lovable SQL editor — do not re-run blindly. ***
--
-- 1. shopify_product_mappings.units_per_shopify_unit: one unit of a Shopify
--    variant equals N units of the mapped JIM product. Example: a subscription
--    box variant "4 x 250g" mapped to the JIM product "Sub Coffee 250g can"
--    with units_per_shopify_unit = 4, so an order of 2 boxes creates demand
--    for 8 cans. Default 1 keeps every existing mapping 1:1.
-- 2. resolve_shopify_quarantined_line: the old 2-argument version is DROPPED
--    and recreated with p_units_per_shopify_unit integer DEFAULT 1. It
--    multiplies the quarantined line's quantity by the multiplier when folding
--    into the bundle order, and writes the multiplier onto the mapping row.
--    Called with multiplier 1 (or omitted), behaviour is identical to before.
--
-- PROVENANCE: the function body below is an EXACT copy of the live definition
-- (dumped via pg_get_functiondef immediately after applying, 2026-07-02).
-- This function's SQL previously existed only in the live database (see commit
-- 11c2a96); from now on this file is the source of record.

ALTER TABLE public.shopify_product_mappings
  ADD COLUMN IF NOT EXISTS units_per_shopify_unit integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.shopify_product_mappings.units_per_shopify_unit IS
  'One unit of this Shopify variant = N units of the mapped JIM product. Default 1 (normal products).';

-- Signature change (added argument with a default) requires dropping the old
-- 2-argument overload; otherwise both would coexist and RPC calls would be
-- ambiguous.
DROP FUNCTION IF EXISTS public.resolve_shopify_quarantined_line(uuid, uuid);

CREATE OR REPLACE FUNCTION public.resolve_shopify_quarantined_line(
  p_line_id uuid,
  p_jim_product_id uuid,
  p_units_per_shopify_unit integer DEFAULT 1
)
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

  SELECT needs_grind, grind_label
    INTO v_needs_grind, v_grind_label
    FROM public.shopify_grind_signal(
      concat_ws(' / ', nullif(v_line.shopify_product_title, ''), nullif(v_line.shopify_variant_title, ''))
    );

  IF v_line.bundle_order_id IS NOT NULL THEN
    SELECT id INTO v_existing_li
      FROM public.order_line_items
     WHERE order_id = v_line.bundle_order_id
       AND product_id = p_jim_product_id
     ORDER BY created_at
     LIMIT 1;

    IF v_existing_li IS NOT NULL THEN
      UPDATE public.order_line_items
         SET quantity_units = quantity_units + v_qty,
             needs_grind = v_needs_grind,
             grind_label = v_grind_label
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
$function$;

REVOKE ALL ON FUNCTION public.resolve_shopify_quarantined_line(uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_shopify_quarantined_line(uuid, uuid, integer)
  TO authenticated;
