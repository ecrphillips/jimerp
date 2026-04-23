ALTER TABLE public.green_lot_roast_group_links
  ADD COLUMN successor_lot_id uuid NULL REFERENCES public.green_lots(id) ON DELETE SET NULL,
  ADD COLUMN successor_nominated_at timestamptz NULL,
  ADD COLUMN successor_nominated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_green_lot_roast_group_links_successor_lot_id
  ON public.green_lot_roast_group_links(successor_lot_id);