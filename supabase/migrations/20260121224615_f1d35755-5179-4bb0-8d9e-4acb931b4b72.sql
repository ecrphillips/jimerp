-- Add is_perennial boolean to products table
ALTER TABLE public.products 
ADD COLUMN is_perennial boolean NOT NULL DEFAULT false;