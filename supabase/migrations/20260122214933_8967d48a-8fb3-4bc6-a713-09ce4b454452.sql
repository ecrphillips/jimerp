-- Create board_source enum for andon_picks to support all boards
-- First, drop the existing CHECK constraint (if any)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'andon_picks_board_check' 
    AND table_name = 'andon_picks'
  ) THEN
    ALTER TABLE public.andon_picks DROP CONSTRAINT andon_picks_board_check;
  END IF;
END $$;

-- Add units_supplied column to andon_picks
ALTER TABLE public.andon_picks 
ADD COLUMN IF NOT EXISTS units_supplied integer NOT NULL DEFAULT 0;

-- Add a more permissive CHECK constraint that includes NOSMOKE
ALTER TABLE public.andon_picks 
ADD CONSTRAINT andon_picks_board_check 
CHECK (board IN ('MATCHSTICK', 'FUNK', 'NOSMOKE'));