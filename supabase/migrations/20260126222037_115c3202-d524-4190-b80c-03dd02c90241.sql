-- Add manually_deprioritized field to orders table
ALTER TABLE public.orders 
ADD COLUMN manually_deprioritized boolean NOT NULL DEFAULT false;