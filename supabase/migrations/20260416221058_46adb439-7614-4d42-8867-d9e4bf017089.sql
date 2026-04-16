-- 1. Sourcing sequences table for atomic PO and lot number generation
CREATE TABLE IF NOT EXISTS public.sourcing_sequences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  next_val integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sourcing_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage sourcing_sequences"
  ON public.sourcing_sequences
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon sourcing_sequences"
  ON public.sourcing_sequences
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Seed sequences
INSERT INTO public.sourcing_sequences (key, next_val) VALUES
  ('po_sequence', 1),
  ('lot_sequence', 1)
ON CONFLICT (key) DO NOTHING;

-- 2. Add po_number to green_purchases
ALTER TABLE public.green_purchases ADD COLUMN IF NOT EXISTS po_number text;

-- 3. Add po_number to green_releases
ALTER TABLE public.green_releases ADD COLUMN IF NOT EXISTS po_number text;

-- 4. green_lots.lot_number already exists (NOT NULL). No change needed for column itself.

-- Atomic sequence allocator: returns and reserves N consecutive values for a key
CREATE OR REPLACE FUNCTION public.allocate_sourcing_sequence(_key text, _count integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start integer;
BEGIN
  IF _count < 1 THEN
    _count := 1;
  END IF;

  UPDATE public.sourcing_sequences
    SET next_val = next_val + _count,
        updated_at = now()
    WHERE key = _key
    RETURNING next_val - _count INTO _start;

  IF _start IS NULL THEN
    INSERT INTO public.sourcing_sequences (key, next_val)
      VALUES (_key, 1 + _count)
      RETURNING 1 INTO _start;
  END IF;

  RETURN _start;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_sourcing_sequence(text, integer) TO authenticated;