-- Phase 1: Add SELECT-only RLS policies for CLIENT self-read on member-portal-surfaced tables.

-- Account-scoped reads: bookings, invoices, billing periods
CREATE POLICY "Account members can read their coroast_bookings"
  ON public.coroast_bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = coroast_bookings.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Account members can read their coroast_invoices"
  ON public.coroast_invoices
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = coroast_invoices.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Account members can read their coroast_billing_periods"
  ON public.coroast_billing_periods
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = coroast_billing_periods.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

-- Global (shared roaster) reads: gated behind active COROASTING program membership
CREATE POLICY "Active co-roasting members can read coroast_loring_blocks"
  ON public.coroast_loring_blocks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      JOIN public.accounts a ON a.id = au.account_id
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND 'COROASTING' = ANY(a.programs)
    )
  );

CREATE POLICY "Active co-roasting members can read coroast_recurring_blocks"
  ON public.coroast_recurring_blocks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      JOIN public.accounts a ON a.id = au.account_id
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND 'COROASTING' = ANY(a.programs)
    )
  );

-- Preventive: location tables
CREATE POLICY "Account members can read their account_locations"
  ON public.account_locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = account_locations.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Users can read their own account_user_locations"
  ON public.account_user_locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.id = account_user_locations.account_user_id
        AND au.user_id = auth.uid()
    )
  );