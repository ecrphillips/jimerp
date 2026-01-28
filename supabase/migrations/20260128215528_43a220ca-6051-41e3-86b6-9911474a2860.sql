-- Add explicit deny policies for remaining tables that the scanner flagged
-- Even though anon has no grants, this adds defense-in-depth

-- user_roles: Add explicit anon deny
CREATE POLICY "Deny anonymous access to user_roles"
ON public.user_roles
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- order_notifications: Add explicit anon deny  
CREATE POLICY "Deny anonymous access to order_notifications"
ON public.order_notifications
FOR ALL
TO anon
USING (false)
WITH CHECK (false);