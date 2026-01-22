-- Add client_code column to clients table
ALTER TABLE public.clients ADD COLUMN client_code text;

-- Backfill existing clients with default codes
-- Use first 3 uppercase letters of name, or generate EXA, EXB, etc.
DO $$
DECLARE
  client_rec RECORD;
  base_code TEXT;
  final_code TEXT;
  counter INT;
  suffix_counter INT;
BEGIN
  suffix_counter := 1;
  FOR client_rec IN SELECT id, name FROM public.clients WHERE client_code IS NULL ORDER BY created_at ASC LOOP
    -- Generate base code from first 3 letters of name (uppercase, letters only)
    base_code := UPPER(REGEXP_REPLACE(LEFT(client_rec.name, 3), '[^A-Z]', '', 'g'));
    
    -- If less than 3 letters, pad with X
    WHILE LENGTH(base_code) < 3 LOOP
      base_code := base_code || 'X';
    END LOOP;
    
    final_code := base_code;
    counter := 1;
    
    -- Check for uniqueness and add digit suffix if needed
    WHILE EXISTS (SELECT 1 FROM public.clients WHERE client_code = final_code AND id != client_rec.id) LOOP
      final_code := base_code || counter::TEXT;
      counter := counter + 1;
      -- If we've tried 10 times, use a completely different approach
      IF counter > 10 THEN
        final_code := 'CL' || suffix_counter::TEXT;
        suffix_counter := suffix_counter + 1;
      END IF;
    END LOOP;
    
    UPDATE public.clients SET client_code = final_code WHERE id = client_rec.id;
  END LOOP;
END $$;

-- Now make client_code NOT NULL and UNIQUE
ALTER TABLE public.clients ALTER COLUMN client_code SET NOT NULL;
ALTER TABLE public.clients ADD CONSTRAINT clients_client_code_unique UNIQUE (client_code);

-- Update the order number generation function to use client_code prefix
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  client_code_val TEXT;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    -- Get the client_code for this order's client
    SELECT client_code INTO client_code_val FROM public.clients WHERE id = NEW.client_id;
    
    -- If no client_code found (shouldn't happen), use 'ORD' as fallback
    IF client_code_val IS NULL THEN
      client_code_val := 'ORD';
    END IF;
    
    NEW.order_number := client_code_val || '-' || LPAD(nextval('public.order_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;