CREATE OR REPLACE FUNCTION public.get_order_pack_holds()
RETURNS TABLE(order_line_item_id uuid, order_id uuid, order_number text, product_id uuid, held_units integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_internal_staff();
  RETURN QUERY
  SELECT li.id, o.id, o.order_number::text, li.product_id, (a.packed_units - a.picked_units)::integer
  FROM public.get_pack_line_allocations() a
  JOIN public.pack_line_progress p ON p.order_line_item_id = a.order_line_item_id
  JOIN public.order_line_items li ON li.id = a.order_line_item_id
  JOIN public.orders o ON o.id = li.order_id
  WHERE a.packed_units > a.picked_units;
END $$;
REVOKE ALL ON FUNCTION public.get_order_pack_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_pack_holds() TO authenticated, service_role;