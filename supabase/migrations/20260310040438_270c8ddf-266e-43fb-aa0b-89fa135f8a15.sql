
-- Add prospect_stream enum
CREATE TYPE public.prospect_stream AS ENUM ('CO_ROAST', 'CONTRACT', 'BOTH', 'INDUSTRY_CONTACT');

-- Add new columns to prospects
ALTER TABLE public.prospects
  ADD COLUMN stream public.prospect_stream NOT NULL DEFAULT 'CO_ROAST',
  ADD COLUMN converted boolean NOT NULL DEFAULT false,
  ADD COLUMN converted_to_member_id uuid REFERENCES public.coroast_members(id) ON DELETE SET NULL,
  ADD COLUMN converted_to_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
