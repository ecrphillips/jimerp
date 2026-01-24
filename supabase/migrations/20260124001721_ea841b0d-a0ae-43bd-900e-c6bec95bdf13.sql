-- Add expected yield loss percentage to roast_groups
ALTER TABLE public.roast_groups 
ADD COLUMN expected_yield_loss_pct numeric NOT NULL DEFAULT 16.0;

-- Add constraint to ensure yield loss is between 0 and 100
ALTER TABLE public.roast_groups 
ADD CONSTRAINT roast_groups_expected_yield_loss_pct_check 
CHECK (expected_yield_loss_pct >= 0 AND expected_yield_loss_pct <= 100);