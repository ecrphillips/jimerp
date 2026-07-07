# Remediation Plan

Follow-up to [AUDIT_REPORT.md](AUDIT_REPORT.md). This plan records what has already been fixed, what to fix next (with an approach for each), what needs investigation or a product decision, and what is deliberately parked. Triage reflects the owner's decisions on 2026-07-07.

**Testing caveat that applies to everything below:** database changes (migrations / RPCs) are deployed through Lovable and cannot be run or tested from a local checkout. Every migration in this plan must be deployed to a Supabase branch/staging and exercised by hand before it is trusted with real inventory or billing data. The code changes preserve existing tested logic wherever possible specifically to keep that risk low.

---

## Status board (resume here)

_Last updated 2026-07-07._

### ✅ Done — code merged to `main`
| Item | What | Deploy status |
|------|------|---------------|
| Fix 1 | Bounded ledger reads (`fetchAllRows`) — kills the 1000-row truncation/corruption | Live (frontend only, no deploy needed) |
| Fix 2 | Atomic `set_ship_pick` + `cancel_order_with_picks` RPCs | **Migration deployed + types regen'd.** Smoke-test still pending |
| N1 | Vancouver timezone in booking RPCs + member cancel countdown | ⚠️ **Migration `20260707130000` NOT yet deployed via Lovable** |
| N3 | Email queue honors unsubscribe (suppression choke point) | ⚠️ **`process-email-queue` edge function NOT yet redeployed via Lovable** |

### ⏳ Outstanding deploy actions (do these to finish what's already coded)
1. Deploy migration `20260707130000_1beff1af-...sql` (N1 booking timezone) via Lovable.
2. Redeploy the `process-email-queue` edge function (N3 unsubscribe) via Lovable.
3. Smoke-test Fix 2 on real data: pick/unpick a line (two tabs at once), cancel-return, cancel-writeoff, a bought-in line.

### 🔜 To do — not started (detail in "Fix next" below)
| ID | Item | Severity | Size | Notes |
|----|------|----------|------|-------|
| N2 | Multi-account / multi-role users locked out | High | Structural | **Do alone** — auth, high blast radius |
| N4 | Cancellation / no-show fees never billed | Medium | Simple | Do with N5 (billing-period math) |
| N5 | Two sources of truth for member hours | Medium | Structural | Reconcile H16 orphaned ledger rows first |
| N6 | Safer account delete (no cascade wipe) | Medium (was Critical) | Structural | Interim: make button deactivate-only |
| M7 | Custom cancellation windows ignored in UI | Medium | Simple | Member dialog still hardcodes 48h (noted in N1) |

### 🔍 Investigate before coding
| ID | Item | Notes |
|----|------|-------|
| I1 | Green-coffee yield-loss model (C4/H7/H8/M17) | Needs a modelling decision; do before wiring upstream green modules |
| Q1 | Server-side order constraints ($0 / disallowed products) | Needs allowed-product rules expressed in SQL |
| Q2 | Duplicate billing periods | Fold into the N4/N5 billing work — one canonical period RPC |
| Q3 | Shopify duplicate orders + schema drift (H17/H18) | Schema catch-up first; needed before the new-project migration |

### 🅿️ Parked (owner decision)
MCP `run_read_query` (C1), QBO token encryption (M1), in-app billing beyond the above, and the remaining Medium/Low items in AUDIT_REPORT.md.

### Follow-ups to work already done
- Fix 1 perf: move summation server-side (aggregate RPCs) — removes the "re-download whole ledger on every write" cost.
- Fix 2: an atomic `create_order` RPC (order + shipments + line items) for the H4 non-atomic order-create path, plus recurring-booking and invite-flow atomicity.

### Suggested next session
Deploy the two pending items above, smoke-test Fix 2, then start **N2** on its own branch (it's the risky one — isolate it). After that, the **N4 + N5 + Q2** billing cluster together.

---

## Done in this pass

### Fix 1 — Client-side aggregation of unbounded tables (was Critical C2 + the scaling reads)
**Problem:** Balances and demand were computed by downloading an entire ever-growing table to the browser and summing it. Supabase silently caps each response at 1,000 rows, so past that point every inventory number was wrong — and floor counts wrote the wrong balance back into the ledger, corrupting it permanently.

**What was done:** Added a paginated-fetch helper, [`src/lib/fetchAllRows.ts`](src/lib/fetchAllRows.ts), that pages past the 1,000-row cap with an advancing range window and concatenates all rows, using a stable sort so page boundaries don't shift. Applied it to every whole-table aggregation read, starting with the corruption-critical balance path:
- [`src/hooks/useAuthoritativeInventory.ts`](src/hooks/useAuthoritativeInventory.ts) — WIP ledger, FG ledger, ship-picks, roasted-batches, open/confirmed order lines.
- [`src/hooks/useInventoryLedger.ts`](src/hooks/useInventoryLedger.ts) — WIP and FG balance sums.
- [`src/pages/internal/Inventory.tsx`](src/pages/internal/Inventory.tsx) — the WIP floor-count baseline read and the "last counted" read (the reads whose truncation caused the write-back corruption).
- The production-tab and dashboard demand/gating reads (Roast/Ship/Pack/Plan tabs, dashboard metrics, orders list, blend modals, green-lot depletion, blend readiness, roast-group WIP section). The FG inventory tab needed no change — its on-hand read already flows through the now-fixed `useAuthoritativeFg` hook.

This preserves the existing, unit-tested reducer math exactly; the only behavioural change is "no longer truncated at 1,000 rows." **It fixes correctness, not throughput** — every row is still transferred and summed in the browser.

**Recommended follow-up (perf, structural — was Low L1):** move the summation into the database. Add read-only aggregate RPCs/views — `authoritative_wip()` returning per-`roast_group` sums of `ROAST_OUTPUT / PACK_CONSUME_WIP / BLEND / ADJUSTMENT / LOSS`, and `authoritative_fg()` returning per-`product_id` sums of `PACK_PRODUCE_FG / SHIP_CONSUME_FG / ADJUSTMENT` — and have the hooks read those instead of raw rows. Keep the pure reducers (`computeAuthoritativeWip` / `computeAuthoritativeFg`) as the unit-test oracle: a test that feeds the same fixture rows through both the reducer and the SQL and asserts equality guards the port. This also removes the realtime "re-download the whole ledger on every write" cost (audit L1) because each refetch becomes a small aggregate.

### Fix 2 — Non-atomic ledger writes (was High H2 ship-pick, H3 cancel-with-picks)
**Problem:** Two inventory paths wrote in several separate steps and could double-count or diverge:
- Recording a pick upserted `ship_picks` to an absolute value, then separately inserted a `SHIP_CONSUME_FG` row for a delta computed from a browser cache up to 10s stale — two pickers, or one double-click, both computed the delta from the same baseline and consumed FG twice.
- Cancelling an order with picks wrote the FG-return rows, zeroed the picks, and set status in three calls — a mid-way failure credited FG while leaving the order live.

**What was done:** Added [`supabase/migrations/20260707120000_89c4ede1-...sql`](supabase/migrations/20260707120000_89c4ede1-ab74-4159-b6f3-0e33ad2a8bdc.sql) with two `SECURITY DEFINER` RPCs mirroring the proven `update_packing_units` pattern:
- `set_ship_pick(order_id, order_line_item_id, units_picked)` — reads the previous pick count under an advisory lock, upserts the pick, and writes the `SHIP_CONSUME_FG` delta atomically. `requires_production` and order status are resolved server-side, so a stale client can't cause a double-consume.
- `cancel_order_with_picks(order_id, mode)` — reads the outstanding picks server-side, reverses the FG ledger (`return` re-enters stock; `writeoff` re-enters then records a loss), zeroes the picks, and delegates the status change to `update_order_status` (so transition validation **and** the audit-log row happen as on every other status change — closing the audit gap the old path had). Only `requires_production` products touch the FG ledger, matching how consumption was written.

Frontend rewired to call the RPCs: [`src/components/production/SortableShipCard.tsx`](src/components/production/SortableShipCard.tsx) and [`src/pages/internal/OrderDetail.tsx`](src/pages/internal/OrderDetail.tsx).

**Deploy checklist before trusting:** deploy the migration; regenerate `src/integrations/supabase/types.ts` (the RPCs are called with an `as any` cast until then); then test on staging — concurrent picks on one line, a double-click pick, an unpick, cancel-return and cancel-writeoff, and a bought-in (non-production) line to confirm it is zeroed without a phantom FG credit.

---

## Fix next

Ordered by the owner's priority. Each is independent.

### N1 — UTC-vs-Vancouver timezone math (High) — ✅ DONE (deploy pending)
Fixed in migration `20260707130000_1beff1af-...sql` (redefines `create_member_booking` + `cancel_member_booking` to use a Vancouver calendar "today" and a Vancouver wall-clock booking start) and in [`src/pages/member/MemberSchedule.tsx`](src/pages/member/MemberSchedule.tsx) (cancellation countdown now interprets the booking as Vancouver-local via `fromZonedTime`). Deploy the migration via Lovable to activate. Note: the member dialog's `canCancel` still hardcodes 48h — the custom-cancellation-window fix (audit M7) is deliberately left for a later pass.

<details><summary>Original entry</summary>


**Why it matters:** the booking RPCs build timestamps from stored Vancouver wall-clock times but evaluate them in the server's UTC timezone, so the 48-hour cancellation cutoff fires ~7–8 hours early and, because "today" is computed in UTC, every evening after ~4–5 PM Pacific the system thinks it's tomorrow (same-day bookings rejected as "in the past", next-morning cancellations blocked).
**Approach:** new migration re-creating `create_member_booking` and `cancel_member_booking` (latest defs in `20260603174431`) to evaluate date/time as `(booking_date + start_time) AT TIME ZONE 'America/Vancouver'` and to use a Vancouver-local "today" instead of `CURRENT_DATE`. Align the member-portal display in [`src/pages/member/MemberSchedule.tsx`](src/pages/member/MemberSchedule.tsx) to the same timezone (it currently uses the browser's). The correct helpers already exist in [`src/lib/timezone.ts`](src/lib/timezone.ts) — the RPCs and this screen are the outliers.
**Effort:** simple fix (localized SQL + one screen). **Risk:** medium (SQL, needs staging test across an evening boundary).
</details>

### N2 — Multi-account / multi-role users get locked out (High)
**Why it matters:** the auth resolution, post-login landing, and set-password flow assume exactly one `user_roles` / `account_users` row and query with single-row expectations. The first time a user belongs to a second account (or holds two roles) those queries error and the user is shown "account pending" or dropped into the wrong portal with permissions defaulted off.
**Approach:** in [`src/contexts/AuthContext.tsx`](src/contexts/AuthContext.tsx), [`src/pages/AuthCallback.tsx`](src/pages/AuthCallback.tsx), and [`src/pages/SetPassword.tsx`](src/pages/SetPassword.tsx), replace the single-row assumptions with a deterministic choice (order + `.limit(1)`, or return all rows and pick by a documented precedence) and, where a user legitimately has several accounts, surface an account picker. Decide the precedence rule (e.g. ADMIN > OPS > CLIENT for role; most-recently-active account) before coding.
**Effort:** structural (touches core auth). **Risk:** medium-high — auth regressions are high-blast-radius; test every portal's login.

### N3 — Order confirmation/status emails ignore the unsubscribe list (High) — ✅ DONE (deploy pending)
Fixed at the single choke point: [`supabase/functions/process-email-queue/index.ts`](supabase/functions/process-email-queue/index.ts) now checks `suppressed_emails` before sending any `transactional_emails` message (fail-closed on a check error; suppressed messages are logged and dropped from the queue). Auth emails (password resets, magic links) are deliberately never suppressed. This covers confirm-order-email, notify-order-event, and every other path that enqueues transactional mail. Redeploy the edge function via Lovable to activate.

### N4 — Cancellation / no-show fees recorded but never billed (Medium)
**Why it matters:** the admin UI stamps `cancellation_fee_amt` on charged-cancellation and no-show bookings but the billing page never reads it, so those fees are silently uncollected. No-show is inconsistent the other way (hours count *and* a fee is stamped).
**Approach:** in [`src/pages/internal/CoRoastBilling.tsx`](src/pages/internal/CoRoastBilling.tsx) add an invoice line derived from `cancellation_fee_amt` for the period, and pin down the no-show rule (fee **or** billed hours, not both) so a future change can't double-charge. Coordinate with N5 — both touch how a period's total is assembled.
**Effort:** simple fix. **Risk:** low-medium (billing numbers; reconcile against QBO, which is the source of truth today).

### N5 — Two sources of truth for member hours (Medium)
**Why it matters:** every displayed hour balance is computed by summing booking durations, while the hour ledger (which has manual-credit / manual-debit entry types) is used only as an audit trail — so an admin's goodwill manual credit changes no balance and no invoice. Meanwhile edit-times writes ledger entries *and* changes booking times, so any future switch to summing the ledger would double-count.
**Approach:** choose one source of truth for net hours. Recommended: make the **ledger** authoritative (sum `hours_delta`), since it already has the right entry types and sign convention, then ensure every balance/invoice reads the ledger and remove the double-write from edit-times. This is a structural change and should land with N4 (both are billing-period math). First reconcile the orphaned-attribution bug (audit H16 — admin cancel refunds written with null owner) or the ledger sum will be wrong.
**Effort:** structural. **Risk:** medium (billing correctness; needs a data-backfill audit of existing ledger rows).

### N6 — Account hard-delete cascades away billing history (was Critical C3; owner: not urgent but soon)
**Why it matters:** deleting an account cascades into all of its bookings, billing periods, hour-ledger, and invoices, and orphans its orders/products — one mis-click destroys financial history.
**Approach:** mirror the existing `delete_client_safe` pattern for accounts: a guarded RPC that refuses (or archives) when dependent financial rows exist, plus a "deactivate" path as the default. Replace the raw delete in [`src/pages/internal/Accounts.tsx`](src/pages/internal/Accounts.tsx). Until then, an interim mitigation is to change the button to deactivate-only.
**Effort:** structural. **Risk:** low to build, high value.

---

## Investigate before fixing

### I1 — Green-coffee yield-loss accounting (was Critical C4; owner: outside MVP, investigate before connecting upstream modules)
This is one systemic input-vs-output confusion, not four separate bugs, and it needs a modelling decision before any code changes:
- `mark_batch_roasted` subtracts the **roasted output** kg from the green lot, but roasting loses ~16% so ~19% more green is actually consumed — green stock is overstated every roast (audit C4).
- `planned_output_kg` means "green input" in some code paths and "roasted output" in others, so planned coverage, roast suggestions, and depletion warnings disagree by ~16–19% (audit H8).
- Reverting a roasted batch never restores the green lot, so re-roasting double-deducts (audit H7).
- The loss-path roast consumes no green lot at all (audit M17).
**What to decide first:** a single definition for each stored quantity (is `planned_output_kg` green-in or roasted-out?), where the yield factor lives (`roast_groups.expected_yield_loss_pct`?), and whether green depletion should be driven off actual green-weighed consumption rather than back-computed from output. Once the model is agreed, fix `mark_batch_roasted`, `revert_batch_to_planned`, the loss path, and the three frontend consumers in lockstep. Do this before wiring green sourcing to any upstream/automated module, or the drift compounds silently.

---

## More info requested

### Q1 — "A client can order $0 disallowed products through the API" (audit H6)
**What this is:** the app validates orders (allowed products, case sizes, positive quantities, real prices) **only in the browser**. At the database level, the row-level-security policy on `order_line_items` (migration `20260503173200`) lets a client insert/update line items on their own DRAFT/SUBMITTED orders with **any** `unit_price_locked`, **any** `quantity_units`, and **any** `product_id` — there is no DB check that the price is real, the quantity is positive, or the product is one that client is allowed to buy. `validate-order-constraints` exists but is advisory: it only runs when the UI chooses to call it.
**Why it's exploitable:** anyone with a client login has the Supabase anon key and their own JWT (both visible in the browser). They can call the PostgREST/`supabase-js` API directly — bypassing your React UI entirely — and insert a line item for a restricted product at `unit_price_locked = 0`, or a negative/huge quantity. The order then flows into production and billing looking legitimate. Client order cancellations also skip the audit log for the same "UI-only" reason.
**How likely, realistically:** requires an intentional, somewhat technical client (not an accidental mis-click). For a small known B2B customer base the odds are low today, but the exposure is real and grows with every client account. It's the kind of thing that's fine until it isn't.
**To fix (when you choose to):** enforce the constraints at the database — a `CHECK (quantity_units > 0)`, a trigger (or tightened RLS `WITH CHECK`) that validates `unit_price_locked` against the current `price_list` for that client/product and rejects products not on the client's allowed list, and route client cancellations through an RPC that writes the audit log. Structural; needs the allowed-product rules expressed in SQL.

### Q2 — "Duplicate billing periods" (audit H13)
**What this is:** a co-roast billing period (one row per account per month, holding that month's included hours / overage rate / base fee) can be created by three different code paths that don't coordinate: the `_get_or_create_billing_period` database function, the booking dialog, and an auto-create effect on the billing page. The unique constraint that should stop duplicates is defeated because new rows leave the legacy `member_id` column null (the constraint is on `member_id`, not the `account_id` actually used).
**How a duplicate happens:** two admins open the billing page in the same minute, or a member books at the same time an admin has the billing page open. Both paths check "does a period exist?", both see none (or don't see each other's uncommitted row), and both insert. Now the account has two period rows for the same month.
**Why it bites:** downstream lookups take "the" period with a `find(...)` / `LIMIT 1`, so that month's hours and invoice lines split across the two rows — the invoice under-counts usage, and which row "wins" depends on timing. There's also a related bug (H14) where the rate stamped on the period depends on **which path created it first** (the DB function ignores per-account negotiated rates and proration; the admin paths apply them).
**To fix (when you choose to):** one canonical creation path — a single RPC that does `INSERT ... ON CONFLICT DO NOTHING` against a **working** unique index on `(account_id, period_start)`, resolves per-account rate overrides and proration in that one place, and is the only thing any code (member or admin) calls. Add the unique index first, then point all three paths at the RPC. Structural.

### Q3 — "Shopify sync can create duplicate orders" (audit H17)
**What this is:** the scheduled Shopify pull (daily 6 AM) imports Shopify orders and bundles them into internal orders. Its dedupe is "check whether we already imported this, then — much later — insert the order, its shipment, line items, and the bundle links" as separate un-transacted steps.
**Two ways it duplicates:**
1. **Concurrency:** if a manual pull runs while the cron runs (or two admins trigger it), both pass the "already imported?" check before either finishes writing, and both create full duplicate internal orders. Even a unique constraint on the bundle-link table wouldn't save you cleanly — it fires only at the *last* step, after the duplicate order and line items are already committed, and the error path doesn't delete them.
2. **Partial failure:** if the final bundle-link insert fails after the order is already inserted, the dedupe table has no record that this Shopify order was consumed — so the **next** run re-imports the same Shopify orders into a second internal order. That means double roasting and double packing for real customer orders.
**Compounding risk (H18):** the Shopify tables in your migrations don't match the live database — the real table shape was applied out-of-band and exists in no migration file. So you currently can't even confirm from the code whether the dedupe unique constraint exists on the live table, and a rebuild onto the new Supabase project (`dltpuuuhtbwufadecpfy`, per project notes) would recreate the *wrong* shape and break the sync on first insert.
**To fix (when you choose to):** (a) write a catch-up migration matching the live Shopify schema so the migrations are the source of truth again and the dedupe constraint is guaranteed present; (b) make the pull idempotent — a per-source run-guard/advisory lock so two runs can't overlap, and write the dedupe record atomically **with** the order (same transaction / RPC), so a partial failure can't leave an order that the next run re-imports. Structural; do the schema-drift catch-up first since it also unblocks the project migration.

---

## Parked (by owner decision)

| Item | Audit ref | Reason parked | Note |
|------|-----------|---------------|------|
| MCP `run_read_query` reads whole DB | C1 | Only the owner has Lovable backend access; app users don't | Revisit if any non-owner ever gets Lovable/project access, or before exposing the MCP endpoint more widely |
| In-app billing math (broad) | C3-adjacent, various | Billing is outside MVP; QBO is the invoicing source of truth today | The app currently just aggregates data to key into QBO; N4/N5/N6/Q2 are the pieces worth doing sooner anyway |
| QuickBooks tokens stored in plain text | M1 | Park for next phase | Encrypt at rest reusing the existing Shopify crypto helpers when QBO work resumes |
| Remaining Medium/Low items | M2–M21, L-series | Not prioritized this pass | Still catalogued in AUDIT_REPORT.md; pull forward individually as needed |

---

## Suggested sequence

1. **N3** (unsubscribe) and **N6-interim** (deactivate-only button) — smallest, highest safety-per-effort, no schema risk.
2. **N1** (timezone) — self-contained, high daily-annoyance payoff; test across an evening boundary on staging.
3. **N2** (multi-account auth) — do carefully and alone; auth regressions are high-blast-radius.
4. **Q2 + N4 + N5** together — they all touch billing-period assembly; design the one canonical period RPC once and land the fee/hours changes on top.
5. **N6-full**, then **Q3** (Shopify schema catch-up + idempotency, needed before the project migration), then **I1** (green model) and **Q1** (server-side order constraints) as the larger structural pieces.
6. Circle back to the **Fix 1 server-side aggregation** and **Fix 2 order-create RPC** follow-ups when throughput or the next data-integrity pass warrants.
