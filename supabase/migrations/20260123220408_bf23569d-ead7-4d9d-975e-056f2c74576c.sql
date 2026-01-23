-- Create event_type enum for exception events
CREATE TYPE public.exception_event_type AS ENUM (
  'DESTONER_SPILL',
  'BIN_MIX_SAME',
  'BIN_MIX_DIFFERENT',
  'WIP_ADJUSTMENT',
  'DECONSTRUCT',
  'OTHER'
);

-- Create entry_type enum for WIP ledger
CREATE TYPE public.wip_entry_type AS ENUM (
  'ROAST_OUTPUT',
  'PACK_CONSUME',
  'LOSS',
  'ADJUSTMENT',
  'REALLOCATE_IN',
  'REALLOCATE_OUT',
  'DECONSTRUCT_IN',
  'DECONSTRUCT_OUT'
);

-- Create roast_exception_events table
CREATE TABLE public.roast_exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  target_date date NOT NULL,
  roast_group text NOT NULL,
  batch_id uuid REFERENCES public.roasted_batches(id) ON DELETE SET NULL,
  event_type public.exception_event_type NOT NULL,
  delta_wip_kg numeric NOT NULL DEFAULT 0,
  delta_output_kg numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Enable RLS on roast_exception_events
ALTER TABLE public.roast_exception_events ENABLE ROW LEVEL SECURITY;

-- RLS policy for roast_exception_events
CREATE POLICY "Admin/Ops can manage roast exception events"
  ON public.roast_exception_events
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create wip_ledger table
CREATE TABLE public.wip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  target_date date NOT NULL,
  roast_group text NOT NULL,
  entry_type public.wip_entry_type NOT NULL,
  delta_kg numeric NOT NULL,
  related_batch_id uuid REFERENCES public.roasted_batches(id) ON DELETE SET NULL,
  related_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Enable RLS on wip_ledger
ALTER TABLE public.wip_ledger ENABLE ROW LEVEL SECURITY;

-- RLS policy for wip_ledger
CREATE POLICY "Admin/Ops can manage wip ledger"
  ON public.wip_ledger
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Index for efficient queries on wip_ledger
CREATE INDEX idx_wip_ledger_roast_group_date ON public.wip_ledger(roast_group, target_date);
CREATE INDEX idx_wip_ledger_related_batch ON public.wip_ledger(related_batch_id);
CREATE INDEX idx_wip_ledger_related_product ON public.wip_ledger(related_product_id);

-- Index for efficient queries on roast_exception_events
CREATE INDEX idx_roast_exception_events_date ON public.roast_exception_events(target_date);
CREATE INDEX idx_roast_exception_events_batch ON public.roast_exception_events(batch_id);