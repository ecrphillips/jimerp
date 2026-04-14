ALTER TABLE public.accounts ADD COLUMN coroast_custom_base_fee numeric;
ALTER TABLE public.accounts ADD COLUMN coroast_custom_included_hours numeric;
ALTER TABLE public.accounts ADD COLUMN coroast_custom_overage_rate numeric;
ALTER TABLE public.accounts ADD COLUMN coroast_custom_included_pallets integer;
ALTER TABLE public.accounts ADD COLUMN coroast_custom_storage_rate numeric;