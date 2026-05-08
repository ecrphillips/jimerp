BEGIN;

CREATE TEMP TABLE _bt_backup AS
SELECT roast_group, blend_type
FROM public.roast_groups
WHERE blend_type IS NOT NULL;

ALTER TABLE public.roast_groups DROP COLUMN blend_type;

ALTER TABLE public.roast_groups ADD COLUMN blend_type text;

UPDATE public.roast_groups r
SET blend_type = b.blend_type
FROM _bt_backup b
WHERE r.roast_group = b.roast_group;

NOTIFY pgrst, 'reload schema';

COMMIT;