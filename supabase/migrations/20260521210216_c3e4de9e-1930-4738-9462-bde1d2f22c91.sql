-- order_shipments
CREATE TABLE IF NOT EXISTS public.order_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  shipment_number integer NOT NULL DEFAULT 1,
  delivery_method public.delivery_method,
  location_id uuid REFERENCES public.client_locations(id) ON DELETE SET NULL,
  ship_to_name text,
  ship_to_address_line1 text,
  ship_to_address_line2 text,
  ship_to_city text,
  ship_to_province text,
  ship_to_postal_code text,
  ship_to_country text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, shipment_number)
);

CREATE INDEX IF NOT EXISTS idx_order_shipments_order_id ON public.order_shipments(order_id);

ALTER TABLE public.order_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View shipments for visible orders" ON public.order_shipments;
CREATE POLICY "View shipments for visible orders"
  ON public.order_shipments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_shipments.order_id
      AND (
        public.has_role(auth.uid(), 'ADMIN')
        OR public.has_role(auth.uid(), 'OPS')
        OR EXISTS (
          SELECT 1 FROM public.account_users au
          WHERE au.account_id = o.account_id
            AND au.user_id = auth.uid()
            AND au.is_active = true
        )
      )
  ));

DROP POLICY IF EXISTS "Admin/OPS manage shipments" ON public.order_shipments;
CREATE POLICY "Admin/OPS manage shipments"
  ON public.order_shipments FOR ALL
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

DROP POLICY IF EXISTS "Clients manage own order shipments" ON public.order_shipments;
CREATE POLICY "Clients manage own order shipments"
  ON public.order_shipments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_shipments.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

DROP TRIGGER IF EXISTS trg_order_shipments_updated_at ON public.order_shipments;
CREATE TRIGGER trg_order_shipments_updated_at
  BEFORE UPDATE ON public.order_shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- order_line_items.shipment_id
ALTER TABLE public.order_line_items
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.order_shipments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_line_items_shipment_id ON public.order_line_items(shipment_id);

-- Backfill: one shipment per existing order
INSERT INTO public.order_shipments (order_id, shipment_number, delivery_method, ship_to_name, ship_to_address_line1)
SELECT o.id, 1, o.delivery_method,
       COALESCE(a.account_name, c.name),
       c.shipping_address
FROM public.orders o
LEFT JOIN public.accounts a ON a.id = o.account_id
LEFT JOIN public.clients c ON c.id = o.client_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.order_shipments s WHERE s.order_id = o.id AND s.shipment_number = 1
);

-- Link line items to the default shipment
UPDATE public.order_line_items oli
SET shipment_id = s.id
FROM public.order_shipments s
WHERE s.order_id = oli.order_id
  AND s.shipment_number = 1
  AND oli.shipment_id IS NULL;
