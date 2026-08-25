REVOKE ALL ON FUNCTION public._get_or_create_billing_period(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_or_create_billing_period(uuid, date) TO service_role;