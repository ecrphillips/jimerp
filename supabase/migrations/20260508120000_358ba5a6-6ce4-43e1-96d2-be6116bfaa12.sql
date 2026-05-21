-- Multi-vendor / multi-source releases
-- Allow release lines to originate from forward contracts, existing spot purchase lines,
-- or ad-hoc entries. Denormalize vendor + origin fields onto the line so the release
-- detail view doesn't need to join multiple tables per source type.

ALTER TABLE public.green_release_lines
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'CONTRACT'
    CONSTRAINT green_release_lines_source_type_check
      CHECK (source_type IN ('CONTRACT', 'PURCHASE', 'ADHOC')),
  ADD COLUMN purchase_line_id UUID
    REFERENCES public.green_purchase_lines(id) ON DELETE SET NULL,
  ADD COLUMN vendor_id UUID
    REFERENCES public.green_vendors(id) ON DELETE SET NULL,
  ADD COLUMN lot_identifier TEXT,
  ADD COLUMN origin_country TEXT,
  ADD COLUMN region TEXT,
  ADD COLUMN producer TEXT,
  ADD COLUMN variety TEXT;

CREATE INDEX idx_green_release_lines_purchase_line
  ON public.green_release_lines(purchase_line_id)
  WHERE purchase_line_id IS NOT NULL;

CREATE INDEX idx_green_release_lines_vendor
  ON public.green_release_lines(vendor_id)
  WHERE vendor_id IS NOT NULL;

COMMENT ON COLUMN public.green_release_lines.source_type IS
  'CONTRACT = forward contract line; PURCHASE = existing green_purchase_line; ADHOC = manually entered';
COMMENT ON COLUMN public.green_release_lines.purchase_line_id IS
  'Set when source_type = PURCHASE; FK to the originating purchase line';
COMMENT ON COLUMN public.green_release_lines.vendor_id IS
  'Denormalized vendor for this line — derived from contract, purchase, or ad-hoc entry';
