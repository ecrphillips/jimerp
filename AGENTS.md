# Architecture Rules

- Keep pack-drawer demotion as transient UI state triggered on closing a completed drawer, because live inventory updates must not unexpectedly reorder open work.
- Shopify's pull excludes orders the customer has already collected or the shop has started preparing for pickup (`supabase/functions/_shared/pickupReady.ts`), and that exclusion must stay fail-open: the pickup state needs a Shopify permission the store may not have granted, and skipping real work is worse than pulling noise.
- Keep shipped orders awaiting invoice in a dedicated Production invoicing tab, because shipping work and invoice follow-up are separate workflows.
- Store actual shipping-label cost on the order in CAD, because shop-floor staff capture it for later invoicing.
- Keep accounts as non-collapsible side rails inside Roast → Account pack drawers, because floor staff need all product lines visible after one click.
- Keep packing controls directly on product rows without expandable product drawers, because each row must be fully actionable at a glance on the production floor.
- Partition completed packing lines after unfinished lines inside both drawer views while retaining their side rails, because finished work must stay visible for reference.
- Render weight totals through the shared kg/lb weight-unit setting rather than a hardcoded unit, because the reader's unit choice must carry across the app.
- Resolve an order's location from `orders.location_id`, never `account_location_id`, because the legacy column is no longer written and reading only it silently misfiles every order under the account's first location.- Derive a product's size fields (bag_size_g, grams_per_unit, packaging_variant) through the `normalize_product_packaging` products trigger and keep size/type out of new product names, because products created from different screens must look identical everywhere sizes are shown.
