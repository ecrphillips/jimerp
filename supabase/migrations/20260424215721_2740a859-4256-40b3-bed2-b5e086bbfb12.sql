-- Unit Economics scenarios table
CREATE TABLE public.coroast_unit_economics_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scenario_owner_xor CHECK (
    (account_id IS NOT NULL AND prospect_id IS NULL) OR
    (account_id IS NULL AND prospect_id IS NOT NULL)
  )
);

CREATE INDEX idx_uescenarios_account ON public.coroast_unit_economics_scenarios(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_uescenarios_prospect ON public.coroast_unit_economics_scenarios(prospect_id) WHERE prospect_id IS NOT NULL;

ALTER TABLE public.coroast_unit_economics_scenarios ENABLE ROW LEVEL SECURITY;

-- Deny anon
CREATE POLICY "Deny anon ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- Admin/Ops full access
CREATE POLICY "Admin/Ops manage ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Account members can manage scenarios for their account
CREATE POLICY "Account users read own ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR SELECT
TO authenticated
USING (
  account_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

CREATE POLICY "Account users insert own ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR INSERT
TO authenticated
WITH CHECK (
  account_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

CREATE POLICY "Account users update own ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR UPDATE
TO authenticated
USING (
  account_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
)
WITH CHECK (
  account_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

CREATE POLICY "Account users delete own ue scenarios"
ON public.coroast_unit_economics_scenarios
FOR DELETE
TO authenticated
USING (
  account_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

-- updated_at trigger
CREATE TRIGGER ue_scenarios_updated_at
BEFORE UPDATE ON public.coroast_unit_economics_scenarios
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();