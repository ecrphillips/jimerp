ALTER TABLE public.orders
  ADD COLUMN shipping_cost_cad NUMERIC(10,2);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_shipping_cost_cad_nonnegative
  CHECK (shipping_cost_cad IS NULL OR shipping_cost_cad >= 0);

COMMENT ON COLUMN public.orders.shipping_cost_cad IS
  'Actual shipping-label cost in CAD, entered by internal staff for invoicing.';

CREATE OR REPLACE FUNCTION public.enforce_internal_shipping_cost_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shipping_cost_cad IS DISTINCT FROM OLD.shipping_cost_cad
     AND NOT (
       public.has_role(auth.uid(), 'ADMIN'::public.app_role)
       OR public.has_role(auth.uid(), 'OPS'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Only internal staff can update shipping costs';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_internal_shipping_cost_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_internal_shipping_cost_update() TO service_role;

CREATE TRIGGER enforce_internal_shipping_cost_update
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_internal_shipping_cost_update();