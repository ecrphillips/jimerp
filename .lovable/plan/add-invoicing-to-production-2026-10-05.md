# Add Invoicing to Production

## What will change

- Add a fifth **Invoicing** tab beside Plan, Roast, Pack, and Ship on `/production`.
- Move the existing **Shipped, Awaiting Invoice** list out of Ship and into the new tab.
- Keep the current **Mark Invoiced** action and its behaviour unchanged.
- Make every awaiting-invoice order an expandable row. The closed row will show the order number, account, and item count; opening it will show each product, package type/size, grind note where applicable, and quantity.
- Show a clear empty state when there are no shipped orders awaiting invoice.

## Technical details

- Create a focused invoicing-tab component that owns the existing shipped-order query and invoiced update.
- Remove that query, update action, and list from the shipping component while preserving its refresh after an order is shipped.
- Extend the production tab URL option to support `?tab=invoicing` and change the tab layout from four to five columns.
- Reuse the existing collapsible and packaging display controls so the new drawers match the rest of Production.
- Verify the project builds cleanly and check the new tab and drawer interaction in the running preview.
