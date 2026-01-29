-- Add column to track when a component batch was consumed by blending
-- A batch with consumed_by_blend_at IS NOT NULL cannot be used for blending again
ALTER TABLE public.roasted_batches
ADD COLUMN consumed_by_blend_at timestamp with time zone DEFAULT NULL;

-- Add a partial index to quickly find unconsumed batches
CREATE INDEX idx_roasted_batches_unconsumed 
ON public.roasted_batches (roast_group, status) 
WHERE consumed_by_blend_at IS NULL;

-- Add a comment explaining the column
COMMENT ON COLUMN public.roasted_batches.consumed_by_blend_at IS 'When set, this batch has been consumed by a blend operation and cannot be blended again';