# Close-of-day workflow for the run sheet

## 1. Roast tab: "Work ahead" divider
- When filtered to Today, each planned batch is checked against today's remaining demand for its roast group (including blend component targets).
- Batches needed for today stay at the top. Planned batches whose whole output is extra to today's need go below a "Work ahead" line, faded slightly, still roastable.
- The same rule applies in Tomorrow view (relative to tomorrow's demand). All view stays as it is.

## 2. "Close today" on the Roast tab
- The button turns on once every batch needed for today is roasted (it shows how many are left until then). Admins can force-close with a reason.
- It opens a checklist. Blocking items must be cleared or acknowledged with a note:
  - **Negative inventory**: every roast group with negative WIP and every product with negative finished stock. Each row has a quick fix (adjust count / link to Inventory).
  - **Planned batches still open for today**: roast, move to tomorrow, or delete.
  - **Blend holds left over**: components roasted for a blend that wasn't blended today. Blend now or release.
- Information items (no action needed):
  - Kg roasted per roaster today, and first and last roast times.
  - Green used today, if green deduction is on.
  - Work ahead already roasted.
- Saving records who closed the day, when, the snapshot, and any notes. A "Today closed" badge then shows on the tab, and it can be reopened.

## 3. "Close shipping" on the Plan tab
- Turns on when every order due to ship today is marked shipped or moved.
- Checklist:
  - Orders due today that aren't shipped: ship, move date, or note why.
  - Shipped orders with no shipping cost entered (for invoicing).
  - Pack lines that are packed but not picked, or picked but not shipped.
  - Negative finished-goods stock caused by today's shipping.
- Saved the same way as the roast close.

## 4. Roaster finish times (admin only)
- A Dashboard card: for each roaster (Samiac, Loring), shows the last-roast time per day for the last 14 days, plus the average. Uses the roast time and roaster already saved on each batch.
- Once days are being closed, the card also shows when each day was closed.

## Other checklist ideas (pick which you want)
- Pack lines still unfinished for today.
- Orders whose ship date is today but which were never confirmed.
- Free-text "notes for tomorrow" that show on the next day's run sheet.
- Done-by times per tab, alongside the roaster times.

## Technical details
- New table `production_day_closes` (date, kind ROAST|SHIP, closed_by, closed_at, snapshot jsonb, notes, reopened_at), RLS ADMIN/OPS, with grants.
- Pure helper `src/lib/workAhead.ts` (classifies batches against remaining demand in batch order) plus tests. The rule: a batch is work ahead if the demand still uncovered, after all the batches before it, is 0 or less.
- Negative checks reuse the signed inventory ledger reads (not the zero-clamped ones).
- Roaster times come from `roasted_batches.roasted_at` and `assigned_roaster`, in Vancouver time.
