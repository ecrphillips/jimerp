ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS coroast_color_index smallint;
COMMENT ON COLUMN public.accounts.coroast_color_index IS 'Persistent co-roast calendar colour slot (0-7); assigned once, editable by staff.';

-- Backfill preserving current colours (active co-roasting accounts in alphabetical order).
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY is_active DESC, account_name) - 1) % 8 AS idx
  FROM public.accounts WHERE programs @> ARRAY['COROASTING']::text[]
)
UPDATE public.accounts a SET coroast_color_index = o.idx FROM ordered o WHERE a.id = o.id AND a.coroast_color_index IS NULL;

CREATE OR REPLACE FUNCTION public.assign_coroast_color()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.coroast_color_index IS NULL AND NEW.programs @> ARRAY['COROASTING']::text[] THEN
    SELECT s.i INTO NEW.coroast_color_index
    FROM generate_series(0,7) s(i)
    LEFT JOIN public.accounts a ON a.coroast_color_index = s.i AND a.is_active AND a.id <> NEW.id
      AND a.programs @> ARRAY['COROASTING']::text[]
    GROUP BY s.i ORDER BY count(a.id), s.i LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_coroast_color ON public.accounts;
CREATE TRIGGER trg_assign_coroast_color BEFORE INSERT OR UPDATE OF programs, coroast_color_index ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.assign_coroast_color();