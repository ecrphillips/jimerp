
-- Make vendor_id nullable on green_contracts
ALTER TABLE public.green_contracts ALTER COLUMN vendor_id DROP NOT NULL;
-- Make warehouse_location nullable on green_contracts
ALTER TABLE public.green_contracts ALTER COLUMN warehouse_location DROP NOT NULL;
