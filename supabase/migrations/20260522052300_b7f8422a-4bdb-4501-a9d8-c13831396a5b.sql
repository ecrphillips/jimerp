CREATE EXTENSION IF NOT EXISTS pg_cron;

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

SELECT public.sweep_past_bookings_to_completed();

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