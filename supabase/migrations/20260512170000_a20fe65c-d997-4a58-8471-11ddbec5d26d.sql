-- Member-portal calendar: redacted busy-slot reader for the shared Loring roaster.
--
-- The SELECT policy on coroast_bookings is account-scoped, so a member can only
-- see their own bookings. That hides other members' bookings from the member-portal
-- calendar, which then lets the user open the booking dialog over an occupied slot
-- and only fails on the SECURITY DEFINER create_member_booking RPC (which bypasses
-- RLS and sees all bookings). The spec calls for other-member bookings to render
-- as grey "Unavailable" blocks with no identifying info.
--
-- This RPC returns only (booking_date, start_time, end_time) for active bookings
-- that do NOT belong to the caller's account(s), gated to active COROASTING
-- members. Mirrors the global-read pattern used by coroast_loring_blocks without
-- broadening direct SELECT on the underlying table.

CREATE OR REPLACE FUNCTION public.get_coroast_busy_slots(
  p_from date,
  p_to   date
)
RETURNS TABLE (booking_date date, start_time time, end_time time)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_users au
    JOIN public.accounts a ON a.id = au.account_id
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND 'COROASTING' = ANY(a.programs)
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cb.booking_date, cb.start_time, cb.end_time
  FROM public.coroast_bookings cb
  WHERE cb.booking_date BETWEEN p_from AND p_to
    AND cb.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
    AND NOT EXISTS (
      SELECT 1 FROM public.account_users au2
      WHERE au2.account_id = cb.account_id
        AND au2.user_id = auth.uid()
        AND au2.is_active = true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_coroast_busy_slots(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coroast_busy_slots(date, date) TO authenticated;
