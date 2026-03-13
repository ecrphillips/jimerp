CREATE TABLE public.roast_group_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE CASCADE,
  note_text text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roast_group_notes_roast_group ON public.roast_group_notes(roast_group);

ALTER TABLE public.roast_group_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage roast_group_notes"
  ON public.roast_group_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon roast_group_notes"
  ON public.roast_group_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);