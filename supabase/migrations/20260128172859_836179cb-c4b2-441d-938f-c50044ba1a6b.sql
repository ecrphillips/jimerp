-- Drop and recreate function with correct signature
DROP FUNCTION IF EXISTS public.can_access_client(uuid, uuid);

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
    AND (
      role IN ('ADMIN', 'OPS')
      OR (role = 'CLIENT' AND client_id = _client_id)
    )
  )
$$;