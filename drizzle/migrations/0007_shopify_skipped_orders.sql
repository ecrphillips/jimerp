CREATE TABLE public.shopify_skipped_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.shopify_sources(id) ON DELETE CASCADE,
  shopify_order_id text NOT NULL,
  shopify_order_number text,
  customer_name text,
  shopify_created_at timestamptz,
  line_items jsonb,
  skipped_by uuid,
  skipped_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, shopify_order_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_skipped_orders TO authenticated;
GRANT ALL ON public.shopify_skipped_orders TO service_role;
ALTER TABLE public.shopify_skipped_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage skipped shopify orders" ON public.shopify_skipped_orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));