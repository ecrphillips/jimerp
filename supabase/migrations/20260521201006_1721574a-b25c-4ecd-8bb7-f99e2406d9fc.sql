-- Market Price Audit: competitor retail-price scan storage + RPCs
CREATE TABLE public.market_price_audit_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        date NOT NULL,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  source_filename text,
  notes           text,
  is_published    boolean NOT NULL DEFAULT false,
  UNIQUE (run_date)
);

CREATE INDEX idx_market_price_audit_runs_published
  ON public.market_price_audit_runs (is_published, run_date DESC);

CREATE TABLE public.market_price_audit_rows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.market_price_audit_runs(id) ON DELETE CASCADE,
  brand            text NOT NULL,
  product_name     text NOT NULL,
  product_url      text,
  bag_size_g       integer,
  price_cad        numeric(10,2),
  price_per_g_cad  numeric(10,5),
  status           text NOT NULL DEFAULT 'ok',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_price_audit_rows_run ON public.market_price_audit_rows (run_id);
CREATE INDEX idx_market_price_audit_rows_ppg ON public.market_price_audit_rows (price_per_g_cad);

ALTER TABLE public.market_price_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_price_audit_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_price_audit_runs_admin_all ON public.market_price_audit_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY market_price_audit_runs_read_published ON public.market_price_audit_runs
  FOR SELECT TO authenticated
  USING (is_published = true);

CREATE POLICY market_price_audit_rows_admin_all ON public.market_price_audit_rows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY market_price_audit_rows_read_published ON public.market_price_audit_rows
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.market_price_audit_runs r
    WHERE r.id = market_price_audit_rows.run_id
      AND r.is_published = true
  ));

CREATE OR REPLACE FUNCTION public.import_market_price_audit(
  _run_date date,
  _source_filename text,
  _notes text,
  _rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_existing public.market_price_audit_runs%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF _run_date IS NULL THEN
    RAISE EXCEPTION 'run_date required';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'rows must be a non-empty array';
  END IF;

  SELECT * INTO v_existing FROM public.market_price_audit_runs WHERE run_date = _run_date;
  IF FOUND THEN
    IF v_existing.is_published THEN
      RAISE EXCEPTION 'A published run already exists for %, unpublish it first', _run_date;
    END IF;
    DELETE FROM public.market_price_audit_runs WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.market_price_audit_runs (run_date, uploaded_by, source_filename, notes)
  VALUES (_run_date, auth.uid(), _source_filename, _notes)
  RETURNING id INTO v_run_id;

  INSERT INTO public.market_price_audit_rows
    (run_id, brand, product_name, product_url, bag_size_g, price_cad, price_per_g_cad, status, notes)
  SELECT
    v_run_id,
    NULLIF(trim(elem->>'brand'), ''),
    NULLIF(trim(elem->>'product_name'), ''),
    NULLIF(trim(elem->>'product_url'), ''),
    NULLIF(elem->>'bag_size_g','')::int,
    NULLIF(elem->>'price_cad','')::numeric(10,2),
    NULLIF(elem->>'price_per_g_cad','')::numeric(10,5),
    COALESCE(NULLIF(trim(elem->>'status'), ''), 'ok'),
    NULLIF(trim(elem->>'notes'), '')
  FROM jsonb_array_elements(_rows) AS elem;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_market_price_audit(_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.market_price_audit_runs SET is_published = false WHERE is_published = true AND id <> _run_id;
  UPDATE public.market_price_audit_runs SET is_published = true  WHERE id = _run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_market_price_audit(_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  UPDATE public.market_price_audit_runs SET is_published = false WHERE id = _run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_market_price_audit(_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_published boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  SELECT is_published INTO v_published FROM public.market_price_audit_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found';
  END IF;
  IF v_published THEN
    RAISE EXCEPTION 'Cannot delete a published run, unpublish first';
  END IF;
  DELETE FROM public.market_price_audit_runs WHERE id = _run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_market_price_audit(date, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_market_price_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_market_price_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_market_price_audit(uuid) TO authenticated;