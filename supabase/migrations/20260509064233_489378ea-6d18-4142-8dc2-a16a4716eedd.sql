ALTER TABLE public.green_purchases
  ADD COLUMN shared_costs_deferred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN deferred_to_release_id UUID
    REFERENCES public.green_releases(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.green_purchases.shared_costs_deferred IS
  'true when this purchase is part of a mixed shipment whose freight/carry/duties are entered on the release, not on the purchase';
COMMENT ON COLUMN public.green_purchases.deferred_to_release_id IS
  'Set once the release that owns this shipment''s shared costs is created';

ALTER TABLE public.green_lots
  ADD COLUMN is_placeholder BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.green_lots.is_placeholder IS
  'true when the lot was created from a placeholder release line — minimal fields only, awaiting full purchase/contract details';

CREATE INDEX idx_green_lots_placeholder
  ON public.green_lots(is_placeholder)
  WHERE is_placeholder = true;

ALTER TABLE public.green_release_lines
  DROP CONSTRAINT IF EXISTS green_release_lines_source_type_check;

UPDATE public.green_release_lines
   SET source_type = 'PLACEHOLDER'
 WHERE source_type = 'ADHOC';

ALTER TABLE public.green_release_lines
  ADD CONSTRAINT green_release_lines_source_type_check
    CHECK (source_type IN ('CONTRACT', 'PURCHASE', 'PLACEHOLDER'));

COMMENT ON COLUMN public.green_release_lines.source_type IS
  'CONTRACT = forward contract line; PURCHASE = existing green_purchase_line; PLACEHOLDER = stand-in for a purchase/contract not yet entered';