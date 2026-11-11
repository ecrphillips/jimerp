# Packing controls on the Order Detail page

## What you'll get
A new **Packing** card on each order's page (shown until the order is shipped or cancelled) listing every line that needs packing, with the same controls floor staff use on the Pack tab:

- Big "still to pack" number, with packed / needed shown smaller
- Additive entry box (type 12, press Enter → adds 12), plus +/− and **All packed**
- Ground lines kept separate from whole bean, each with its own progress
- Case Lots show cases and bag contents, same as the Pack tab
- Size badges, available WIP per coffee, and a warning when a line would use more WIP than is on hand
- Completed lines fade and move to the bottom
- An overall progress bar for the order (e.g. "340 of 1,200 bags packed")

## Works with the daily run sheet
It's one shared record, not a copy. Units packed on the order page appear right away on the Pack tab for that day, and anything packed on the Pack tab shows on the order page. WIP comes off once, wherever the packing is entered. For a big FUNK order that spans several days, the remaining units stay on the run sheet until they're done.

## Picking
Picking (pulling packed stock for shipment) keeps working through the existing shipping flow. The card will show picked counts per line, but this first version won't add a separate picking editor. Tell me if you want one.

## Technical details
- Reuse the per-line allocation RPCs already behind PackTab: `get_pack_line_allocations` (read) and `update_pack_line_units` (write; atomic FG/WIP delta). No schema changes.
- Extract the PackTab row controls (count display, additive input, +/−, All packed, WIP bar, case contents) into a shared `PackLineControls` component used by both PackTab and the new `OrderPackingCard`, so behavior can't drift between them.
- Invalidate the same React Query keys after a save so both screens refresh; the existing realtime subscriptions cover other open screens.
- Replace OrderDetail's derived "packedUnits" pool logic with the per-line allocations so the two screens agree.
- Tests: ensure order-page edits change the same allocation the Pack tab reads, and that completed-line ordering is shared.

## Keeping big-order stock separate (added after your question)
Each packed bag is already counted against one specific order line, and picks are too. The risk is that bags on the shelf are one shared pile, so a bag packed for the big FUNK order could get grabbed for Tuesday's order.

The rule: **pack against the order you're packing for.** On Monday, enter 12 A and 20 B on Monday's order, and 38 and 30 on the big order (from its page). The run sheet then shows Tuesday's order as still needing its own 10 and 15. Nothing "floats".

To keep it from getting messy:
- **Reserved stock:** bags packed for the big order count as held for it. Available stock on Inventory and the Pack tab shows "on hand / held for orders / free", like held-for-blend WIP does now.
- **Pick warning:** on the Ship tab, if picking for another order would use bags held for the big order, show "these are held for FUNK-000xxx" and require a confirm. This allows a deliberate borrow without making it silent.
- **Move packed units:** on the order page, a small "move packed to another order" action for when someone packed against the wrong order, so the counts can be fixed without recounting.
- **Labels:** the big order's line shows "38 packed · held on shelf" so it's clear those bags are spoken for.
