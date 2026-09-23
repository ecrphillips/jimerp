DROP POLICY IF EXISTS "Authenticated users can view availability windows" ON public.coroast_availability_windows;
CREATE POLICY "Staff or account users can view availability windows" ON public.coroast_availability_windows
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS')
  OR EXISTS (SELECT 1 FROM public.account_users au WHERE au.user_id = auth.uid() AND au.is_active = true)
);
DROP POLICY IF EXISTS "Authenticated read tier booking rules" ON public.coroast_tier_booking_rules;
CREATE POLICY "Staff or account users read tier booking rules" ON public.coroast_tier_booking_rules
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS')
  OR EXISTS (SELECT 1 FROM public.account_users au WHERE au.user_id = auth.uid() AND au.is_active = true)
);
DROP POLICY IF EXISTS "Anyone authenticated can read tier rates" ON public.coroast_tier_rates;
CREATE POLICY "Staff or account users read tier rates" ON public.coroast_tier_rates
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS')
  OR EXISTS (SELECT 1 FROM public.account_users au WHERE au.user_id = auth.uid() AND au.is_active = true)
);