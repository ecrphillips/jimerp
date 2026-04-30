ALTER TABLE public.pricing_rules
  ADD COLUMN carry_risk_premium_pct numeric NOT NULL DEFAULT 8.0;

ALTER TABLE public.green_lots
  ADD COLUMN carry_risk_premium_pct_override numeric NULL;

COMMENT ON COLUMN public.pricing_rules.carry_risk_premium_pct IS
  'Percentage uplift applied to green book value to produce de-risked green cost. Covers financing, carry, and risk that should not sit in book value. Used as default for every green lot under this profile unless the lot has its own override.';

COMMENT ON COLUMN public.green_lots.carry_risk_premium_pct_override IS
  'When set, overrides pricing_rules.carry_risk_premium_pct for this specific lot. Null = inherit profile default.';