# Roadmap

- [x] Replace inventory availability buttons with Available / All selectors and verify zero-stock filtering.

- [x] Add shared admin-editable common-client shortcuts and grouped account options to internal order creation; verified save/reload and grouped client selection, four tests pass.

- [x] Add Account → Customer Product Details with per-variant visibility/orderability, case-only controls, notes, and product-page links.
- [x] Enforce customer product restrictions on new orders and edits; require staff confirmation for case-only loose units.
- [x] Verify Stim's four saved case-only settings, customer new-order/catalogue preview, Products toggle, and staff confirmation acceptance/cancellation; 17 tests pass and current build is clean. No real order was created during verification.

- [x] Show Case Lot contents on screen and print, with case-specific packing counts independent from loose bags; 9 tests pass and live Pack tab checked. No open case order available for a live packing save.

- [x] Add Case Lot variant creation with a required same-family variant and bag count, saved composition and calculated weight.
- [x] Verify Case Lot rules with tests; preview click-through not run.

- [x] Audit recent merged migrations against live database records and schema; refresh generated types.
- [x] Resolve existing function validation errors and synchronize merged email functions.

- [x] Separate ground packing lines and verify independent completion without double-counting stock.
- [x] Show remaining packing weight beside available WIP and include both figures in the printed pack list.

- [x] Keep completed packing lines visible, faded, and below unfinished lines inside both drawer views.

- [x] Make Today the standard run-sheet filter and show it as a visible left rail (a strip above the tabs on narrower screens).
- [x] Nudge the run-sheet rail down so its first card is justified to the top of the Pack SKUs section.

- [x] Add the fifth Invoicing tab to Production.
- [x] Move shipped orders awaiting invoice out of Ship.
- [x] Add expandable order-content drawers while preserving Mark Invoiced.
- [x] Verify the new workflow in the preview.
- [x] Show each product line's locked unit price.
- [x] Add a saved shipping-cost field to every invoicing drawer.
- [x] Verify pricing and shipping entry in the preview.
- [x] Add a total weight (kg or lb, following the reader's unit) to each invoicing drawer header.
- [x] Show each order's location beside the account name in the invoicing drawer header.
