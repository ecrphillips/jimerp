-- Co-roasting booking rules: first-class tier defaults + per-account overrides + audit.
--
-- Stage 1 of a three-stage rollout. Stage 2 wires these tables into the SECURITY DEFINER
-- member booking RPCs so they enforce server-side; Stage 3 adds admin UI. Until Stage 2
-- ships, the React-side 4-week / 48-hour checks remain the only enforcement.
--
-- Pattern mirrors coroast pricing overrides (coroast_custom_* columns on accounts +
-- coroast_account_pricing_audit), with two intentional differences:
--   1. Tier defaults live in a real table (coroast_tier_booking_rules) because admins
--      must edit them without a code deploy.
--   2. Audit is unified for tier + account changes via a `source` discriminator.

-- ── Tier defaults table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coroast_tier_booking_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier public.coroast_tier NOT NULL UNIQUE,
  booking_horizon_days integer NOT NULL CHECK (booking_horizon_days > 0),
  cancellation_free_hours integer NOT NULL CHECK (cancellation_free_hours >= 0),
  min_booking_duration_hours numeric NOT NULL DEFAULT 0.5 CHECK (min_booking_duration_hours > 0),
  max_booking_duration_hours numeric NOT NULL DEFAULT 8 CHECK (max_booking_duration_hours >= min_booking_duration_hours),
  allow_recurring_bookings boolean NOT NULL,
  allow_past_dated_bookings boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.coroast_tier_booking_rules
  (tier, booking_horizon_days, cancellation_free_hours, min_booking_duration_hours, max_booking_duration_hours, allow_recurring_bookings, allow_past_dated_bookings)
VALUES
  ('MEMBER',     28,  48, 0.5, 8, false, false),
  ('GROWTH',     365, 48, 0.5, 8, true,  false),
  ('PRODUCTION', 365, 48, 0.5, 8, true,  false),
  ('ACCESS',     28,  48, 0.5, 8, false, false)
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE public.coroast_tier_booking_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/Ops manage tier booking rules" ON public.coroast_tier_booking_rules;
CREATE POLICY "Admin/Ops manage tier booking rules"
  ON public.coroast_tier_booking_rules FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

DROP POLICY IF EXISTS "Authenticated read tier booking rules" ON public.coroast_tier_booking_rules;
CREATE POLICY "Authenticated read tier booking rules"
  ON public.coroast_tier_booking_rules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Deny anon tier booking rules" ON public.coroast_tier_booking_rules;
CREATE POLICY "Deny anon tier booking rules"
  ON public.coroast_tier_booking_rules FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- ── Per-account overrides (columns on accounts) ──────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS coroast_custom_booking_horizon_days integer,
  ADD COLUMN IF NOT EXISTS coroast_custom_cancellation_free_hours integer,
  ADD COLUMN IF NOT EXISTS coroast_custom_min_booking_duration_hours numeric,
  ADD COLUMN IF NOT EXISTS coroast_custom_max_booking_duration_hours numeric,
  ADD COLUMN IF NOT EXISTS coroast_custom_allow_recurring_bookings boolean;

-- ── Unified audit table (tier + account) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coroast_booking_rules_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('TIER', 'ACCOUNT')),
  tier public.coroast_tier,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  changed_field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source = 'TIER' AND tier IS NOT NULL AND account_id IS NULL)
    OR (source = 'ACCOUNT' AND account_id IS NOT NULL AND tier IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS coroast_booking_rules_audit_source_changed_idx
  ON public.coroast_booking_rules_audit (source, changed_at DESC);

CREATE INDEX IF NOT EXISTS coroast_booking_rules_audit_account_changed_idx
  ON public.coroast_booking_rules_audit (account_id, changed_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS coroast_booking_rules_audit_tier_changed_idx
  ON public.coroast_booking_rules_audit (tier, changed_at DESC)
  WHERE tier IS NOT NULL;

ALTER TABLE public.coroast_booking_rules_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/Ops manage booking rules audit" ON public.coroast_booking_rules_audit;
CREATE POLICY "Admin/Ops manage booking rules audit"
  ON public.coroast_booking_rules_audit FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

DROP POLICY IF EXISTS "Members read own account booking audit" ON public.coroast_booking_rules_audit;
CREATE POLICY "Members read own account booking audit"
  ON public.coroast_booking_rules_audit FOR SELECT TO authenticated
  USING (
    source = 'ACCOUNT'
    AND EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = coroast_booking_rules_audit.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

DROP POLICY IF EXISTS "Deny anon booking rules audit" ON public.coroast_booking_rules_audit;
CREATE POLICY "Deny anon booking rules audit"
  ON public.coroast_booking_rules_audit FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- ── Trigger: tier rule changes ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_coroast_tier_booking_rule_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF OLD.booking_horizon_days IS DISTINCT FROM NEW.booking_horizon_days THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'booking_horizon_days',
            OLD.booking_horizon_days::text, NEW.booking_horizon_days::text, v_actor);
  END IF;

  IF OLD.cancellation_free_hours IS DISTINCT FROM NEW.cancellation_free_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'cancellation_free_hours',
            OLD.cancellation_free_hours::text, NEW.cancellation_free_hours::text, v_actor);
  END IF;

  IF OLD.min_booking_duration_hours IS DISTINCT FROM NEW.min_booking_duration_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'min_booking_duration_hours',
            OLD.min_booking_duration_hours::text, NEW.min_booking_duration_hours::text, v_actor);
  END IF;

  IF OLD.max_booking_duration_hours IS DISTINCT FROM NEW.max_booking_duration_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'max_booking_duration_hours',
            OLD.max_booking_duration_hours::text, NEW.max_booking_duration_hours::text, v_actor);
  END IF;

  IF OLD.allow_recurring_bookings IS DISTINCT FROM NEW.allow_recurring_bookings THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'allow_recurring_bookings',
            OLD.allow_recurring_bookings::text, NEW.allow_recurring_bookings::text, v_actor);
  END IF;

  IF OLD.allow_past_dated_bookings IS DISTINCT FROM NEW.allow_past_dated_bookings THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, tier, changed_field, old_value, new_value, changed_by)
    VALUES ('TIER', NEW.tier, 'allow_past_dated_bookings',
            OLD.allow_past_dated_bookings::text, NEW.allow_past_dated_bookings::text, v_actor);
  END IF;

  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_coroast_tier_booking_rule_changes ON public.coroast_tier_booking_rules;
CREATE TRIGGER trg_log_coroast_tier_booking_rule_changes
  BEFORE UPDATE ON public.coroast_tier_booking_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_coroast_tier_booking_rule_changes();

-- ── Trigger: per-account override changes ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_coroast_booking_override_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF OLD.coroast_custom_booking_horizon_days IS DISTINCT FROM NEW.coroast_custom_booking_horizon_days THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, account_id, changed_field, old_value, new_value, changed_by)
    VALUES ('ACCOUNT', NEW.id, 'booking_horizon_days',
            OLD.coroast_custom_booking_horizon_days::text, NEW.coroast_custom_booking_horizon_days::text, v_actor);
  END IF;

  IF OLD.coroast_custom_cancellation_free_hours IS DISTINCT FROM NEW.coroast_custom_cancellation_free_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, account_id, changed_field, old_value, new_value, changed_by)
    VALUES ('ACCOUNT', NEW.id, 'cancellation_free_hours',
            OLD.coroast_custom_cancellation_free_hours::text, NEW.coroast_custom_cancellation_free_hours::text, v_actor);
  END IF;

  IF OLD.coroast_custom_min_booking_duration_hours IS DISTINCT FROM NEW.coroast_custom_min_booking_duration_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, account_id, changed_field, old_value, new_value, changed_by)
    VALUES ('ACCOUNT', NEW.id, 'min_booking_duration_hours',
            OLD.coroast_custom_min_booking_duration_hours::text, NEW.coroast_custom_min_booking_duration_hours::text, v_actor);
  END IF;

  IF OLD.coroast_custom_max_booking_duration_hours IS DISTINCT FROM NEW.coroast_custom_max_booking_duration_hours THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, account_id, changed_field, old_value, new_value, changed_by)
    VALUES ('ACCOUNT', NEW.id, 'max_booking_duration_hours',
            OLD.coroast_custom_max_booking_duration_hours::text, NEW.coroast_custom_max_booking_duration_hours::text, v_actor);
  END IF;

  IF OLD.coroast_custom_allow_recurring_bookings IS DISTINCT FROM NEW.coroast_custom_allow_recurring_bookings THEN
    INSERT INTO public.coroast_booking_rules_audit
      (source, account_id, changed_field, old_value, new_value, changed_by)
    VALUES ('ACCOUNT', NEW.id, 'allow_recurring_bookings',
            OLD.coroast_custom_allow_recurring_bookings::text, NEW.coroast_custom_allow_recurring_bookings::text, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_coroast_booking_override_changes ON public.accounts;
CREATE TRIGGER trg_log_coroast_booking_override_changes
  AFTER UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_coroast_booking_override_changes();
