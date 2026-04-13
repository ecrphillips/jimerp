
-- TABLE 1: green_purchases
CREATE TABLE public.green_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.green_vendors(id) ON DELETE RESTRICT,
  invoice_number text,
  invoice_date date,
  due_date date,
  fx_rate numeric,
  fx_rate_is_cad boolean NOT NULL DEFAULT false,
  shared_freight_usd numeric NOT NULL DEFAULT 0,
  shared_carry_usd numeric NOT NULL DEFAULT 0,
  shared_other_usd numeric NOT NULL DEFAULT 0,
  shared_other_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_green_purchases_vendor_id ON public.green_purchases(vendor_id);

-- TABLE 2: green_purchase_lines
CREATE TABLE public.green_purchase_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES public.green_purchases(id) ON DELETE CASCADE,
  lot_identifier text,
  origin_country text,
  region text,
  producer text,
  variety text,
  crop_year text,
  category text,
  bags integer NOT NULL DEFAULT 0,
  bag_size_kg numeric NOT NULL DEFAULT 0,
  price_per_lb_usd numeric,
  warehouse_location text,
  notes text,
  lot_id uuid REFERENCES public.green_lots(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_green_purchase_lines_purchase_id ON public.green_purchase_lines(purchase_id);
CREATE INDEX idx_green_purchase_lines_lot_id ON public.green_purchase_lines(lot_id) WHERE lot_id IS NOT NULL;

-- Auto-update updated_at on green_purchases
CREATE TRIGGER update_green_purchases_updated_at
  BEFORE UPDATE ON public.green_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
