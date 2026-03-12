
-- Add columns to green_contracts
ALTER TABLE green_contracts ADD COLUMN IF NOT EXISTS internal_contract_number text;
ALTER TABLE green_contracts ADD COLUMN IF NOT EXISTS vendor_contract_number text;
ALTER TABLE green_contracts ADD COLUMN IF NOT EXISTS origin_country text;

-- Unique constraint on internal_contract_number (nullable but unique when set)
ALTER TABLE green_contracts ADD CONSTRAINT green_contracts_internal_contract_number_key UNIQUE (internal_contract_number);

-- Add columns to green_lots
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS bag_marks text;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE green_lots ADD COLUMN IF NOT EXISTS vendor_invoice_number text;

-- Unique constraint on po_number (nullable but unique when set)
ALTER TABLE green_lots ADD CONSTRAINT green_lots_po_number_key UNIQUE (po_number);

-- Sequences for auto-generation
CREATE SEQUENCE IF NOT EXISTS internal_contract_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1;
