-- Add UNIQUE constraints for ON CONFLICT upserts in seed function

-- clients.client_code - used for ON CONFLICT (client_code)
ALTER TABLE public.clients
ADD CONSTRAINT clients_client_code_key UNIQUE (client_code);

-- products.sku - used for ON CONFLICT (sku)
ALTER TABLE public.products
ADD CONSTRAINT products_sku_key UNIQUE (sku);

-- source_board_products (source, product_id) - used for ON CONFLICT (source, product_id)
-- First check if it exists and drop duplicates if any
DELETE FROM public.source_board_products a
USING public.source_board_products b
WHERE a.id > b.id 
  AND a.source = b.source 
  AND a.product_id = b.product_id;

ALTER TABLE public.source_board_products
ADD CONSTRAINT source_board_products_source_product_key UNIQUE (source, product_id);