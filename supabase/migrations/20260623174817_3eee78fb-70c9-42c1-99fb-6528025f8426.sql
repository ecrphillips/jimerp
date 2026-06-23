-- H-3: Lock clients out of mutating order_shipments once order is past SUBMITTED
DROP POLICY IF EXISTS "Clients manage own order shipments" ON public.order_shipments;

CREATE POLICY "Clients view own order shipments"
  ON public.order_shipments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

CREATE POLICY "Clients mutate own order shipments only when editable"
  ON public.order_shipments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND o.status IN ('DRAFT','SUBMITTED')
  ));

CREATE POLICY "Clients update own order shipments only when editable"
  ON public.order_shipments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND o.status IN ('DRAFT','SUBMITTED')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND o.status IN ('DRAFT','SUBMITTED')
  ));

CREATE POLICY "Clients delete own order shipments only when editable"
  ON public.order_shipments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND o.status IN ('DRAFT','SUBMITTED')
  ));