REVOKE EXECUTE ON FUNCTION public.cancel_shipped_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_shipped_order(uuid) TO authenticated, service_role;