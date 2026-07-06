-- 1) Pin search_path on shopify_grind_signal
ALTER FUNCTION public.shopify_grind_signal(text) SET search_path = public;

-- 2) Revoke anon EXECUTE on SECURITY DEFINER functions that should not be publicly callable
REVOKE EXECUTE ON FUNCTION public.resolve_shopify_quarantined_line(uuid, uuid, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_shopify_quarantined_line_do_not_produce(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, PUBLIC;
