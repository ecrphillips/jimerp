
-- ============================================================
-- CO-ROASTING MODULE SCHEMA
-- ============================================================

-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.coroast_tier AS ENUM ('ACCESS', 'GROWTH');

CREATE TYPE public.coroast_booking_status AS ENUM (
  'CONFIRMED',
  'CANCELLED_CHARGED',
  'CANCELLED_WAIVED',
  'CANCELLED_FREE',
  'COMPLETED',
  'NO_SHOW'
);

CREATE TYPE public.coroast_loring_block_type AS ENUM (
  'INTERNAL_PRODUCTION',
  'MAINTENANCE',
  'CLOSED',
  'OTHER'
);

CREATE TYPE public.coroast_ledger_entry_type AS ENUM (
  'BOOKING_CONFIRMED',
  'BOOKING_RETURNED',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT'
);

CREATE TYPE public.coroast_recurring_day AS ENUM (
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'
);

-- =========================
-- TABLE 1: coroast_members
-- =========================
CREATE TABLE public.coroast_members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         text NOT NULL,
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  tier                  coroast_tier NOT NULL DEFAULT 'ACCESS',
  is_active             boolean NOT NULL DEFAULT true,
  joined_date           date NOT NULL DEFAULT CURRENT_DATE,
  notes_internal        text,
  certified             boolean NOT NULL DEFAULT false,
  certified_date        date,
  certified_by          uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- TABLE 2: coroast_billing_periods
-- =========================
CREATE TABLE public.coroast_billing_periods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES coroast_members(id) ON DELETE CASCADE,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  tier_snapshot         coroast_tier NOT NULL,
  included_hours        numeric NOT NULL,
  overage_rate_per_hr   numeric NOT NULL,
  base_fee              numeric NOT NULL,
  exceeded_6hrs         boolean NOT NULL DEFAULT false,
  upgrade_nudge_sent    boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, period_start),
  CONSTRAINT period_start_is_first CHECK (EXTRACT(DAY FROM period_start) = 1)
);

CREATE INDEX idx_coroast_billing_member ON public.coroast_billing_periods (member_id);

-- =========================
-- TABLE 3: coroast_loring_blocks
-- =========================
CREATE TABLE public.coroast_loring_blocks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date            date NOT NULL,
  start_time            time NOT NULL,
  end_time              time NOT NULL,
  block_type            coroast_loring_block_type NOT NULL DEFAULT 'INTERNAL_PRODUCTION',
  notes                 text,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loring_block_no_time_inversion CHECK (end_time > start_time)
);

CREATE INDEX idx_loring_blocks_date ON public.coroast_loring_blocks (block_date);

-- =========================
-- TABLE 4: coroast_bookings
-- =========================
CREATE TABLE public.coroast_bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES coroast_members(id) ON DELETE RESTRICT,
  billing_period_id     uuid NOT NULL REFERENCES coroast_billing_periods(id),
  booking_date          date NOT NULL,
  start_time            time NOT NULL,
  end_time              time NOT NULL,
  duration_hours        numeric GENERATED ALWAYS AS
                          (EXTRACT(EPOCH FROM (end_time - start_time)) / 3600) STORED,
  is_prime_time         boolean NOT NULL DEFAULT false,
  recurring_block_id    uuid,
  status                coroast_booking_status NOT NULL DEFAULT 'CONFIRMED',
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES auth.users(id),
  cancellation_fee_amt  numeric,
  cancellation_waived   boolean NOT NULL DEFAULT false,
  waive_reason          text,
  reminder_sent_at      timestamptz,
  notes_member          text,
  notes_internal        text,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_no_time_inversion CHECK (end_time > start_time)
);

CREATE INDEX idx_coroast_bookings_date ON public.coroast_bookings (booking_date);
CREATE INDEX idx_coroast_bookings_member ON public.coroast_bookings (member_id);
CREATE INDEX idx_coroast_bookings_period ON public.coroast_bookings (billing_period_id);
CREATE INDEX idx_coroast_bookings_reminder ON public.coroast_bookings (booking_date)
  WHERE reminder_sent_at IS NULL AND status = 'CONFIRMED';

-- =========================
-- TABLE 5: coroast_recurring_blocks
-- =========================
CREATE TABLE public.coroast_recurring_blocks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES coroast_members(id) ON DELETE CASCADE,
  day_of_week           coroast_recurring_day NOT NULL,
  start_time            time NOT NULL,
  end_time              time NOT NULL,
  effective_from        date NOT NULL,
  effective_until       date,
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_no_time_inversion CHECK (end_time > start_time)
);

ALTER TABLE public.coroast_bookings
  ADD CONSTRAINT coroast_bookings_recurring_block_fkey
  FOREIGN KEY (recurring_block_id)
  REFERENCES coroast_recurring_blocks(id)
  ON DELETE SET NULL;

CREATE INDEX idx_coroast_recurring_member ON public.coroast_recurring_blocks (member_id);

-- =========================
-- TABLE 6: coroast_hour_ledger
-- =========================
CREATE TABLE public.coroast_hour_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_period_id     uuid NOT NULL REFERENCES coroast_billing_periods(id),
  member_id             uuid NOT NULL REFERENCES coroast_members(id),
  booking_id            uuid REFERENCES coroast_bookings(id) ON DELETE SET NULL,
  entry_type            coroast_ledger_entry_type NOT NULL,
  hours_delta           numeric NOT NULL,
  notes                 text NOT NULL DEFAULT '',
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coroast_ledger_period ON public.coroast_hour_ledger (billing_period_id);
CREATE INDEX idx_coroast_ledger_member ON public.coroast_hour_ledger (member_id);

-- =========================
-- TABLE 7: coroast_storage_allocations
-- =========================
CREATE TABLE public.coroast_storage_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES coroast_members(id) ON DELETE CASCADE,
  billing_period_id     uuid NOT NULL REFERENCES coroast_billing_periods(id),
  included_pallets      integer NOT NULL DEFAULT 0,
  paid_pallets          integer NOT NULL DEFAULT 0,
  pallets_in_use        integer NOT NULL DEFAULT 0,
  rate_per_add_pallet   numeric NOT NULL,
  release_requested     boolean NOT NULL DEFAULT false,
  release_notes         text,
  updated_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, billing_period_id)
);

CREATE INDEX idx_coroast_storage_member ON public.coroast_storage_allocations (member_id);
CREATE INDEX idx_coroast_storage_period ON public.coroast_storage_allocations (billing_period_id);

-- =========================
-- TABLE 8: coroast_waiver_log
-- =========================
CREATE TABLE public.coroast_waiver_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES coroast_members(id) ON DELETE CASCADE,
  booking_id            uuid NOT NULL REFERENCES coroast_bookings(id) ON DELETE CASCADE,
  fee_amount_waived     numeric NOT NULL,
  waive_reason          text,
  waived_by             uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coroast_waiver_member ON public.coroast_waiver_log (member_id);

-- =========================
-- RLS: Enable on all new tables
-- =========================
ALTER TABLE public.coroast_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_loring_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_recurring_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_hour_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_storage_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_waiver_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.coroast_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_billing_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_loring_blocks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_recurring_blocks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_hour_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_storage_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_waiver_log FORCE ROW LEVEL SECURITY;

-- RLS policies: Admin/Ops full access, deny anonymous
CREATE POLICY "Admin/Ops can manage coroast_members" ON public.coroast_members FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_members" ON public.coroast_members FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_billing_periods" ON public.coroast_billing_periods FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_billing_periods" ON public.coroast_billing_periods FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_loring_blocks" ON public.coroast_loring_blocks FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_loring_blocks" ON public.coroast_loring_blocks FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_bookings" ON public.coroast_bookings FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_bookings" ON public.coroast_bookings FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_recurring_blocks" ON public.coroast_recurring_blocks FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_recurring_blocks" ON public.coroast_recurring_blocks FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_hour_ledger" ON public.coroast_hour_ledger FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_hour_ledger" ON public.coroast_hour_ledger FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_storage_allocations" ON public.coroast_storage_allocations FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_storage_allocations" ON public.coroast_storage_allocations FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage coroast_waiver_log" ON public.coroast_waiver_log FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS')) WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));
CREATE POLICY "Deny anon coroast_waiver_log" ON public.coroast_waiver_log FOR ALL TO anon USING (false) WITH CHECK (false);
