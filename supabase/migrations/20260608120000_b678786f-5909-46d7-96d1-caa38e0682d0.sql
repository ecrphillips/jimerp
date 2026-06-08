-- Fix generate_order_number(): read account_code / location_code from the live
-- accounts + account_locations tables. The previous body still queried the legacy
-- clients / client_locations tables by NEW.client_id / NEW.location_id, but orders
-- now insert account_id (no client_id) and a location_id that points at
-- account_locations(id). Both lookups missed, so every new order fell back to the
-- 'ORD' + 'XX' placeholders (e.g. ORDXX-000132) even when a location was chosen.
-- Format is unchanged (account_code || location_code || '-' || seq); only the
-- lookup sources are corrected. Existing order_number values are left untouched.

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  account_code_val  TEXT;
  location_code_val TEXT;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    SELECT account_code INTO account_code_val
      FROM public.accounts WHERE id = NEW.account_id;
    IF account_code_val IS NULL OR account_code_val = '' THEN
      account_code_val := 'ORD';
    END IF;

    IF NEW.location_id IS NOT NULL THEN
      SELECT location_code INTO location_code_val
        FROM public.account_locations WHERE id = NEW.location_id;
    END IF;
    IF location_code_val IS NULL OR location_code_val = '' THEN
      location_code_val := 'XX';
    END IF;

    NEW.order_number := account_code_val || location_code_val || '-'
                        || LPAD(nextval('public.order_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;
