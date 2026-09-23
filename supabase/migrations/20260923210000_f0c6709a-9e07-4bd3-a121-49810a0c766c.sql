-- Co-roasting: bookable facility layers (Cupping Lab, Sample Roaster).
--
-- Deliberately separate from coroast_bookings / coroast_loring_blocks:
--   * No billing period, no hour-ledger writes — these resources are free for now.
--   * Each resource is fully independent: a lab booking never blocks the sample
--     roaster or the Loring, and vice versa. Loring blocks do not apply here.
--   * Billing, dashboards and reports that read coroast_bookings are untouched.
--
-- Rules are intentionally looser than the Loring (the goal is avoiding double
-- booking, not rationing hours): future only, within the shared Loring availability
-- windows, >= 30 min, <= 13 weeks ahead, cancel any time before start.
--
-- Double booking is prevented at the DB level by a trigger that serialises writes
-- per (resource, date) with an advisory lock, so it holds for admin direct inserts
-- and concurrent member RPC calls alike.

CREATE TYPE public.coroast_facility_resource AS ENUM ('CUPPING_LAB', 'SAMPLE_ROASTER');

-- ── Tables ────────────────────────────────────────────────────────────────────
CREATE TABLE public.coroast_facility_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  resource       public.coroast_facility_resource NOT NULL,
  booking_date   date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  status         text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  notes_member   text,
  notes_internal text,
  created_by     uuid REFERENCES auth.users(id),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_coroast_facility_bookings_date ON public.coroast_facility_bookings (resource, booking_date);
CREATE INDEX idx_coroast_facility_bookings_account ON public.coroast_facility_bookings (account_id);

CREATE TABLE public.coroast_facility_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource    public.coroast_facility_resource NOT NULL,
  block_date  date NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  block_type  public.coroast_loring_block_type NOT NULL DEFAULT 'OTHER',
  notes       text,
  recurring_series_id uuid,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_coroast_facility_blocks_date ON public.coroast_facility_blocks (resource, block_date);

-- ── Overlap guard (per resource) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._coroast_facility_booking_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('coroast_facility:' || NEW.resource::text || ':' || NEW.booking_date::text));

  IF EXISTS (
    SELECT 1 FROM public.coroast_facility_bookings fb
    WHERE fb.resource = NEW.resource
      AND fb.booking_date = NEW.booking_date
      AND fb.status = 'CONFIRMED'
      AND fb.id <> NEW.id
      AND fb.start_time < NEW.end_time
      AND fb.end_time   > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an existing booking' USING ERRCODE = '23P01';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coroast_facility_blocks b
    WHERE b.resource = NEW.resource
      AND b.block_date = NEW.booking_date
      AND b.start_time < NEW.end_time
      AND b.end_time   > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an unavailability block' USING ERRCODE = '23P01';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coroast_facility_booking_overlap
  BEFORE INSERT OR UPDATE ON public.coroast_facility_bookings
  FOR EACH ROW EXECUTE FUNCTION public._coroast_facility_booking_overlap_guard();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.coroast_facility_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_facility_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage coroast_facility_bookings"
  ON public.coroast_facility_bookings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Members read only their own account's bookings; other members' bookings are
-- surfaced redacted via get_coroast_facility_busy_slots. Writes go through RPCs.
CREATE POLICY "Account members can read their coroast_facility_bookings"
  ON public.coroast_facility_bookings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = coroast_facility_bookings.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

CREATE POLICY "Deny anon coroast_facility_bookings"
  ON public.coroast_facility_bookings FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_facility_blocks"
  ON public.coroast_facility_blocks FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

CREATE POLICY "Active co-roasting members can read coroast_facility_blocks"
  ON public.coroast_facility_blocks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    JOIN public.accounts a ON a.id = au.account_id
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND 'COROASTING' = ANY(a.programs)
  ));

CREATE POLICY "Deny anon coroast_facility_blocks"
  ON public.coroast_facility_blocks FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- ── Redacted busy-slot reader (mirrors get_coroast_busy_slots) ────────────────
CREATE OR REPLACE FUNCTION public.get_coroast_facility_busy_slots(p_from date, p_to date)
RETURNS TABLE (resource public.coroast_facility_resource, booking_date date, start_time time, end_time time)
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
  SELECT fb.resource, fb.booking_date, fb.start_time, fb.end_time
  FROM public.coroast_facility_bookings fb
  WHERE fb.booking_date BETWEEN p_from AND p_to
    AND fb.status = 'CONFIRMED'
    AND NOT EXISTS (
      SELECT 1 FROM public.account_users au2
      WHERE au2.account_id = fb.account_id
        AND au2.user_id = auth.uid()
        AND au2.is_active = true
    );
END;
$$;

-- ── Member create ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_member_facility_booking(
  p_account_id   uuid,
  p_resource     public.coroast_facility_resource,
  p_booking_date date,
  p_start_time   time,
  p_end_time     time,
  p_notes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Vancouver')::date;
  v_dow text := (ARRAY['SUN','MON','TUE','WED','THU','FRI','SAT'])[EXTRACT(DOW FROM p_booking_date)::int + 1];
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;

  IF (p_booking_date + p_start_time) AT TIME ZONE 'America/Vancouver' <= now() THEN
    RAISE EXCEPTION 'Cannot book a time in the past';
  END IF;

  IF p_booking_date > v_today + 91 THEN
    RAISE EXCEPTION 'Booking date is beyond the 13 week booking horizon';
  END IF;

  IF p_end_time - p_start_time < interval '30 minutes' THEN
    RAISE EXCEPTION 'Booking is shorter than the 30 minute minimum';
  END IF;

  -- Same opening hours as the Loring. Matches the UI: if no windows are
  -- configured at all, hours are unrestricted.
  IF EXISTS (SELECT 1 FROM public.coroast_availability_windows)
     AND NOT EXISTS (
       SELECT 1 FROM public.coroast_availability_windows w
       WHERE w.day_of_week = v_dow
         AND w.is_active
         AND w.open_time  <= p_start_time
         AND w.close_time >= p_end_time
     ) THEN
    RAISE EXCEPTION 'Booking is outside facility opening hours';
  END IF;

  -- Overlap with bookings/blocks on the same resource is enforced by trigger.
  INSERT INTO public.coroast_facility_bookings (
    account_id, resource, booking_date, start_time, end_time, notes_member, status, created_by
  ) VALUES (
    p_account_id, p_resource, p_booking_date, p_start_time, p_end_time,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'CONFIRMED', auth.uid()
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

-- ── Member cancel ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_member_facility_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.coroast_facility_bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.coroast_facility_bookings WHERE id = p_booking_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  PERFORM public._assert_active_coroast_member(v_row.account_id);

  IF v_row.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Booking is not cancellable';
  END IF;

  IF (v_row.booking_date + v_row.start_time) AT TIME ZONE 'America/Vancouver' <= now() THEN
    RAISE EXCEPTION 'Cannot cancel a booking that has already started';
  END IF;

  UPDATE public.coroast_facility_bookings
     SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), updated_at = now()
   WHERE id = p_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public._coroast_facility_booking_overlap_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_coroast_facility_busy_slots(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_member_facility_booking(uuid, public.coroast_facility_resource, date, time, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_member_facility_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coroast_facility_busy_slots(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_facility_booking(uuid, public.coroast_facility_resource, date, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_facility_booking(uuid) TO authenticated;
