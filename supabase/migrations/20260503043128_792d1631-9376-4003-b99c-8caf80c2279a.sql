-- Trigger function: auto-correct account_users permission flags based on accounts.programs
CREATE OR REPLACE FUNCTION public.account_users_enforce_program_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_programs text[];
BEGIN
  SELECT programs INTO v_programs FROM public.accounts WHERE id = NEW.account_id;

  IF v_programs IS NULL OR NOT ('MANUFACTURING' = ANY(v_programs)) THEN
    NEW.can_place_orders := false;
  END IF;

  IF v_programs IS NULL OR NOT ('COROASTING' = ANY(v_programs)) THEN
    NEW.can_book_roaster := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_users_enforce_program_permissions_trigger ON public.account_users;
CREATE TRIGGER account_users_enforce_program_permissions_trigger
  BEFORE INSERT OR UPDATE ON public.account_users
  FOR EACH ROW
  EXECUTE FUNCTION public.account_users_enforce_program_permissions();

-- One-time data fix for existing drifted rows
DO $$
DECLARE
  v_orders_fixed int;
  v_roaster_fixed int;
BEGIN
  WITH upd AS (
    UPDATE public.account_users au
    SET can_place_orders = false
    FROM public.accounts a
    WHERE a.id = au.account_id
      AND au.can_place_orders = true
      AND NOT ('MANUFACTURING' = ANY(a.programs))
    RETURNING 1
  )
  SELECT count(*) INTO v_orders_fixed FROM upd;

  WITH upd AS (
    UPDATE public.account_users au
    SET can_book_roaster = false
    FROM public.accounts a
    WHERE a.id = au.account_id
      AND au.can_book_roaster = true
      AND NOT ('COROASTING' = ANY(a.programs))
    RETURNING 1
  )
  SELECT count(*) INTO v_roaster_fixed FROM upd;

  RAISE NOTICE 'account_users drift fix: % can_place_orders cleared, % can_book_roaster cleared', v_orders_fixed, v_roaster_fixed;
END;
$$;