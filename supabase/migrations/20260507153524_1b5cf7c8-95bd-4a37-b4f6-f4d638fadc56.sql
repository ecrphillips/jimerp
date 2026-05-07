-- Add monthly service fee fields to accounts
ALTER TABLE public.accounts
  ADD COLUMN monthly_service_fee numeric NULL,
  ADD COLUMN managed_sku_count integer NULL,
  ADD COLUMN service_fee_notes text NULL,
  ADD COLUMN service_fee_updated_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN service_fee_updated_at timestamptz NULL;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_service_fee_non_negative
  CHECK (
    (monthly_service_fee IS NULL OR monthly_service_fee >= 0)
    AND (managed_sku_count IS NULL OR managed_sku_count >= 0)
  );

CREATE OR REPLACE FUNCTION public.stamp_service_fee_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS stamp_accounts_service_fee_audit ON public.accounts;
CREATE TRIGGER stamp_accounts_service_fee_audit
BEFORE UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.stamp_service_fee_audit();