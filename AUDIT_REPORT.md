# Codebase Audit Report

**Repository:** jimerp — lite ERP for Home Island Coffee Partners
**Date:** 2026-07-06
**Scope:** Read-only audit. No code was modified. Findings cover bugs and broken logic that exist right now, plus things that work today but will break or slow down as usage grows.

---

## Summary

This audit found a codebase that is thoughtfully built in its core financial and access-control logic (pricing uses precise decimal math, most edge functions gate on role, OAuth flows use CSRF/HMAC protection, and several inventory operations were correctly moved into atomic database procedures) but that carries a set of serious, mostly-latent risks. The single most important theme is that **many screens read entire ever-growing tables into the browser and add them up there**. Supabase silently returns at most 1,000 rows, so the day a ledger, order list, or booking table crosses that line, inventory balances, production demand, and calendars start showing wrong numbers with no error — and in the inventory case, those wrong numbers get written back into the ledger as "corrections," permanently corrupting the books. A second theme is **non-atomic multi-step writes** (orders, picks, cancellations, invites, billing periods) that leave records half-created when any step fails or when two people act at once. A third is **timezone math** that treats a British Columbia business as if it were on UTC, which already misfires every evening. There is also one urgent access-control hole: an internal database-query tool that any logged-in user can call to read the entire database, bypassing all row-level security. Counts below.

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 20 |
| Medium | 21 |
| Low | 10 |
| **Total** | **55** |

A note on overlap: several problems were independently found by more than one part of the audit (the 1,000-row ledger truncation, the ship-pick race, the future-dated-price bug, the booking double-book race, the billing-period race, and the timezone bugs). Those are consolidated into single findings below.

---

## Critical

### C1. Any logged-in user can read the entire database, bypassing all security
**What's wrong:** The internal query tool (`run_read_query`) exposed by the MCP edge function runs arbitrary read-only SQL using the all-powerful service-role connection and never checks who is calling it. The only gate is "are you logged in at all," which any client or co-roast member satisfies. Because the underlying database function runs as the table owner, it ignores row-level security and the special locks that normally hide secret columns. A non-admin could read every tenant's orders, pricing, and billing details, plus the plaintext QuickBooks access/refresh tokens and Shopify API tokens. The keyword blocklist only prevents writes; it does nothing to limit reads.
**Where:** `supabase/functions/mcp/index.ts` (the `run_read_query` handler) and `src/lib/mcp/tools/run-read-query.ts`; auth config in `src/lib/mcp/index.ts`; the database function in migration `20260706191627_*.sql`.
**Severity:** Critical · **Category:** Broken now · **Fix:** Simple fix (add an admin-role check before using the service connection, or remove the tool).

### C2. Inventory balances silently go wrong past 1,000 ledger rows — and then corrupt themselves
**What's wrong:** Every WIP and finished-goods balance in the app is calculated by downloading the *entire* inventory-transactions ledger to the browser and summing it, with no limit or pagination. Supabase caps each response at 1,000 rows and drops the rest with no error. A working roastery writes several ledger rows per pack/roast/pick/ship, so this table crosses 1,000 rows within weeks to months. Once it does, the oldest rows vanish from the sum and every inventory number in the app becomes wrong. The failure then compounds: floor-count screens compute an adjustment as "counted amount minus current balance," and since the current balance is now wrong, the adjustment written into the ledger is wrong too — turning a display bug into permanent, self-reinforcing corruption of the inventory books. The same unbounded-fetch pattern feeds roast demand, blend reservations, and the dashboard.
**Where:** `src/hooks/useAuthoritativeInventory.ts`, `src/hooks/useInventoryLedger.ts`, `src/pages/internal/Inventory.tsx`, and consumers across the production tabs.
**Severity:** Critical · **Category:** Scaling risk (becomes a correctness bug at 1,000 rows) · **Fix:** Structural change (compute balances with a database view/procedure that sums server-side; ideally keep a running-balance table).

### C3. Deleting an account instantly destroys all of its booking and billing history
**What's wrong:** The Accounts page deletes an account with a raw delete behind a generic "this cannot be undone" dialog. The database is configured to cascade that delete into all of the account's co-roast bookings, billing periods, hour-ledger entries, invoices, and user links, and to orphan its orders and products. One mis-click by an admin wipes out an account's entire financial history with no preflight check and no safer "deactivate" path — even though the Clients page already has a careful guarded-delete procedure that this page ignores.
**Where:** `src/pages/internal/Accounts.tsx` (delete mutation); cascade rules in migration `20260310211937_*.sql`.
**Severity:** Critical · **Category:** Broken now · **Fix:** Structural change (mirror the existing safe-delete/deactivate pattern used for clients).

### C4. Green coffee inventory ignores roasting weight loss, so green stock is overstated on every batch
**What's wrong:** When a batch is marked roasted, the system subtracts the *roasted* output weight from the green coffee lot. But roasting burns off roughly 16% of the green weight, so the actual green consumed is about 19% more than the output. Every single roast therefore leaves phantom green coffee on the books; lots read as available long after the bags are physically empty, until a floor count violently corrects them. This is a systemic units confusion (see also H8/H9) that touches multiple code paths, each computing a different answer.
**Where:** `supabase/migrations/20260615222112_*.sql` (`mark_batch_roasted`); interacts with `src/hooks/useGreenLotDepletion.ts` and `src/components/production/RoastTab.tsx`.
**Severity:** Critical · **Category:** Broken now · **Fix:** Simple fix (divide by the yield factor inside the roast procedure), but requires reconciling the related units bugs together.

---

## High

### H1. Two people can book the same roaster slot at the same time
**What's wrong:** Booking checks for an overlapping booking and then inserts, with no lock or database exclusion constraint between the two steps. Two members (or a member and an admin) submitting overlapping times at the same moment both pass the check and both succeed, double-booking the single roaster and writing two hour-ledger charges. The codebase already uses advisory locks for exactly this reason on the inventory side; bookings never got that treatment.
**Where:** `create_member_booking` in migration `20260603174431_*.sql`; admin path in `src/components/bookings/BookingFormDialog.tsx`.
**Severity:** High · **Category:** Broken now (probability rises with member count) · **Fix:** Structural change (database exclusion constraint or advisory lock).

### H2. Ship-pick recording can double-count finished goods
**What's wrong:** Recording picked units writes the absolute pick count to one table, then separately writes a "consume this much finished goods" ledger entry computed as new-minus-previous, where "previous" comes from a browser cache that can be up to 10 seconds stale. Two people picking the same line (or one person clicking twice before the cache refreshes) both compute the change from the same old baseline, so the ledger records the consumption twice while the pick table records it once — permanently understating finished-goods stock. If the ledger write fails after the pick write succeeds, the two diverge with no rollback. The packing side was already fixed with an atomic procedure; the pick side was not.
**Where:** `src/components/production/SortableShipCard.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (move pick + ledger into one server-side procedure that computes the change under a lock).

### H3. Cancelling an order with picks can double-credit stock or leave the order live
**What's wrong:** Cancelling an order that already has picks does three separate writes: add "return to stock" ledger rows, zero out the picks, then set the status to cancelled. If the status change fails, the coffee has already been returned to stock and the picks zeroed, but the order is still active — and retrying the cancel finds no picks (already zeroed), so it "succeeds" cleanly while finished-goods stock stays permanently inflated. A retry after an earlier partial failure can also credit the stock twice.
**Where:** `src/pages/internal/OrderDetail.tsx` (cancel-with-picks mutation).
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (one transactional procedure).

### H4. Creating an order is three separate writes with no transaction
**What's wrong:** Both the client and internal order-creation flows insert the order, then its shipment, then its line items as separate requests. If the shipment or line-item write fails, the error message says "failed to submit," but the order row already exists — a sequence-numbered, empty phantom order that lands on the internal work list and draws ops attention, while the client, seeing a failure, resubmits and creates a duplicate. Quote duplication has the same non-transactional shape.
**Where:** `src/pages/client/NewOrder.tsx`, `src/pages/internal/CreateOrderForClient.tsx`, `src/pages/internal/Quotes.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (single create-order procedure).

### H5. The order-edit screen bypasses the status rules entirely
**What's wrong:** The order-edit modal writes the status field with a raw update and offers all seven statuses in a dropdown, skipping the procedure that enforces which transitions are legal, records an audit-log entry, and maintains the "shipped/ready" flag. An admin can jump an order from shipped back to draft, resurrect a cancelled order, or leave the shipped flag stuck on after reverting — with no audit trail. The state machine is enforced only inside the procedure; nothing stops a direct update.
**Where:** `src/components/internal/OrderEditModal.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (route status changes through the procedure, or add a database trigger).

### H6. A client can place orders for disallowed products at $0 through the API
**What's wrong:** Order validation (allowed products, case sizes, quantities, prices) is only performed voluntarily by the UI. At the database level, the row-level-security policy lets a client insert or update line items on their own draft/submitted orders with any locked price and any quantity — there is no check that the price is real, the quantity is positive, or the product is permitted for that client. A client hitting the API directly can order restricted products at zero dollars. Client cancellations also bypass the audit log.
**Where:** RLS policy in migration `20260503173200_*.sql`; advisory-only `supabase/functions/validate-order-constraints/index.ts`; `src/pages/client/OrderHistory.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (enforce constraints and price integrity in the database).

### H7. Reverting a roasted batch never gives the green coffee back
**What's wrong:** Marking a batch roasted subtracts green coffee from its lot. Reverting the batch to planned reverses the WIP side but does *not* restore the green lot or remove the green-consumption record. When the batch is re-roasted (the normal flow after fixing a typo), the lot is deducted a second time. Every revert-and-redo permanently understates green stock by one batch.
**Where:** `revert_batch_to_planned` in migration `20260615222112_*.sql`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (reverse the lot consumption inside the revert procedure).

### H8. "Planned output" means two different things in two halves of the app
**What's wrong:** One set of code treats a batch's planned quantity as the green coffee going *in* (and multiplies down by yield loss to get output); another set treats the same field as the roasted quantity coming *out* (and multiplies it *up* to project green use, using arithmetic that is itself wrong). A third path sums it directly as planned WIP. The result is that planned coverage, roast suggestions, and green-depletion warnings each disagree by roughly 16–19% for the same batch. This is the same root confusion as C4/H7.
**Where:** `src/components/production/RoastTab.tsx`, `src/hooks/useAuthoritativeInventory.ts`, `src/hooks/useGreenLotDepletion.ts`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (pick one meaning for the field and fix all consumers together).

### H9. The "packed" indicator on the orders list is wrong for almost every repeat product
**What's wrong:** The orders list decides whether a line is fully packed by summing *all packing ever done* for that product across *all orders*, then comparing to the one order's quantity. So any product that has ever been packed in bulk shows every later order for a smaller amount as already packed — the progress bars and deadline health are wrong for essentially all repeat products. It also downloads the entire packing-runs table on every visit to the orders page.
**Where:** `src/pages/internal/Orders.tsx`.
**Severity:** High · **Category:** Broken now (plus scaling) · **Fix:** Structural change (derive pack status per order).

### H10. The order detail screen checks packing against the wrong date, so fully-packed orders look unpacked
**What's wrong:** The order detail page decides pack completeness by looking for packing runs dated to the order's requested ship date, but the packing screen records runs dated to the actual production day. Unless those happen to match, the order shows zero packed, so the mark-shipped/mark-ready flow always throws an "incomplete fulfillment" warning even for fully-packed orders — training staff to click through warnings. Orders with no requested ship date get an empty result too. The roasted-inventory card has the same date mismatch.
**Where:** `src/pages/internal/OrderDetail.tsx` vs `src/components/production/PackTab.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (derive from the ledger/picks, not date-matched packing runs).

### H11. Future-dated prices take effect immediately
**What's wrong:** Every price lookup takes the newest price row per product without checking that its effective date has actually arrived. The moment an admin saves a price scheduled for next month, all new orders lock in that future price. Locked prices have the mirror-image bug: a future start date is never checked, so a scheduled future price applies now.
**Where:** `src/pages/client/NewOrder.tsx`, `src/pages/internal/CreateOrderForClient.tsx`, `src/components/internal/OrderEditModal.tsx`, `src/pages/internal/Pricing.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (only consider prices whose effective date is today or earlier).

### H12. A blank price field silently creates a $0.00 price
**What's wrong:** In the new-product modal, leaving the price blank inserts a real $0.00 price row for every variant rather than "no price set." Order screens then treat zero as a genuine price with no warning, so orders bill nothing without anyone noticing. Negative prices are accepted too. Order forms separately save missing prices as $0 locked prices by design, compounding the silent underbilling.
**Where:** `src/components/products/NewSingleOriginProductModal.tsx`; order flows in `NewOrder.tsx` and `CreateOrderForClient.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (treat blank as "no price" and reject non-positive prices).

### H13. Duplicate billing periods from three racing creation paths
**What's wrong:** A billing period can be created by a database procedure, by the booking dialog, and by an auto-create effect on the billing page — none of which coordinate, and the unique constraint that should stop duplicates is defeated because new rows leave the old member-id column null. Two admins opening the billing page in the same minute, or a member booking while an admin has the page open, produces two billing periods for the same account and month, and later lookups split that account's hours and invoices across the two.
**Where:** `_get_or_create_billing_period` in migration `20260514094701_*.sql`; `src/components/bookings/BookingFormDialog.tsx`; `src/pages/internal/CoRoastBilling.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (one canonical creation path with a working unique constraint).

### H14. Billing period rates depend on who creates the period first
**What's wrong:** When a billing period is created by the database procedure it copies the standard tier rates, ignoring per-account negotiated overrides and mid-month proration. When it is created by the admin billing paths it applies those overrides and proration. Whichever fires first in a month wins, with no reconciliation — so a member with a negotiated overage rate who self-books on the 1st gets billed at the standard rate for that whole month.
**Where:** migration `20260514094701_*.sql` vs `src/pages/internal/CoRoastBilling.tsx` and `src/components/bookings/BookingFormDialog.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Structural change (single period-creation procedure that resolves overrides and proration).

### H15. Cancellation cutoffs and same-day rules fire hours early because the server runs on UTC
**What's wrong:** The booking procedures build timestamps from stored Vancouver wall-clock times but evaluate them in the server's UTC timezone. A 10 a.m. booking is treated as 10 a.m. UTC (about 2–3 a.m. Pacific), so the 48-hour free-cancellation cutoff engages roughly 7–8 hours early — a member 50 hours out is told "cannot cancel within 48 hours." Because "today" is also computed in UTC, every evening after ~4–5 p.m. Pacific the system thinks it is tomorrow, so same-day bookings are rejected as "in the past" and next-morning cancellations are blocked. The correct timezone helpers exist elsewhere in the code; the procedures don't use them.
**Where:** `cancel_member_booking` / `create_member_booking` in migration `20260603174431_*.sql`; also `src/pages/member/MemberSchedule.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (evaluate dates/times in the Vancouver timezone).

### H16. Admin cancellation refunds are written with no owner, so they're invisible and unbalanced
**What's wrong:** Account-era bookings carry only an account id, not the old member id. But the admin cancellation flows write their hour-refund and waiver entries tagged with the (null) member id and no account id, so those refund rows land with no owner at all. The account's ledger view and the member's own view both filter by account id, so these refunds are invisible to everyone, and any per-account total of hours overstates usage. A sibling mutation in the same file was already fixed to write the account id; the cancellation paths were missed. The same lookup also shows account-era bookings as an "Unknown" member and falls back to the base tier rate when computing cancellation fees for higher tiers.
**Where:** `src/components/bookings/BookingDetailModal.tsx`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (write the account id on these rows).

### H17. Shopify order sync can create duplicate orders
**What's wrong:** The Shopify pull checks whether an order was already imported and then, much later, inserts the order, shipment, line items, and bundle links as separate un-transacted steps. Two overlapping runs (a manual trigger during the 6 a.m. cron, or two admins) both pass the check and both create full duplicate orders. And if the final bundle-link step fails after the order is already inserted, the dedupe table has no record of it, so the next run re-imports the same Shopify orders into a second internal order — double roasting and packing.
**Where:** `supabase/functions/shopify-pull-orders/index.ts`.
**Severity:** High · **Category:** Broken now (latent) · **Fix:** Structural change (run-guard/lock plus writing the dedupe record atomically with the order).

### H18. Shopify tables in the migrations don't match the live database
**What's wrong:** The only migration that creates the Shopify bundle-source table defines completely different columns and a different unique constraint than the live table the sync code actually writes to — the real shape was applied out-of-band and exists in no migration file. Today this means you cannot confirm from the code whether the dedupe constraint that finding H17 depends on even exists. Soon it means the in-progress rebuild onto the new Supabase project will recreate the *old* shape from migrations and the Shopify sync will fail on its first insert. (A related column, `source_batch_id` on inventory transactions, is also used in code but appears in no migration — the same drift.)
**Where:** migration `20260513130000_*.sql` vs the live schema and `supabase/functions/shopify-pull-orders/index.ts`.
**Severity:** High · **Category:** Broken now (drift; blocks the project migration) · **Fix:** Simple fix (write catch-up migrations matching the live schema).

### H19. Users who belong to more than one account (or hold two roles) get locked out
**What's wrong:** A user can legitimately hold two roles or belong to several accounts, but the auth resolution, the post-login landing logic, and the set-password flow all assume exactly one row and query with single-row expectations. The first time a franchisee user is added to a second account, those queries error and the user is shown "account pending / no role assigned" or dropped into the wrong portal with all account permissions defaulted off.
**Where:** `src/contexts/AuthContext.tsx`, `src/pages/AuthCallback.tsx`, `src/pages/SetPassword.tsx`.
**Severity:** High · **Category:** Scaling risk · **Fix:** Structural change (deterministically pick a row or support account selection).

### H20. Order confirmation and status emails ignore the unsubscribe list
**What's wrong:** The order-confirmation and order-status emails are queued straight to client recipients with only notification-preference filtering; they never consult the suppressed-address list, and the queue processor doesn't check it at send time either. A client who unsubscribed keeps receiving order emails, breaking the unsubscribe promise. (The general notification path and transactional-email function do check suppression — these two order paths don't.)
**Where:** `supabase/functions/confirm-order-email/index.ts`, `supabase/functions/notify-order-event/index.ts`.
**Severity:** High · **Category:** Broken now · **Fix:** Simple fix (apply the suppression filter before queueing, or in the queue processor).

---

## Medium

### M1. QuickBooks tokens are stored in plain text
**What's wrong:** QuickBooks access and refresh tokens sit in the database as plain text, unlike Shopify tokens, which are encrypted at rest with the existing crypto helpers. Row-level security keeps them out of normal reads, but any direct-read path (including the C1 hole, a service-role leak, or a database backup) yields immediately usable, long-lived Intuit credentials.
**Where:** migration `20260611130000_*.sql`; helpers in `supabase/functions/_shared/quickbooks.ts`.
**Severity:** Medium · **Category:** Broken now (latent) · **Fix:** Structural change (reuse the existing encryption).

### M2. Billing period creation can hit a type error on a clean database
**What's wrong:** The billing-period procedure combines a text tier column with an enum default in a way Postgres rejects at runtime ("types cannot be matched"). A sibling function was already patched for this exact error; this one wasn't. It only runs when a member books into a month whose period doesn't yet exist (usually pre-created by admins, which masks it), but a clean replay onto the new Supabase project will apply it as written, with the bug.
**Where:** migration `20260514094701_*.sql` (and `20260501195324_*.sql`).
**Severity:** Medium · **Category:** Broken now (latent; guaranteed on migration replay) · **Fix:** Simple fix (add the enum cast).

### M3. Editing an already-confirmed order re-sends the confirmation email
**What's wrong:** The order-edit modal sends the "order confirmed" email whenever the saved status equals confirmed — including when it was already confirmed and the admin only changed a quantity. The email function has no per-order dedupe, so the client gets a fresh confirmation email on every edit.
**Where:** `src/components/internal/OrderEditModal.tsx`; `supabase/functions/confirm-order-email/index.ts`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (send only when the status actually transitions to confirmed).

### M4. Double-click window before order submit locks
**What's wrong:** The client submit button disables once submitting starts, but the click handler first runs several async checks before that flag is set. A double-click during that window starts two full submissions, creating two orders (and, with H4, two notification emails).
**Where:** `src/pages/client/NewOrder.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (set a pending flag at the very start of the handler).

### M5. Admin cancel has no status guard and double-credits hours
**What's wrong:** The admin cancellation mutations update the booking status with no "only if still confirmed" condition and no re-read. If the booking was already cancelled (member cancelled while the admin modal sat open, or two staff acted), the second cancel re-updates it and writes a *second* refund entry. The member procedure guards against this; the admin path doesn't. The follow-up ledger and waiver writes also ignore their own errors, so a failed refund still shows a success message.
**Where:** `src/components/bookings/BookingDetailModal.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (add a status condition and check the write results).

### M6. Cancellation and no-show fees are recorded but never billed
**What's wrong:** The admin UI stamps a cancellation/no-show fee on the booking and shows it in a toast, but the billing page never reads that fee field — charged-cancellation bookings drop out of the billable set and their fee is never added to any invoice, so 50%/100% cancellation fees go silently uncollected unless staff add a manual line. No-shows are inconsistent the other way (hours count *and* a fee is stamped), so a naive future fix would double-charge them.
**Where:** `src/pages/internal/CoRoastBilling.tsx`; `src/components/bookings/BookingDetailModal.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (bill the recorded fee; define no-show semantics).

### M7. Custom cancellation windows don't actually work in either portal
**What's wrong:** The authoritative cancellation window lives in a rules table with per-account overrides, and the booking procedure honors it — but the member portal hardcodes a 48-hour rule and the admin modal hardcodes the 48/24-hour tiering. An account given a custom window sees the wrong lock state and fee in the UI while the procedure would behave differently. A ready-made helper to resolve the real rules exists but is unused by these screens.
**Where:** `src/pages/member/MemberSchedule.tsx`, `src/components/bookings/BookingDetailModal.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (use the existing rules-resolution helper).

### M8. "Can book roaster" permission is enforced only in the UI
**What's wrong:** The booking procedures check only that the user is an active member of an account on the co-roasting program; the finer "can book roaster" permission is checked exclusively in front-end routing. A user invited without booking permission can call the booking procedure directly and succeed — the same class of UI-only enforcement the hardening work was meant to eliminate.
**Where:** procedures in migration `20260514094701_*.sql`; `src/components/auth/ProtectedRoute.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (check the permission inside the booking procedures).

### M9. Recurring bookings leave orphaned blocks and half-created series
**What's wrong:** The recurring-booking procedure creates the recurring-block record even when zero dates end up bookable, leaving an empty block. The admin recurring path is a client-side loop of separate inserts, so a failure at week 5 of 12 leaves five bookings and the block with no cleanup and no partial-failure report. Neither path checks whether the hour-ledger writes succeeded.
**Where:** migration `20260603174431_*.sql`; `src/components/bookings/BookingFormDialog.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (roll back on zero-created; route the admin path through the procedure).

### M10. Maintenance blocks can be dropped on top of confirmed bookings
**What's wrong:** Creating a Loring maintenance/unavailability block never checks for existing confirmed bookings in that window and gives no warning. A maintenance window placed over a booking leaves the member double-booked with the machine offline, and nothing notifies them.
**Where:** `src/components/coroast/BlockFormDialog.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (conflict check and confirm dialog before insert).

### M11. Two sources of truth for member hours; manual credits change nothing
**What's wrong:** Every displayed hour balance is computed by summing booking durations, while the hour ledger (which has entry types for manual credits and debits) is used only as an audit trail. So an admin's goodwill manual credit changes no balance and no invoice. Meanwhile the edit-times flow writes ledger entries *and* changes booking times, so any future switch to summing the ledger would double-count. This split is where the next hours-accounting bug will come from.
**Where:** `src/components/bookings/MemberSummaryPanel.tsx`, `src/pages/member/MemberBilling.tsx`, `src/pages/internal/CoRoastBilling.tsx`.
**Severity:** Medium · **Category:** Broken now (design debt) · **Fix:** Structural change (choose one source of truth for net hours).

### M12. Floor counts overwrite concurrent activity (stale-snapshot writes)
**What's wrong:** A floor count writes an adjustment computed as counted-amount minus the balance shown when the modal was opened. Floor counts take minutes, during which other stations keep packing and roasting; if a movement lands in that window, the adjustment targets a stale baseline and effectively erases the concurrent movement. The same applies to green-lot floor counts. There is no server-side "set the balance to X as of now" primitive.
**Where:** `src/components/inventory/WipFloorCountModal.tsx`, `src/pages/internal/Inventory.tsx`, `src/lib/wipAdjustments.ts`.
**Severity:** Medium · **Category:** Broken now (race) · **Fix:** Structural change (recompute the balance server-side under a lock).

### M13. "Clear WIP history" also deletes finished-goods production history
**What's wrong:** The "clear WIP history" action deletes all ledger rows tagged with a roast group — but finished-goods production rows are also tagged with the roast group, so they get deleted too, while their consumption rows (untagged) survive. Finished-goods balances then go deeply negative and are masked to zero by the clamp in M15. The confirm dialog only mentions "this roast group's transactions," and the "orphaned groups only" restriction is just a comment, not enforced.
**Where:** `src/pages/internal/Inventory.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (restrict the delete to WIP-type rows or enforce the orphan check server-side).

### M14. The batch-orphan detector can prompt deletion of legitimate batches
**What's wrong:** The "ghost batch" panel fetches all batches and then queries the ledger for their entries — but past 1,000 batches both fetches truncate, so batches that *do* have ledger entries get flagged "no inventory ledger entries" with a delete-batch button attached. A truncated read leads a user to delete a real batch. The same query also builds a giant URL from every batch id.
**Where:** `src/components/production/PlanTab.tsx`.
**Severity:** Medium · **Category:** Scaling risk · **Fix:** Structural change (do the anti-join in the database).

### M15. Negative finished-goods stock is hidden as zero
**What's wrong:** Available finished goods (and WIP) are clamped to a minimum of zero for display. Any overdraw — from the pick race, the history-delete bug, or a bad adjustment — shows as zero instead of negative, so drift is invisible and picking/short-list/pack-gating all consume the sanitized number. Finished goods has no unclamped view anywhere.
**Where:** `src/hooks/useAuthoritativeInventory.ts`.
**Severity:** Medium · **Category:** Broken now (observability) · **Fix:** Simple fix (expose the signed balance and flag negatives).

### M16. Blend screen overstates available coffee; server doesn't verify it
**What's wrong:** The blend-execute screen figures out how much of each component batch is available by counting only pack-consumption rows, ignoring downward adjustments, losses, and prior blends. After a downward floor count or a recorded loss, it still shows batches as fully available, and the blend procedure only checks per-batch output limits — so the blend commits and drives component stock negative (then hidden by M15).
**Where:** `src/components/production/BlendExecuteModal.tsx`; blend procedure in migration `20260706130000_*.sql`.
**Severity:** Medium · **Category:** Broken now (edge) · **Fix:** Simple fix (include all movement types in the availability calc).

### M17. Loss-path roasting consumes no green coffee, and inline green edits leave no audit trail
**What's wrong:** When a batch is recorded with a loss, the code deliberately passes no lot, so *no* green coffee is deducted at all — on exactly the batches most likely to have used extra green, compounding C4. Separately, the lot-detail "adjust kg on hand" editor collects a reason note but never saves it and writes no ledger entry, unlike the floor-count modal — producing unexplained green-stock jumps with no audit trail. The green floor-count loop is also non-atomic (a mid-loop failure leaves some lots updated and others not).
**Where:** `src/components/production/RoastGroupDrawer.tsx`, `src/pages/internal/SourcingLots.tsx`, `src/components/sourcing/FloorCountModal.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix for the loss-path and audit note; structural for atomic floor counts.

### M18. The account order-creation form validates location against the wrong table
**What's wrong:** The internal create-order form's "location required" check reads the legacy client-locations table keyed by the selected id, but that id is an account id and the actual dropdown reads account-locations keyed by account id. For accounts whose id doesn't happen to equal a legacy client id, the guard sees no locations and lets admins submit orders with no location even when the account has several.
**Where:** `src/pages/internal/CreateOrderForClient.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (query account-locations by account id).

### M19. The client order form never enforces its required location
**What's wrong:** The client new-order form marks location as required but never checks it on submit, saving a null location if none was picked. A client with multiple locations can submit an order with no location, which then breaks ship-to labeling and makes the order invisible to location-restricted users at that account (including the person who placed it).
**Where:** `src/pages/client/NewOrder.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (validate the location before submit).

### M20. New/duplicate quote flows dead-end and accumulate rows
**What's wrong:** The "new quote" and "duplicate quote" actions create quote rows and then navigate to a quote-detail page that is a hardcoded "temporarily disabled" stub. Users can create quotes they can never open, and draft rows accumulate. Duplicate is also a non-transactional two-step copy that can leave partial line items on failure.
**Where:** `src/pages/internal/NewQuote.tsx`, `src/pages/internal/QuoteDetail.tsx`, `src/pages/internal/Quotes.tsx`.
**Severity:** Medium · **Category:** Broken now · **Fix:** Simple fix (hide the create/duplicate actions while detail is disabled).

### M21. Assorted data-hygiene gaps: duplicate accounts, orphaned invites, CSV quantity coercion, one-click unsubscribe, cache bleed
**What's wrong:** A cluster of smaller integrity issues: accounts can be created with duplicate names (no check, no constraint), and prospect conversion ignores a failed update so a retry makes a second account. The account-user invite is a 3–4 step non-transactional flow that can leave an auth user linked to no account, and its mirror-client lookup is a case-sensitive check-then-insert that creates duplicate clients and races. The FUNK CSV importer coerces zero, negative, or unparseable quantities to 1 unit, silently inflating production demand. The unsubscribe endpoint suppresses an address on a plain link-open, so corporate link-scanners can unsubscribe users automatically, with no in-app way to undo it, and it renders the address into HTML unescaped. Signing out never clears the query cache, so on a shared machine the next user briefly sees the previous user's cached data. Role changes and deactivations don't take effect until token refresh or reload, and active-status defaults to true when the profile fetch fails.
**Where:** `src/pages/internal/Accounts.tsx`, `src/pages/internal/ProspectDetail.tsx`, `src/pages/internal/AccountDetail.tsx`, `src/lib/inviteHelpers.ts`, `src/lib/funkCsvImport.ts`, `supabase/functions/unsubscribe/index.ts`, `src/contexts/AuthContext.tsx`.
**Severity:** Medium · **Category:** Mixed (mostly Broken now) · **Fix:** Mostly simple fixes; the invite flow is structural.

---

## Low

### L1. Dashboard and production screens re-download whole tables on every change
**What's wrong:** One realtime subscription invalidates around twenty query keys — including the full-table ledger fetches — on any change to seven busy tables, plus an unconditional 30-second poll. Every pick, pack, or roast entry makes every open production screen re-download the entire ledger, batch, and order datasets. The cost per action grows with total history and with the number of connected users, so the app will feel progressively slower long before the 1,000-row correctness bugs bite. (The subscriptions themselves are cleaned up correctly — no leak.)
**Where:** `src/hooks/useProductionRealtime.ts`, `src/hooks/useAuthoritativeInventory.ts`.
**Severity:** Low today (High later) · **Category:** Scaling risk · **Fix:** Structural change (server-side aggregates, debounced and targeted invalidation).

### L2. Several lists fetch entire growing tables and will silently truncate
**What's wrong:** Beyond the inventory ledger (C2), a number of screens fetch whole ever-growing tables and sum or filter them in the browser, so each silently goes wrong past 1,000 rows: the dashboard fetches the entire ship-picks table (and computes a value it never uses to filter it); the ship and roast tabs fetch all ship-picks; the roast tab fetches all batches *oldest-first* (so today's batches vanish first); the plan tab loads every non-cancelled order ever; the admin booking calendar fetches every booking oldest-first (so future bookings disappear); the products list derives "last ordered" from all line items ever; and the client order history and member schedule fetch everything with no bound. Most are one-line filter fixes; a few need server-side aggregation.
**Where:** `src/hooks/useDashboardMetrics.ts`, `src/components/production/ShipTab.tsx`, `src/components/production/RoastTab.tsx`, `src/components/production/PlanTab.tsx`, `src/pages/internal/BookingCalendar.tsx`, `src/components/products/ProductsListTab.tsx`, `src/pages/client/OrderHistory.tsx`, `src/pages/member/MemberSchedule.tsx`.
**Severity:** Low today (High as data grows) · **Category:** Scaling risk · **Fix:** Mostly simple fixes (add server-side filters/limits); a few structural.

### L3. Active orders past the first page silently disappear from the work list
**What's wrong:** The orders list loads 100 at a time newest-first and assumes it has the full set when filtering, so an old stuck order past row 100 is invisible until someone repeatedly clicks "load more" — and that button caps at 90 days. The orders most needing attention (old, forgotten) are exactly the ones hidden. The growing-window pagination also refetches from the start each time and requests an exact count on every grow.
**Where:** `src/pages/internal/Orders.tsx`, `src/hooks/usePaginatedQuery.ts`.
**Severity:** Low (bites past ~100 orders) · **Category:** Scaling risk · **Fix:** Simple fix (fetch active statuses unbounded, paginate only shipped history; use an estimated count).

### L4. Missing database indexes on hot columns of growing tables
**What's wrong:** Several frequently-filtered columns on tables that grow forever have no index, so those queries become full scans as the tables grow: batches lack indexes on status/date/roast-group/created-at; packing runs have no indexes beyond the primary key; orders lack a created-at index (used for the newest-first pagination and count); the hour ledger lacks an index on its canonical account column (used by the member security policy and the account detail view); and the inventory transactions table lacks one on the batch-source column used by the orphan detector.
**Where:** `supabase/migrations/` (index coverage).
**Severity:** Low · **Category:** Scaling risk · **Fix:** Simple fix (add indexes).

### L5. Per-row lookups in list rows (N+1)
**What's wrong:** The orders list renders a per-row component that fires a separate location lookup per row, and the inventory list fires a separate profile lookup per "last counted by" row. React Query dedupes identical ids, but first paint still fires a burst that grows with the number of distinct values, and the location name could simply be joined into the list query (the ship tab already does).
**Where:** `src/components/orders/LocationSelect.tsx`, `src/pages/internal/Orders.tsx`, `src/pages/internal/Inventory.tsx`.
**Severity:** Low · **Category:** Scaling risk · **Fix:** Simple fix (join or batch-fetch).

### L6. Dashboard queries run one after another and swallow their errors
**What's wrong:** The dashboard runs about eight independent queries sequentially (so latency is the sum of all of them, though only one has a real dependency) and does all aggregation in the browser. Each query reads only its data and never checks for an error, so a failed query silently yields zeros in the production-load dashboard instead of an error state.
**Where:** `src/hooks/useDashboardMetrics.ts`.
**Severity:** Low · **Category:** Scaling risk (the error-swallowing is arguably broken now) · **Fix:** Simple fix (run in parallel, propagate errors).

### L7. Fire-and-forget order notifications fail silently
**What's wrong:** The order-notification calls after submit/confirm/ship only log a warning on failure. If the function errors (deploy gap, auth, cold-start timeout), ops never learn a new order arrived, and there is no retry or dead-letter for the invocation itself (the email queue only helps once the function succeeds).
**Where:** `src/pages/client/NewOrder.tsx`, `src/pages/internal/CreateOrderForClient.tsx`, `src/pages/internal/OrderDetail.tsx`.
**Severity:** Low · **Category:** Broken now (silent failure path) · **Fix:** Structural change (trigger notifications from a database event/queue).

### L8. Batch delete can report success while deleting nothing, and reorder writes aren't atomic
**What's wrong:** The batch delete guards on "planned" status but still shows "batch deleted" when it matched zero rows (e.g. the batch was just marked roasted), so the user believes a roasted batch is gone. A sibling delete path has no status guard at all. Separately, roast-group and ship reordering fire one update per row in a loop, so a partial failure leaves a half-reordered list; the pack tab already uses the safer single-mutation-with-resync pattern.
**Where:** `src/components/production/RoastGroupDrawer.tsx`, `src/components/production/PlanTab.tsx`, `src/components/production/RoastTab.tsx`, `src/components/production/ShipTab.tsx`.
**Severity:** Low · **Category:** Broken now (edge cases) · **Fix:** Simple fix (check affected row counts; batch the reorders).

### L9. Weak and inconsistent password policy, plus forgeable preview state
**What's wrong:** The invite-acceptance page accepts any six-character password while the admin-created-user path requires eight — the weaker path wins, and it is the same page internal admin/ops users use. Separately, the preview/impersonation account id is read from browser storage and could be forged by a client; it is not currently exploitable because pages still query under the user's own credentials and row-level security returns nothing for a foreign id, but the front end treats that id as authoritative scoping, so it is safe only as long as that RLS holds.
**Where:** `src/pages/SetPassword.tsx` vs `src/pages/internal/AccountDetail.tsx`; `src/contexts/PreviewContext.tsx`.
**Severity:** Low · **Category:** Broken now / defense-in-depth · **Fix:** Simple fix (align the minimum; keep treating preview id as untrusted).

### L10. Small correctness and safety nits
**What's wrong:** A grab-bag of minor issues: the "clear cache and reload" debug buttons call a blanket local-storage clear that also wipes the Supabase login session and all saved preferences; the numeric-input guard blocks bad keystrokes but is bypassable by pasting negative, decimal, or scientific-notation values; the lot picker chooses a producer/origin nondeterministically when a lot has several purchase lines (the displayed origin can flip between loads); a transient role-fetch failure during a routine token refresh logs a valid user out to the "account pending" screen (fails safe, but is an availability bug); the notification-emailer notify-prospect-submission has no role check and can be triggered by anyone who guesses a submission id (bounded by idempotency); several privileged edge functions hardcode a wildcard CORS origin instead of using the existing allowlist helper (not currently exploitable, since auth is by bearer token, not cookies); and there is dead SKU-helper code that would fail immediately if ever wired up. Documentation drift: CLAUDE.md cites the hours-sign-fix migration as `...120000` when the actual file is `...120001`.
**Where:** `src/components/products/RoastGroupsTab.tsx`, `src/components/admin/BuildInfoPanel.tsx`, `src/lib/numericInput.ts`, `src/hooks/useGreenLotsForPicker.ts`, `src/contexts/AuthContext.tsx`, `supabase/functions/notify-prospect-submission/`, various edge functions' CORS headers, `src/lib/skuUtils.ts`.
**Severity:** Low · **Category:** Mixed · **Fix:** Simple fixes.

---

## What was checked and found sound

Worth recording, so these areas aren't re-audited without cause: the pricing and unit-economics libraries use precise decimal math with division-by-zero guards; the order-transition map now matches the database; batch roast/revert/blend and order-delete already use atomic locked procedures; the pack-quantity path is atomic; the email queue processor has solid retry/dead-letter/idempotency discipline; both CSV parsers handle quoting and byte-order marks correctly; the auth architecture is otherwise well-built (fails closed, no self-role-escalation, tokens stripped from URLs, every route role-gated); the OAuth flows use single-use state and HMAC verification; Shopify tokens are encrypted at rest; and the co-roast tier-rate numbers match across all three sources of truth. The realtime subscriptions are cleaned up correctly — no leaks. The one place the tidy atomic-procedure pattern was *not* applied is the ship-pick and cancel-with-picks paths (H2, H3), which is why those are the standout inventory risks.
