-- Add enum value for floor count adjustments
ALTER TYPE public.inventory_transaction_type ADD VALUE IF NOT EXISTS 'GREEN_FLOOR_COUNT_ADJUSTMENT';

-- Add nullable lot_id reference for green-coffee transactions (floor count audit trail)
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.green_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_lot_id
  ON public.inventory_transactions(lot_id)
  WHERE lot_id IS NOT NULL;