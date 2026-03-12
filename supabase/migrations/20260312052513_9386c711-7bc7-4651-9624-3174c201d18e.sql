
-- Add region and num_bags columns to green_samples
ALTER TABLE public.green_samples ADD COLUMN region text;
ALTER TABLE public.green_samples ADD COLUMN num_bags integer;

-- Create green_sample_notes table
CREATE TABLE public.green_sample_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES public.green_samples(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.green_sample_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_sample_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage green_sample_notes"
  ON public.green_sample_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon green_sample_notes"
  ON public.green_sample_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- Revoke public/anon
REVOKE ALL ON public.green_sample_notes FROM anon;
REVOKE ALL ON public.green_sample_notes FROM public;
GRANT ALL ON public.green_sample_notes TO authenticated;

-- Index
CREATE INDEX idx_green_sample_notes_sample_id ON public.green_sample_notes(sample_id);
