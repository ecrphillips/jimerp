ALTER TABLE public.coroast_billing_periods 
  ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prorated_base_fee numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS proration_note text DEFAULT NULL;