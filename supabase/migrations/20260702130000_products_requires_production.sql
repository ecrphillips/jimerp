-- Bought-in products (instant coffee, merch, brewing gear) skip roasting and
-- packing entirely. The column may already exist if it was added directly in
-- the dashboard; IF NOT EXISTS makes this migration a safe no-op in that case.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_production boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.requires_production IS
  'False for bought-in items (instant coffee, merch, gear): no roast group, no WIP consumption, no packing. They appear on the pack list for attention only and count as automatically packed for order progress.';
