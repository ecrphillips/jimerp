
-- green_vendor_notes table
CREATE TABLE public.green_vendor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.green_vendors(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.green_vendor_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_vendor_notes FORCE ROW LEVEL SECURITY;

-- Revoke anon/public
REVOKE ALL ON public.green_vendor_notes FROM anon;
REVOKE ALL ON public.green_vendor_notes FROM public;

-- Admin/Ops policy
CREATE POLICY "Admin/Ops can manage green_vendor_notes"
  ON public.green_vendor_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Deny anon
CREATE POLICY "Deny anon green_vendor_notes"
  ON public.green_vendor_notes FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Index
CREATE INDEX idx_green_vendor_notes_vendor_id ON public.green_vendor_notes(vendor_id);
