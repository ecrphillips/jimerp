
-- Cost fields (stored values, always in CAD)
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS fx_rate numeric;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS invoice_amount_cad numeric;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS carry_fees_cad numeric;

-- Currency flags (true = USD input, converted via fx_rate; false = CAD entered directly)
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS invoice_is_usd boolean NOT NULL DEFAULT false;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS carry_fees_is_usd boolean NOT NULL DEFAULT false;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS freight_is_usd boolean NOT NULL DEFAULT false;

-- Other cost fields
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS other_costs_cad numeric;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS other_costs_description text;

-- Computed cost outputs
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS book_value_per_kg numeric;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS market_value_per_kg numeric;

-- Per-field confirmation stamps
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS fx_rate_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS fx_rate_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS invoice_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS invoice_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS carry_fees_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS carry_fees_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS freight_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS freight_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS duties_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS duties_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS transaction_fees_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS transaction_fees_confirmed_at timestamptz;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS other_costs_confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS other_costs_confirmed_at timestamptz;
