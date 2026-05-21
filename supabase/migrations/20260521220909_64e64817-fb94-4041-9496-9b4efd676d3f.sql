
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_location_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.account_locations(id) ON DELETE SET NULL;

ALTER TABLE public.order_shipments DROP CONSTRAINT IF EXISTS order_shipments_location_id_fkey;
ALTER TABLE public.order_shipments ADD CONSTRAINT order_shipments_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.account_locations(id) ON DELETE SET NULL;
