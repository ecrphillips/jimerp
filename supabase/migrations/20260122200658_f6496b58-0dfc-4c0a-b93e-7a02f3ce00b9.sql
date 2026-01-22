-- Create roaster enum
CREATE TYPE public.roaster_machine AS ENUM ('SAMIAC', 'LORING');

-- Create default_roaster enum (includes EITHER option)
CREATE TYPE public.default_roaster AS ENUM ('SAMIAC', 'LORING', 'EITHER');

-- Add default_roaster column to roast_groups table
ALTER TABLE public.roast_groups 
ADD COLUMN default_roaster default_roaster NOT NULL DEFAULT 'EITHER';

-- Add assigned_roaster column to roasted_batches table
ALTER TABLE public.roasted_batches 
ADD COLUMN assigned_roaster roaster_machine;