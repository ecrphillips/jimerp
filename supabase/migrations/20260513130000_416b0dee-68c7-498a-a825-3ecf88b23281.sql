-- Shopify integration foundation: tables + new columns on orders / order_line_items.
-- Step 1 of a multi-step Shopify rollout. Tables created empty; UI in /admin/shopify-debug.

CREATE TABLE public.shopify_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  store_slug text NOT NULL UNIQUE,
  linked_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  store_url text NOT NULL,
  pull_cadence text NOT NULL DEFAULT 'manual'
    CHECK (pull_cadence IN ('manual','hourly','daily')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shopify_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_source_id uuid NOT NULL REFERENCES public.shopify_sources(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  shopify_variant_id text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shopify_source_id, shopify_product_id, shopify_variant_id)
);

CREATE TABLE public.shopify_pull_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_source_id uuid NOT NULL REFERENCES public.shopify_sources(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('success','partial','error')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual','scheduled','webhook')),
  orders_retrieved integer NOT NULL DEFAULT 0,
  orders_included integer NOT NULL DEFAULT 0,
  orders_quarantined integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shopify_bundle_source_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_source_id uuid NOT NULL REFERENCES public.shopify_sources(id) ON DELETE CASCADE,
  shopify_order_id text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  bundle_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shopify_source_id, shopify_order_id)
);

ALTER TABLE public.orders
  ADD COLUMN source_channel text NOT NULL DEFAULT 'manual'
    CHECK (source_channel IN ('manual','shopify_auto','shopify_manual_fallback')),
  ADD COLUMN shopify_source_id uuid REFERENCES public.shopify_sources(id) ON DELETE SET NULL;

ALTER TABLE public.order_line_items
  ADD COLUMN short_ship_reason text
    CHECK (short_ship_reason IN ('deferred','abandoned'));

ALTER TABLE public.shopify_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_pull_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_bundle_source_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY shopify_sources_admin_all ON public.shopify_sources
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY shopify_product_mappings_admin_all ON public.shopify_product_mappings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY shopify_pull_log_admin_all ON public.shopify_pull_log
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY shopify_bundle_source_orders_admin_all ON public.shopify_bundle_source_orders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));
