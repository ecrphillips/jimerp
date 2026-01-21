-- Add fulfillment checklist fields to orders
ALTER TABLE public.orders 
ADD COLUMN roasted boolean NOT NULL DEFAULT false,
ADD COLUMN packed boolean NOT NULL DEFAULT false,
ADD COLUMN shipped_or_ready boolean NOT NULL DEFAULT false,
ADD COLUMN invoiced boolean NOT NULL DEFAULT false,
ADD COLUMN created_by_admin boolean NOT NULL DEFAULT false;