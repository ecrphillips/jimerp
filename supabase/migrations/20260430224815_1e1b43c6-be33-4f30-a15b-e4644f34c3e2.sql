ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS financing_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS financing_apr_pct numeric NOT NULL DEFAULT 12.0;