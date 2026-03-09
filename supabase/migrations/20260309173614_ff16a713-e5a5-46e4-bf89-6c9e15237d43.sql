
-- Prospect stage enum
CREATE TYPE public.prospect_stage AS ENUM ('AWARE', 'CONTACTED', 'CONVERSATION', 'AGREEMENT_SENT', 'ONBOARDED');

-- Client notes (Account Notes for existing clients)
CREATE TABLE public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  follow_up_by date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_notes_client_id ON public.client_notes(client_id);
CREATE INDEX idx_client_notes_created_at ON public.client_notes(created_at DESC);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes FORCE ROW LEVEL SECURITY;

-- Deny anon
CREATE POLICY "Deny anonymous access to client_notes"
  ON public.client_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- Admin/Ops full access
CREATE POLICY "Admin/Ops can manage client notes"
  ON public.client_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Prospects table
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  contact_name text,
  contact_info text,
  stage prospect_stage NOT NULL DEFAULT 'AWARE',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospects_updated_at ON public.prospects(updated_at DESC);

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects FORCE ROW LEVEL SECURITY;

CREATE POLICY "Deny anonymous access to prospects"
  ON public.prospects FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage prospects"
  ON public.prospects FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Prospect notes
CREATE TABLE public.prospect_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  follow_up_by date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_notes_prospect_id ON public.prospect_notes(prospect_id);
CREATE INDEX idx_prospect_notes_created_at ON public.prospect_notes(created_at DESC);

ALTER TABLE public.prospect_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY "Deny anonymous access to prospect_notes"
  ON public.prospect_notes FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage prospect notes"
  ON public.prospect_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'))
  WITH CHECK (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Updated_at trigger for prospects
CREATE TRIGGER update_prospects_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
