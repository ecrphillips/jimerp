-- Add cropster_batch_id column to roasted_batches table
ALTER TABLE public.roasted_batches 
ADD COLUMN cropster_batch_id text DEFAULT NULL;