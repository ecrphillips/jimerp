
-- Add costing_status column to green_lots
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS costing_status text NOT NULL DEFAULT 'INCOMPLETE';

-- Backfill existing data
UPDATE public.green_lots SET costing_status = 'COMPLETE', status = 'RECEIVED' WHERE status = 'COSTING_COMPLETE';
UPDATE public.green_lots SET costing_status = 'INCOMPLETE', status = 'RECEIVED' WHERE status = 'COSTING_INCOMPLETE';

-- Change status column from enum to text to allow removing old values
ALTER TABLE public.green_lots ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.green_lots ALTER COLUMN status SET DEFAULT 'EN_ROUTE';
