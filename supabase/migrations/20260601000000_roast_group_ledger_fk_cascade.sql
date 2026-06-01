-- Fix roast-group orphan rows in the WIP ledger tables.
--
-- Problem: inventory_transactions.roast_group and wip_adjustments.roast_group are
-- plain TEXT with no foreign key, so deleting (or hard-removing) a roast group left
-- their ledger rows behind. useAuthoritativeWip sums by roast_group with no existence
-- check, so those orphan rows became phantom WIP that new batches got consumed against.
--
-- Fix: cascade these rows to the parent roast group. Cleanup runs first so the
-- constraint add does not fail on pre-existing orphans.
--
-- NOTE: green_lot_roast_group_links is intentionally left ON DELETE RESTRICT — that
-- link blocks deletion on purpose (sourcing traceability); the UI gates it instead.

-- 1. Remove existing orphans (rows pointing at a roast group that no longer exists).
DELETE FROM public.inventory_transactions
WHERE roast_group IS NOT NULL
  AND roast_group NOT IN (SELECT roast_group FROM public.roast_groups);

DELETE FROM public.wip_adjustments
WHERE roast_group IS NOT NULL
  AND roast_group NOT IN (SELECT roast_group FROM public.roast_groups);

-- 2. Add FKs so future roast-group deletes cascade their ledger rows away.
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT fk_inventory_transactions_roast_group
  FOREIGN KEY (roast_group)
  REFERENCES public.roast_groups(roast_group)
  ON DELETE CASCADE;

ALTER TABLE public.wip_adjustments
  ADD CONSTRAINT fk_wip_adjustments_roast_group
  FOREIGN KEY (roast_group)
  REFERENCES public.roast_groups(roast_group)
  ON DELETE CASCADE;
