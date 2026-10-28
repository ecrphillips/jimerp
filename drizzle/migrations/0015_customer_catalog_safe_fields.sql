CREATE OR REPLACE FUNCTION public.get_customer_products(p_account_id uuid, p_catalog boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS') OR EXISTS (
      SELECT 1 FROM public.account_users au WHERE au.account_id = p_account_id AND au.user_id = auth.uid() AND au.is_active
    )
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'product_name', p.product_name, 'sku', p.sku,
    'bag_size_g', p.bag_size_g, 'grams_per_unit', p.grams_per_unit,
    'format', p.format, 'packaging_variant', p.packaging_variant, 'roast_group', p.roast_group,
    'is_active', p.is_active, 'is_perennial', p.is_perennial, 'packaging_type_id', p.packaging_type_id,
    'case_lot_product_id', p.case_lot_product_id, 'case_lot_units', p.case_lot_units,
    'packaging_types', CASE WHEN pt.id IS NULL THEN NULL ELSE jsonb_build_object('name', pt.name) END,
    'customer_orderable', public._customer_product_access(p_account_id, p.id, 'orderable')
  ) ORDER BY p.product_name, COALESCE(p.grams_per_unit, p.bag_size_g))
  FROM public.products p LEFT JOIN public.packaging_types pt ON pt.id = p.packaging_type_id
  WHERE public._customer_product_access(p_account_id, p.id, CASE WHEN p_catalog THEN 'visible' ELSE 'orderable' END)), '[]'::jsonb);
END;
$$;
ALTER POLICY "Clients can view own products" ON public.products
USING (public.customer_can_view_product(id));
NOTIFY pgrst, 'reload schema';