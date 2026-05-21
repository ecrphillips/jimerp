-- Co-roasting pricing transparency: packaging-block override columns + per-field audit trail.
--
-- Adds two new override columns on accounts (packaging blocks) alongside the existing
-- coroast_custom_* columns, plus a coroast_account_pricing_audit table populated by an
-- AFTER UPDATE trigger on accounts. Members read their own audit rows via account_users.
--
-- Follow-up (out of scope): _get_or_create_billing_period in migration
-- 20260501195324_*.sql still hard-codes TIER_RATES. It should read accounts.coroast_custom_*
-- with fallback to the CASE block so account overrides flow into billing-period snapshots.

-- ── Extend overrides on accounts ─────────────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS coroast_custom_packaging_blocks_included integer,
  ADD COLUMN IF NOT EXISTS coroast_custom_packaging_block_rate numeric;

-- ── Audit table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coroast_account_pricing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  changed_field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coroast_account_pricing_audit_account_changed_idx
  ON public.coroast_account_pricing_audit (account_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS coroast_account_pricing_audit_field_idx
  ON public.coroast_account_pricing_audit (account_id, changed_field, changed_at DESC);

ALTER TABLE public.coroast_account_pricing_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/Ops manage pricing audit" ON public.coroast_account_pricing_audit;
CREATE POLICY "Admin/Ops manage pricing audit"
  ON public.coroast_account_pricing_audit FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

DROP POLICY IF EXISTS "Members read own pricing audit" ON public.coroast_account_pricing_audit;
CREATE POLICY "Members read own pricing audit"
  ON public.coroast_account_pricing_audit FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_account_pricing_audit.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

DROP POLICY IF EXISTS "Deny anon pricing audit" ON public.coroast_account_pricing_audit;
CREATE POLICY "Deny anon pricing audit"
  ON public.coroast_account_pricing_audit FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- ── Trigger: log every changed coroast_custom_* field on accounts ────────────
CREATE OR REPLACE FUNCTION public.log_coroast_pricing_override_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF OLD.coroast_custom_base_fee IS DISTINCT FROM NEW.coroast_custom_base_fee THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'monthly_fee',
            OLD.coroast_custom_base_fee::text, NEW.coroast_custom_base_fee::text, v_actor);
  END IF;

  IF OLD.coroast_custom_included_hours IS DISTINCT FROM NEW.coroast_custom_included_hours THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'included_hours',
            OLD.coroast_custom_included_hours::text, NEW.coroast_custom_included_hours::text, v_actor);
  END IF;

  IF OLD.coroast_custom_overage_rate IS DISTINCT FROM NEW.coroast_custom_overage_rate THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'overage_rate',
            OLD.coroast_custom_overage_rate::text, NEW.coroast_custom_overage_rate::text, v_actor);
  END IF;

  IF OLD.coroast_custom_included_pallets IS DISTINCT FROM NEW.coroast_custom_included_pallets THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'storage_included_pallets',
            OLD.coroast_custom_included_pallets::text, NEW.coroast_custom_included_pallets::text, v_actor);
  END IF;

  IF OLD.coroast_custom_storage_rate IS DISTINCT FROM NEW.coroast_custom_storage_rate THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'storage_overage_rate',
            OLD.coroast_custom_storage_rate::text, NEW.coroast_custom_storage_rate::text, v_actor);
  END IF;

  IF OLD.coroast_custom_packaging_blocks_included IS DISTINCT FROM NEW.coroast_custom_packaging_blocks_included THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'packaging_blocks_included',
            OLD.coroast_custom_packaging_blocks_included::text, NEW.coroast_custom_packaging_blocks_included::text, v_actor);
  END IF;

  IF OLD.coroast_custom_packaging_block_rate IS DISTINCT FROM NEW.coroast_custom_packaging_block_rate THEN
    INSERT INTO public.coroast_account_pricing_audit
      (account_id, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'packaging_block_rate',
            OLD.coroast_custom_packaging_block_rate::text, NEW.coroast_custom_packaging_block_rate::text, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_coroast_pricing_override_changes ON public.accounts;
CREATE TRIGGER trg_log_coroast_pricing_override_changes
  AFTER UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_coroast_pricing_override_changes();
