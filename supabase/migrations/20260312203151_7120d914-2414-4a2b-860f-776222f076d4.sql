-- Add bag_marks column to green_contracts
ALTER TABLE green_contracts ADD COLUMN IF NOT EXISTS bag_marks text;