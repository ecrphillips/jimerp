-- Auto-complete past confirmed co-roast bookings.
--
-- Rationale: previously, a past CONFIRMED booking sat indefinitely with
-- "Mark as No-Show" as the only resolution action — backwards for the common
-- case where the member actually showed up. We now assume a past booking was
-- completed, and NO_SHOW becomes the explicit exception (already supported by
-- BookingDetailModal.noShowMutation).
--
-- This migration:
--   1. Defines public.sweep_past_bookings_to_completed() — flips CONFIRMED
--      bookings whose (booking_date + end_time) is in the past (interpreted
--      in the business timezone, America/Vancouver) to COMPLETED.
--   2. Runs it once as a backfill.
--   3. Schedules it hourly via pg_cron.

CREATE OR REPLACE FUNCTION public.sweep_past_bookings_to_completed()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.coroast_bookings
     SET status = 'COMPLETED'
   WHERE status = 'CONFIRMED'
     AND ((booking_date::text || ' ' || end_time::text)::timestamp
            AT TIME ZONE 'America/Vancouver') < now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_past_bookings_to_completed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_past_bookings_to_completed() TO service_role;

-- One-time backfill so existing past CONFIRMED bookings flip immediately.
SELECT public.sweep_past_bookings_to_completed();

-- Hourly sweep. Idempotent — unschedule any prior job of the same name first.
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-past-bookings-to-completed');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sweep-past-bookings-to-completed',
  '0 * * * *',
  $cron$SELECT public.sweep_past_bookings_to_completed();$cron$
);
