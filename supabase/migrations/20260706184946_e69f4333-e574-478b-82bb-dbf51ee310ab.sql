
CREATE OR REPLACE FUNCTION public.mcp_run_read_sql(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed text;
  lowered text;
  result jsonb;
  forbidden text;
BEGIN
  IF query_text IS NULL THEN
    RAISE EXCEPTION 'query is required';
  END IF;

  trimmed := btrim(query_text);
  trimmed := regexp_replace(trimmed, ';+\s*$', '');

  IF position(';' IN trimmed) > 0 THEN
    RAISE EXCEPTION 'multiple statements are not allowed';
  END IF;

  lowered := lower(trimmed);

  IF left(lowered, 6) <> 'select' AND left(lowered, 4) <> 'with' THEN
    RAISE EXCEPTION 'only SELECT (or WITH ... SELECT) queries are allowed';
  END IF;

  FOREACH forbidden IN ARRAY ARRAY[
    '\minsert\M','\mupdate\M','\mdelete\M','\mdrop\M','\malter\M',
    '\mcreate\M','\mtruncate\M','\mgrant\M','\mrevoke\M','\mcomment\M',
    '\mvacuum\M','\manalyze\M','\mcopy\M','\mcall\M','\mmerge\M',
    '\mreindex\M','\mrefresh\M','\mcluster\M','\mlisten\M','\mnotify\M',
    '\mlock\M','\msecurity\M','\mdo\M','\mset\M','\mreset\M'
  ]
  LOOP
    IF lowered ~* forbidden THEN
      RAISE EXCEPTION 'query contains a forbidden keyword';
    END IF;
  END LOOP;

  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', trimmed)
    INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_run_read_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_run_read_sql(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_run_read_sql(text) TO service_role;
