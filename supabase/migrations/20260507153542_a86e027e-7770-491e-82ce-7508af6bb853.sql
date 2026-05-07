CREATE OR REPLACE FUNCTION public.stamp_service_fee_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF (NEW.monthly_service_fee IS DISTINCT FROM OLD.monthly_service_fee
      OR NEW.managed_sku_count IS DISTINCT FROM OLD.managed_sku_count
      OR NEW.service_fee_notes IS DISTINCT FROM OLD.service_fee_notes) THEN
    NEW.service_fee_updated_by := auth.uid();
    NEW.service_fee_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;