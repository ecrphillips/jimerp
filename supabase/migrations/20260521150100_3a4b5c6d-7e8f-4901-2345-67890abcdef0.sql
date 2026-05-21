-- Multi ship-to per order
-- Adds order_shipments grouping line items by destination. Backfills every
-- existing order with a single shipment derived from orders.delivery_method
-- and the parent client's shipping_address.

-- 1. Table --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_shipments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  shipment_number  INT NOT NULL,
  delivery_method  public.delivery_method NOT NULL DEFAULT 'PICKUP',
  location_id      UUID NULL REFERENCES public.client_locations(id) ON DELETE SET NULL,
  ship_to_name             TEXT NULL,
  ship_to_address_line1    TEXT NULL,
  ship_to_address_line2    TEXT NULL,
  ship_to_city             TEXT NULL,
  ship_to_region           TEXT NULL,
  ship_to_postal           TEXT NULL,
  ship_to_country          TEXT NOT NULL DEFAULT 'CA',
  contact_name             TEXT NULL,
  contact_phone            TEXT NULL,
  contact_email            TEXT NULL,
  notes                    TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, shipment_number)
);

CREATE INDEX IF NOT EXISTS order_shipments_order_idx
  ON public.order_shipments (order_id);

ALTER TABLE public.order_shipments ENABLE ROW LEVEL SECURITY;

-- RLS: mirror parent orders' visibility.
CREATE POLICY "Admin/Ops manage order_shipments"
  ON public.order_shipments
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Clients select own order_shipments"
  ON public.order_shipments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_shipments.order_id
      AND (
        EXISTS (
          SELECT 1 FROM public.account_users au
          WHERE au.account_id = o.account_id
            AND au.user_id = auth.uid()
            AND au.is_active = true
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = 'CLIENT'::app_role
            AND ur.client_id = o.client_id
        )
      )
  ));

CREATE POLICY "Clients insert own order_shipments"
  ON public.order_shipments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_shipments.order_id
      AND (
        EXISTS (
          SELECT 1 FROM public.account_users au
          WHERE au.account_id = o.account_id
            AND au.user_id = auth.uid()
            AND au.is_active = true
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = 'CLIENT'::app_role
            AND ur.client_id = o.client_id
        )
      )
  ));

CREATE POLICY "Clients update own order_shipments"
  ON public.order_shipments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_shipments.order_id
      AND o.status IN ('DRAFT'::order_status, 'SUBMITTED'::order_status)
      AND EXISTS (
        SELECT 1 FROM public.account_users au
        WHERE au.account_id = o.account_id
          AND au.user_id = auth.uid()
          AND au.is_active = true
      )
  ));

CREATE POLICY "Clients delete own order_shipments"
  ON public.order_shipments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_shipments.order_id
      AND o.status IN ('DRAFT'::order_status, 'SUBMITTED'::order_status)
      AND EXISTS (
        SELECT 1 FROM public.account_users au
        WHERE au.account_id = o.account_id
          AND au.user_id = auth.uid()
          AND au.is_active = true
      )
  ));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_order_shipments()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_shipments_touch ON public.order_shipments;
CREATE TRIGGER order_shipments_touch
  BEFORE UPDATE ON public.order_shipments
  FOR EACH ROW EXECUTE FUNCTION public._touch_order_shipments();

-- 2. order_line_items.shipment_id --------------------------------------------

ALTER TABLE public.order_line_items
  ADD COLUMN IF NOT EXISTS shipment_id UUID NULL
  REFERENCES public.order_shipments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_line_items_shipment_idx
  ON public.order_line_items (shipment_id);

-- 3. Backfill ----------------------------------------------------------------
-- For each existing order, create one default shipment using the order's
-- delivery_method + the client's shipping_address (if any). Then link all
-- line items to it.

WITH inserted AS (
  INSERT INTO public.order_shipments (
    order_id, shipment_number, delivery_method,
    ship_to_name, ship_to_address_line1, ship_to_city, ship_to_region, ship_to_postal
  )
  SELECT
    o.id,
    1,
    COALESCE(o.delivery_method, 'PICKUP'::delivery_method),
    COALESCE(a.account_name, c.name),
    c.shipping_address,
    NULL, NULL, NULL
  FROM public.orders o
  LEFT JOIN public.clients c ON c.id = o.client_id
  LEFT JOIN public.accounts a ON a.id = o.account_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.order_shipments s WHERE s.order_id = o.id
  )
  RETURNING id, order_id
)
UPDATE public.order_line_items li
SET shipment_id = i.id
FROM inserted i
WHERE li.order_id = i.order_id
  AND li.shipment_id IS NULL;
