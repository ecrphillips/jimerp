ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS production_weekdays integer[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN public.accounts.production_weekdays IS
  'ISO weekday numbers (1=Mon ... 7=Sun) on which this account has scheduled production. Empty array means no fixed schedule; order work deadlines are set manually for these accounts.';