-- Create green_releases table
CREATE TABLE public.green_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID REFERENCES public.green_vendors(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  invoice_number TEXT,
  eta_date DATE,
  received_date DATE,
  arrival_status TEXT NOT NULL DEFAULT 'EN_ROUTE',
  shared_costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT green_releases_status_check CHECK (status IN ('PENDING', 'INVOICED')),
  CONSTRAINT green_releases_arrival_check CHECK (arrival_status IN ('EN_ROUTE', 'RECEIVED'))
);

CREATE INDEX idx_green_releases_vendor ON public.green_releases(vendor_id);
CREATE INDEX idx_green_releases_status ON public.green_releases(status);

-- Create green_release_lines table
CREATE TABLE public.green_release_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  release_id UUID NOT NULL REFERENCES public.green_releases(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.green_contracts(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES public.green_lots(id) ON DELETE SET NULL,
  bags_requested INTEGER NOT NULL,
  bag_size_kg NUMERIC NOT NULL,
  price_per_lb_usd NUMERIC,
  original_price JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_green_release_lines_release ON public.green_release_lines(release_id);
CREATE INDEX idx_green_release_lines_contract ON public.green_release_lines(contract_id);
CREATE INDEX idx_green_release_lines_lot ON public.green_release_lines(lot_id);

-- Add release_id to green_lots
ALTER TABLE public.green_lots
  ADD COLUMN release_id UUID REFERENCES public.green_releases(id) ON DELETE SET NULL;

CREATE INDEX idx_green_lots_release ON public.green_lots(release_id);

-- Enable RLS
ALTER TABLE public.green_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_release_lines ENABLE ROW LEVEL SECURITY;

-- RLS policies (mirror green_purchases pattern: ADMIN/OPS full access)
CREATE POLICY "Admin/OPS full access on green_releases"
  ON public.green_releases
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin/OPS full access on green_release_lines"
  ON public.green_release_lines
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Updated_at trigger
CREATE TRIGGER set_green_releases_updated_at
  BEFORE UPDATE ON public.green_releases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();