-- F-002: surface submitter on new-order toast notifications
ALTER TABLE public.order_notifications
  ADD COLUMN IF NOT EXISTS submitted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_admin BOOLEAN NOT NULL DEFAULT false;
