## What's actually broken

Confirmed from the DB right now:
- `wip_ledger` rows: **0**
- `fg_inventory_log` rows: **0**
- `fg_inventory` rows with stock: **0**
- `roasted_batches` rows: **49**
- `packing_runs` rows: **102**
- `ship_picks` rows: **105**

The inventory **ledgers** are empty but the upstream transactional rows that produced those ledger entries still exist. That's the entire reason the Tech drawer persists, "Plan Blend Batches" surfaces phantom batches, and the Plan tab Data Orphans card shows the stuck `PLANNED` row from June 1.

## Why this happens (root cause)

The system has a strict invariant: every `roasted_batches`, `packing_runs`, and `ship_picks` row must correspond to a `wip_ledger` / `fg_inventory_log` entry. `dev_test_reset` enforces this by deleting all of them together in one transaction. But any other path that empties the ledgers — direct SQL in Supabase Studio, a partial Floor Count reset to zero, ad-hoc inventory zeroing, or an aborted reset — leaves the upstream batch/pack/pick rows behind. From the UI's perspective those rows are still "real" production events, even though the ledger says no kg ever moved. That's a ghost.

In this case: today's Tech "Plan Batches" created 5 component batches × 3 components = 15 ROASTED rows, plus older history. Then something cleared the ledgers without deleting the batches/runs/picks, leaving 49 phantom batches all pointing at zero inventory.

## Fix

### 1. New SQL helper + admin RPC

Add `public.dev_purge_ghost_production_rows()` — an ADMIN-only `SECURITY DEFINER` RPC that:
- deletes `ship_picks` rows whose `order_line_item_id` belongs to a closed order graph but have no matching `fg_inventory_log` SHIP entry
- deletes `packing_runs` whose `related_batch_id` produces no `wip_ledger` PACK_CONSUMED entry AND no `fg_inventory_log` PACK_PRODUCED entry
- deletes `roasted_batches` whose `id` appears in no `wip_ledger` row at all (no ROAST_PRODUCED, no PACK_CONSUMED, no BLEND_CONSUMED)
- returns a `jsonb` summary of counts deleted

Exposed in Admin Tools as a new button "Purge ghost production rows" alongside the existing reset buttons. Use the same confirm-text pattern.

### 2. New Plan tab orphan rule (Rule G — "Ghost batches")

In `PlanTab.tsx`, add a query that selects `roasted_batches` IDs and, for each, checks if any `wip_ledger` row references them via `related_batch_id`. Any batch with zero references is a ghost — list it under Data Orphans. This is what would have caught today's mess without the user having to inspect the database.

### 3. Inline actions on the Data Orphans card

Today the card is read-only. Add per-row buttons:
- **Rule D (stuck PLANNED >24h)**: "Delete batch" — confirms then deletes the `roasted_batches` row.
- **Rule F (over-picked)**: "Open order" (existing link stays, but make it a real button).
- **Rule G (ghost batch)**: "Purge" — deletes that single batch row.
- **All rows**: small "Dismiss" (×) that hides the orphan for this session via `sessionStorage` so the card can be cleared visually after a one-off fix without forcing a navigation.

After any delete, invalidate `plan-data-orphans`, `roast-tab-groups`, and `production-roast-groups` query keys so the Roast tab drawer disappears immediately.

### 4. One-time data cleanup

After the migration is approved, call `dev_purge_ghost_production_rows()` once via the insert tool to wipe the 49 ghost batches, 102 ghost packing runs, and 105 ghost picks in the current database. The Tech drawer will vanish on next render and "Plan Blend Batches" will show only real candidates.

### 5. Memory update

Save a `mem://technical/ledger-purge-invariant` note: "Never empty `wip_ledger` or `fg_inventory_log` without also deleting the upstream `roasted_batches` / `packing_runs` / `ship_picks` rows. Use `dev_test_reset` or `dev_purge_ghost_production_rows` — never raw SQL." Add a one-liner to the Core index.

## Files

- new migration: `dev_purge_ghost_production_rows` RPC
- `src/pages/internal/AdminTools.tsx` — add "Purge ghost rows" button
- `src/components/production/PlanTab.tsx` — add Rule G query, inline action buttons, session dismiss, invalidations
- `mem://technical/ledger-purge-invariant` + `mem://index.md` Core line

## Out of scope

- No changes to BlendExecuteModal, RoastTab, or RoastGroupDrawer logic. Those already behave correctly when their inputs are clean.
- Not touching the existing dev_test_reset RPC.
