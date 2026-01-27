-- Create enum for inventory transaction types
CREATE TYPE public.inventory_transaction_type AS ENUM (
  'ROAST_OUTPUT',
  'PACK_CONSUME_WIP',
  'PACK_PRODUCE_FG',
  'SHIP_CONSUME_FG',
  'ADJUSTMENT',
  'LOSS'
);

-- Create inventory_transactions table
CREATE TABLE public.inventory_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  transaction_type public.inventory_transaction_type NOT NULL,
  roast_group text,
  product_id uuid REFERENCES public.products(id),
  order_id uuid REFERENCES public.orders(id),
  quantity_kg numeric,
  quantity_units integer,
  notes text,
  is_system_generated boolean NOT NULL DEFAULT false,
  
  -- Constraints
  CONSTRAINT valid_wip_transaction CHECK (
    (transaction_type IN ('ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'ADJUSTMENT', 'LOSS') AND roast_group IS NOT NULL AND quantity_kg IS NOT NULL)
    OR transaction_type NOT IN ('ROAST_OUTPUT', 'PACK_CONSUME_WIP')
  ),
  CONSTRAINT valid_fg_transaction CHECK (
    (transaction_type IN ('PACK_PRODUCE_FG', 'SHIP_CONSUME_FG') AND product_id IS NOT NULL AND quantity_units IS NOT NULL)
    OR transaction_type NOT IN ('PACK_PRODUCE_FG', 'SHIP_CONSUME_FG')
  ),
  CONSTRAINT adjustment_requires_note CHECK (
    (transaction_type IN ('ADJUSTMENT', 'LOSS') AND notes IS NOT NULL AND notes != '')
    OR transaction_type NOT IN ('ADJUSTMENT', 'LOSS')
  )
);

-- Enable RLS
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for Admin/Ops
CREATE POLICY "Admin/Ops can manage inventory transactions"
ON public.inventory_transactions
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create indexes for common queries
CREATE INDEX idx_inventory_transactions_roast_group ON public.inventory_transactions(roast_group) WHERE roast_group IS NOT NULL;
CREATE INDEX idx_inventory_transactions_product_id ON public.inventory_transactions(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_inventory_transactions_created_at ON public.inventory_transactions(created_at DESC);
CREATE INDEX idx_inventory_transactions_type ON public.inventory_transactions(transaction_type);

-- Add comment
COMMENT ON TABLE public.inventory_transactions IS 'Append-only ledger for all inventory movements. WIP = sum(quantity_kg) by roast_group. FG = sum(quantity_units) by product_id.';