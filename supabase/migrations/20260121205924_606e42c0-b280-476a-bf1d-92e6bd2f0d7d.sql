-- Add ship_priority enum
CREATE TYPE public.ship_priority AS ENUM ('NORMAL', 'TIME_SENSITIVE');

-- Add ship_priority column to production_checkmarks
ALTER TABLE public.production_checkmarks
ADD COLUMN ship_priority public.ship_priority NOT NULL DEFAULT 'NORMAL';