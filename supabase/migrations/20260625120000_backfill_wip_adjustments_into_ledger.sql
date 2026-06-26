-- Backfill manual WIP adjustments into the single source-of-truth ledger.
--
-- WIP balances are now computed entirely from inventory_transactions
-- (ROAST_OUTPUT + PACK_CONSUME_WIP + ADJUSTMENT + LOSS, summed by quantity_kg).
-- The legacy wip_adjustments table (opening balances, recounts, floor counts)
-- is retired; this copies each of its rows in as an ADJUSTMENT row so existing
-- WIP balances are preserved when the read drops the wip_adjustments term.
--
-- IDEMPOTENT: each source row is tagged in notes with its wip_adjustments.id
-- ('[backfill wip_adjustments:<uuid>]'). Re-running skips any row already
-- copied, so it is safe to apply more than once without double-counting.
--
-- created_at and created_by are carried over from the source row so the audit
-- trail (who / when) is preserved, not reset to the migration time.

INSERT INTO public.inventory_transactions
  (transaction_type, roast_group, quantity_kg, notes, created_by, created_at, is_system_generated)
SELECT
  'ADJUSTMENT',
  wa.roast_group,
  wa.kg_delta,
  '[backfill wip_adjustments:' || wa.id::text || '] [' || wa.reason || ']'
    || CASE WHEN COALESCE(btrim(wa.notes), '') <> '' THEN ' ' || wa.notes ELSE '' END,
  wa.created_by,
  wa.created_at,
  false
FROM public.wip_adjustments wa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_transactions it
  WHERE it.notes LIKE '[backfill wip_adjustments:' || wa.id::text || ']%'
);
