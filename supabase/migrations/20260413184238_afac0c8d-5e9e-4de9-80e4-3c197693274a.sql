
-- Enable RLS
ALTER TABLE public.green_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_purchase_lines ENABLE ROW LEVEL SECURITY;

-- green_purchases policies
CREATE POLICY "Admin/OPS full access on green_purchases"
  ON public.green_purchases
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- green_purchase_lines policies
CREATE POLICY "Admin/OPS full access on green_purchase_lines"
  ON public.green_purchase_lines
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));
