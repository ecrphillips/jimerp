
-- Certification checklist items per member
CREATE TABLE public.coroast_member_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.coroast_members(id) ON DELETE CASCADE,
  item_number integer NOT NULL CHECK (item_number BETWEEN 1 AND 7),
  completed boolean NOT NULL DEFAULT false,
  completed_date date,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, item_number)
);

-- Member notes (append-only)
CREATE TABLE public.coroast_member_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.coroast_members(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

-- Enable RLS
ALTER TABLE public.coroast_member_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_member_checklist FORCE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_member_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_member_notes FORCE ROW LEVEL SECURITY;

-- RLS policies for checklist
CREATE POLICY "Admin/Ops can manage coroast_member_checklist"
  ON public.coroast_member_checklist FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon coroast_member_checklist"
  ON public.coroast_member_checklist FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- RLS policies for notes
CREATE POLICY "Admin/Ops can manage coroast_member_notes"
  ON public.coroast_member_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon coroast_member_notes"
  ON public.coroast_member_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);
