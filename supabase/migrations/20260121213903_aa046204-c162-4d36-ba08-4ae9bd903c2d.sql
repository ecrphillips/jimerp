-- Create packaging_variant enum
CREATE TYPE public.packaging_variant AS ENUM (
  'RETAIL_250G',
  'RETAIL_300G',
  'RETAIL_340G',
  'RETAIL_454G',
  'CROWLER_200G',
  'CROWLER_250G',
  'CAN_125G',
  'BULK_2LB',
  'BULK_1KG',
  'BULK_5LB',
  'BULK_2KG'
);

-- Add packaging_variant column to products table
ALTER TABLE public.products 
ADD COLUMN packaging_variant public.packaging_variant;