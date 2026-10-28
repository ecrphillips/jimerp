CREATE TABLE public.production_day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ROAST','SHIP')),
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  forced boolean NOT NULL DEFAULT false,
  reopened_at timestamptz,
  reopened_by uuid
);
CREATE INDEX production_day_closes_date_idx ON public.production_day_closes(work_date, kind);
GRANT SELECT, INSERT, UPDATE ON public.production_day_closes TO authenticated;
GRANT ALL ON public.production_day_closes TO service_role;
ALTER TABLE public.production_day_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read day closes" ON public.production_day_closes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS'));
CREATE POLICY "Staff insert day closes" ON public.production_day_closes FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS')) AND closed_by = auth.uid());
CREATE POLICY "Staff reopen day closes" ON public.production_day_closes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS'))
  WITH CHECK (public.has_role(auth.uid(),'ADMIN') OR public.has_role(auth.uid(),'OPS'));