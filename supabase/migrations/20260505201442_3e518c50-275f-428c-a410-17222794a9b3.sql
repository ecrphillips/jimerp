SELECT pg_notify('pgrst', 'reload schema');
SELECT pg_notify('pgrst', 'reload config');
COMMENT ON COLUMN public.roast_groups.blend_type IS 'PRE_ROAST or POST_ROAST';
SELECT pg_notify('pgrst', 'reload schema');