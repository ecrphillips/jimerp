DELETE FROM public.inventory_transactions
WHERE roast_group IS NOT NULL
  AND roast_group NOT IN (SELECT roast_group FROM public.roast_groups);

DELETE FROM public.wip_adjustments
WHERE roast_group IS NOT NULL
  AND roast_group NOT IN (SELECT roast_group FROM public.roast_groups);

DO $$ BEGIN
  ALTER TABLE public.inventory_transactions
    ADD CONSTRAINT fk_inventory_transactions_roast_group
    FOREIGN KEY (roast_group)
    REFERENCES public.roast_groups(roast_group)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.wip_adjustments
    ADD CONSTRAINT fk_wip_adjustments_roast_group
    FOREIGN KEY (roast_group)
    REFERENCES public.roast_groups(roast_group)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;