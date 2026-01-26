-- Add ship_display_order column to orders for Ship tab manual ordering
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS ship_display_order integer;

-- Backfill orders.ship_display_order with deterministic order
-- (requested_ship_date asc, then order_number asc) - ONE TIME
WITH ordered_orders AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY requested_ship_date ASC NULLS LAST, order_number ASC
  ) * 10 AS new_order
  FROM public.orders
  WHERE status IN ('SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY')
)
UPDATE public.orders o
SET ship_display_order = oo.new_order
FROM ordered_orders oo
WHERE o.id = oo.id;