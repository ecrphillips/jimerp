CREATE OR REPLACE FUNCTION public.customer_can_view_product(p_product_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS') THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.account_users au WHERE au.user_id = auth.uid() AND au.is_active
    AND public._customer_product_access(au.account_id, p_product_id, 'visible')
  );
END;
$$;