ALTER TABLE public.account_locations
  ADD COLUMN IF NOT EXISTS production_weekdays integer[];

COMMENT ON COLUMN public.account_locations.production_weekdays IS
  'Per-location override of accounts.production_weekdays. NULL means inherit from the parent account. JS getDay() convention: 0=Sun..6=Sat.';
