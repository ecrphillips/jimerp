CREATE OR REPLACE FUNCTION public.mcp_run_read_sql(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Only block statements that write or change data/structure.
  FOREACH forbidden IN ARRAY ARRAY[
    '\minsert\M','\mupdate\M','\mdelete\M','\mdrop\M','\malter\M',
    '\mcreate\M','\mtruncate\M'
  ]
  LOOP
    IF lowered ~* forbidden THEN
      RAISE EXCEPTION 'query contains a forbidden keyword';
    END IF;
  END LOOP;

  -- Wrap as a CTE so subqueries, UNION, WITH, and aggregates all work uniformly.
  EXECUTE format(
    'WITH __mcp_q AS (%s) SELECT COALESCE(jsonb_agg(to_jsonb(__mcp_q)), ''[]''::jsonb) FROM __mcp_q',
    trimmed
  ) INTO result;

  RETURN result;
END;
$function$;