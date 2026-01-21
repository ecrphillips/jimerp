-- Fix CLIENT cancel behavior: allow SUBMITTED -> CANCELLED for own client orders only

-- Recreate the existing client update policy with an explicit WITH CHECK (so status can't be changed outside allowed states)
DROP POLICY IF EXISTS "Clients can update own draft/submitted orders" ON public.orders;
CREATE POLICY "Clients can update own draft/submitted orders"
ON public.orders
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (
  get_user_client_id(auth.uid()) = client_id
  AND status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
)
WITH CHECK (
  get_user_client_id(auth.uid()) = client_id
  AND status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
);

-- Add a dedicated cancel policy: only allow updating a SUBMITTED row to CANCELLED for the same client
DROP POLICY IF EXISTS "Clients can cancel own submitted orders" ON public.orders;
CREATE POLICY "Clients can cancel own submitted orders"
ON public.orders
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (
  get_user_client_id(auth.uid()) = client_id
  AND status = 'SUBMITTED'::public.order_status
)
WITH CHECK (
  get_user_client_id(auth.uid()) = client_id
  AND status = 'CANCELLED'::public.order_status
);
