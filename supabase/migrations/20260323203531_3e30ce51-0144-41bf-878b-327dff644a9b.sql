
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_account_id ON public.orders USING btree (account_id);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_account_id ON public.products USING btree (account_id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS account_location_id uuid REFERENCES public.account_locations(id) ON DELETE SET NULL;
