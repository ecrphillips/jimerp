CREATE TABLE public.order_extra_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_extra_lines_order_idx ON public.order_extra_lines(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_extra_lines TO authenticated;
GRANT ALL ON public.order_extra_lines TO service_role;
ALTER TABLE public.order_extra_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage order extra lines" ON public.order_extra_lines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));