ALTER TABLE public.coroast_loring_blocks ADD COLUMN recurring_series_id uuid DEFAULT NULL;

CREATE INDEX idx_loring_blocks_series ON public.coroast_loring_blocks (recurring_series_id) WHERE recurring_series_id IS NOT NULL;