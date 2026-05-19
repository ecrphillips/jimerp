-- Create client unit economics scenarios table for /client/numbers
CREATE TABLE IF NOT EXISTS public.client_unit_economics_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  name text NOT NULL DEFAULT 'Untitled scenario',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_ue_scenarios_account
  ON public.client_unit_economics_scenarios(account_id);

ALTER TABLE public.client_unit_economics_scenarios ENABLE ROW LEVEL SECURITY;

-- Account members can manage their own scenarios
DROP POLICY IF EXISTS "Account users can view own scenarios" ON public.client_unit_economics_scenarios;
CREATE POLICY "Account users can view own scenarios"
ON public.client_unit_economics_scenarios FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

DROP POLICY IF EXISTS "Account users can insert own scenarios" ON public.client_unit_economics_scenarios;
CREATE POLICY "Account users can insert own scenarios"
ON public.client_unit_economics_scenarios FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

DROP POLICY IF EXISTS "Account users can update own scenarios" ON public.client_unit_economics_scenarios;
CREATE POLICY "Account users can update own scenarios"
ON public.client_unit_economics_scenarios FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

DROP POLICY IF EXISTS "Account users can delete own scenarios" ON public.client_unit_economics_scenarios;
CREATE POLICY "Account users can delete own scenarios"
ON public.client_unit_economics_scenarios FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_unit_economics_scenarios.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

-- Admin/Ops full access
DROP POLICY IF EXISTS "Admin/Ops manage all client scenarios" ON public.client_unit_economics_scenarios;
CREATE POLICY "Admin/Ops manage all client scenarios"
ON public.client_unit_economics_scenarios FOR ALL
USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_client_ue_scenarios_updated_at ON public.client_unit_economics_scenarios;
CREATE TRIGGER trg_client_ue_scenarios_updated_at
BEFORE UPDATE ON public.client_unit_economics_scenarios
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();