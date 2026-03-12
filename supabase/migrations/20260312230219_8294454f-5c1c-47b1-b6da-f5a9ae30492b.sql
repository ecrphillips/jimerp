
-- Rename bag_marks → lot_identifier on green_contracts
ALTER TABLE public.green_contracts RENAME COLUMN bag_marks TO lot_identifier;

-- Rename bag_marks → lot_identifier on green_lots
ALTER TABLE public.green_lots RENAME COLUMN bag_marks TO lot_identifier;

-- Add abbreviation column to green_vendors
ALTER TABLE public.green_vendors ADD COLUMN abbreviation text;
