-- Add work_deadline_at timestamptz column to orders
ALTER TABLE public.orders ADD COLUMN work_deadline_at timestamptz;

-- Create index for sorting
CREATE INDEX IF NOT EXISTS orders_work_deadline_at_idx ON public.orders(work_deadline_at);

-- Migrate existing work_deadline (DATE) data to work_deadline_at (timestamptz)
-- Default to 10:00 AM in America/Vancouver timezone
UPDATE public.orders 
SET work_deadline_at = (work_deadline::date || ' 10:00:00')::timestamp AT TIME ZONE 'America/Vancouver'
WHERE work_deadline IS NOT NULL AND work_deadline_at IS NULL;