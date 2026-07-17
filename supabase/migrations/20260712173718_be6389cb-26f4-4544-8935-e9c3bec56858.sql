ALTER TABLE public.coroast_bookings DROP COLUMN IF EXISTS member_id;
ALTER TABLE public.coroast_hour_ledger DROP COLUMN IF EXISTS member_id;
ALTER TABLE public.coroast_waiver_log DROP COLUMN IF EXISTS member_id;