-- Per-account standard production days + order-entry cutoff.
--
-- production_weekdays: weekday numbers a client's coffee is produced on,
--   using JS getDay() convention (0=Sun, 1=Mon, … 6=Sat) to match the
--   front-end date-fns helpers. NULL/empty = no standard schedule, callers
--   fall back to the generic next-business-day behaviour.
-- order_cutoff_hour: local-time (America/Vancouver) hour that doubles as both
--   the same-day order-entry cutoff and the deadline time-of-day. Default 12
--   (noon): an order entered before noon on a production day is due that day at
--   noon; otherwise it rolls to the next production day at noon.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS production_weekdays smallint[],
  ADD COLUMN IF NOT EXISTS order_cutoff_hour smallint NOT NULL DEFAULT 12;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_order_cutoff_hour_range
    CHECK (order_cutoff_hour >= 0 AND order_cutoff_hour <= 23);

COMMENT ON COLUMN public.accounts.production_weekdays IS
  'Standard production weekdays (JS getDay: 0=Sun..6=Sat). Drives default order work deadline.';
COMMENT ON COLUMN public.accounts.order_cutoff_hour IS
  'Local Vancouver hour used as same-day order-entry cutoff and deadline time-of-day. Default 12 (noon).';
