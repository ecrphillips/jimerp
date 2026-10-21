CREATE TABLE public.pack_line_progress (
 order_line_item_id uuid PRIMARY KEY REFERENCES public.order_line_items(id) ON DELETE CASCADE,
 packed_units integer NOT NULL DEFAULT 0 CHECK (packed_units >= 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pack_line_progress TO authenticated;
GRANT ALL ON public.pack_line_progress TO service_role;
ALTER TABLE public.pack_line_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON public.pack_line_progress FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));
CREATE FUNCTION public.get_pack_line_allocations() RETURNS TABLE(order_line_item_id uuid, packed_units integer, picked_units integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public._assert_internal_staff();
 RETURN QUERY
 WITH lines AS (
 SELECT li.id, li.product_id, li.quantity_units, li.needs_grind, p.packed_units AS saved,
 LEAST(li.quantity_units, COALESCE((SELECT sum(sp.units_picked) FROM public.ship_picks sp WHERE sp.order_line_item_id=li.id),0))::integer AS picked,
 GREATEST(0, COALESCE((SELECT sum(t.quantity_units) FROM public.inventory_transactions t WHERE t.product_id=li.product_id AND t.transaction_type IN ('PACK_PRODUCE_FG','SHIP_CONSUME_FG','ADJUSTMENT')),0))::integer AS stock
 FROM public.order_line_items li JOIN public.orders o ON o.id=li.order_id LEFT JOIN public.pack_line_progress p ON p.order_line_item_id=li.id
 WHERE o.status IN ('SUBMITTED','CONFIRMED','IN_PRODUCTION','READY')
 ), requested AS (
 SELECT *, CASE WHEN saved IS NOT NULL THEN GREATEST(0, LEAST(quantity_units,saved)-picked) WHEN NOT needs_grind THEN GREATEST(0,quantity_units-picked) ELSE 0 END AS requested,
 CASE WHEN saved IS NOT NULL THEN 0 ELSE 1 END AS priority FROM lines
 ), allocated AS (
 SELECT *, COALESCE(sum(requested) OVER (PARTITION BY product_id ORDER BY priority,needs_grind,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS earlier FROM requested
 ) SELECT id, (picked+GREATEST(0,LEAST(requested,stock-earlier)))::integer, picked FROM allocated;
END $$;
REVOKE ALL ON FUNCTION public.get_pack_line_allocations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pack_line_allocations() TO authenticated;
CREATE FUNCTION public.update_pack_line_units(p_line_ids uuid[], p_new_units integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_product uuid; v_roast text; v_grams numeric; v_previous integer; v_picked integer; v_demand integer; v_stock integer; v_remaining integer; r record;
BEGIN
 PERFORM public._assert_internal_staff();
 IF p_new_units IS NULL OR p_new_units<0 OR COALESCE(cardinality(p_line_ids),0)=0 THEN RAISE EXCEPTION 'Invalid packed quantity'; END IF;
 SELECT li.product_id INTO v_product FROM public.order_line_items li WHERE li.id=p_line_ids[1];
 SELECT p.roast_group, COALESCE(NULLIF(p.grams_per_unit,0),p.bag_size_g) INTO v_roast,v_grams FROM public.products p WHERE p.id=v_product AND p.requires_production IS DISTINCT FROM false;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product cannot be packed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('pack_line:'||v_product::text));
 IF v_roast IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtext('pack_wip:'||v_roast)); END IF;
 IF (SELECT count(*) FROM public.order_line_items li JOIN public.orders o ON o.id=li.order_id WHERE li.id=ANY(p_line_ids) AND li.product_id=v_product AND o.status IN ('SUBMITTED','CONFIRMED','IN_PRODUCTION','READY')) <> cardinality(p_line_ids) THEN RAISE EXCEPTION 'Packing lines must belong to one active product'; END IF;
 SELECT COALESCE(sum(a.packed_units),0),COALESCE(sum(a.picked_units),0) INTO v_previous,v_picked FROM public.get_pack_line_allocations() a WHERE a.order_line_item_id=ANY(p_line_ids);
 SELECT sum(li.quantity_units) INTO v_demand FROM public.order_line_items li WHERE li.id=ANY(p_line_ids);
 IF p_new_units<v_picked OR p_new_units>v_demand THEN RAISE EXCEPTION 'Quantity must be between picked bags (%) and demand (%)',v_picked,v_demand; END IF;
 SELECT GREATEST(0,COALESCE(sum(t.quantity_units),0))::integer INTO v_stock FROM public.inventory_transactions t WHERE t.product_id=v_product AND t.transaction_type IN ('PACK_PRODUCE_FG','SHIP_CONSUME_FG','ADJUSTMENT');
 PERFORM public.update_packing_units(v_product,(now() AT TIME ZONE 'America/Vancouver')::date,v_stock+p_new_units-v_previous,v_grams,v_roast);
 v_remaining:=p_new_units-v_picked;
 FOR r IN SELECT li.id,li.quantity_units,a.picked_units FROM public.order_line_items li JOIN public.get_pack_line_allocations() a ON a.order_line_item_id=li.id WHERE li.id=ANY(p_line_ids) ORDER BY li.id LOOP
 INSERT INTO public.pack_line_progress(order_line_item_id,packed_units) VALUES(r.id,r.picked_units+LEAST(v_remaining,r.quantity_units-r.picked_units)) ON CONFLICT(order_line_item_id) DO UPDATE SET packed_units=EXCLUDED.packed_units,updated_at=now();
 v_remaining:=GREATEST(0,v_remaining-(r.quantity_units-r.picked_units));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.update_pack_line_units(uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_pack_line_units(uuid[],integer) TO authenticated;