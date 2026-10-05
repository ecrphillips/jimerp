# Simplify the production Pack tab

## Goal
Make the Pack tab faster to scan on the production floor by removing one layer of navigation, reducing repeated labels, and making the active work area visually obvious.

## Build
- Restyle the Pack SKUs area in the selected high-visibility production-slab direction: stronger roast-group headers, clearer packed-versus-needed totals, compact sturdy type, and broad pale green/amber/red status bands.
- Keep roast groups as the only collapsible grouping in **Roast → Account** view.
- Replace each nested account drawer in that view with a fixed left-side account rail spanning its product lines, so every account's products are immediately visible after opening the roast group.
- Indent the account rails and product rows inside the roast-group drawer, with a stronger closing edge and spacing before the next roast group.
- Remove SKU and the separate repeated gram-size line from each product row.
- Move the existing packaging/size badge beside the unit-demand count on the right.
- Keep product rows expandable for the actual packing controls and SKU-wide WIP details; opening a product remains the single final click needed to enter packing.
- Preserve account-first behavior, existing progress counts, grind and urgency warnings, WIP readiness, bought-in product handling, and completed-drawer demotion.
- Update **Expand all / Collapse all** so Roast → Account mode controls roast groups and product details only, not the removed account drawer level.

## Validation
- Check Roast → Account with multiple accounts under one roast group and verify account rails, indentation, drawer boundaries, size placement, and one-click access to all product lines.
- Check Account → Roast to ensure it remains usable and receives the simpler product-line treatment without losing its existing hierarchy.
- Verify not-started, partial, complete, grind, urgent, WIP-ready, WIP-partial, no-WIP, and pull-from-stock examples.
- Verify packing entry still saves correctly and no counts or inventory behavior change.
- Check the current desktop floor layout and a narrower viewport for clipping or overlap, then confirm the preview build is clean.

## Technical details
- Limit the change to the Pack tab presentation and local drawer-state handling; no database or inventory-rule changes.
- Reuse the existing authoritative demand, packed, picked, and WIP calculations.
- Refactor the grouped renderer so its second level can render either as a drawer (Account → Roast) or as a non-collapsible side rail (Roast → Account), rather than duplicating the data flow.
- Keep all status colours on semantic design tokens and preserve transient completed-drawer ordering.
