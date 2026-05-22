
-- Fix: set immutable search_path on the trigger function that is missing it
ALTER FUNCTION public.set_client_ue_scenarios_updated_at() SET search_path = public;

-- Fix: revoke EXECUTE from anon (and PUBLIC) on all SECURITY DEFINER functions
-- in the public schema, except a small allowlist of token-based public flows.
DO $$
DECLARE
  r record;
  v_sig text;
  v_allow text[] := ARRAY[
    'get_invitation_by_token(text)',
    'submit_prospect_interest(text,text,text,text,text,text,text,text,text,text,text,numeric,text)'
  ];
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef IS TRUE
  LOOP
    v_sig := r.proname || '(' || regexp_replace(r.args, '\s+', '', 'g') || ')';
    -- normalize a couple of long type names for matching
    v_sig := replace(v_sig, 'timewithouttimezone', 'time without time zone');
    IF v_sig = ANY(v_allow) THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                   r.proname, r.args);
  END LOOP;
END $$;
