# Architecture Rules

- Keep per-account variant access in account_product_access; use the authorized customer-products RPC for catalog/order selectors and database triggers for all customer writes, because staff preview must match customer eligibility and direct API calls must not bypass restrictions.
- Case-only settings belong to the account's case variant and restrict its contained loose variant; record explicit staff confirmation on order lines without moving packing allocations, because internal exceptions must not change customer access or inventory identity.

- Keep case packing allocations on the case product's order lines, not its constituent product; expand composition only for bag-count display so loose-bag inventory and progress remain independent.

- Store phase-one case composition on products as a contained variant reference and integer count, with a validating trigger deriving case weight; create cases only through the existing-family Add Variant workflow to prevent free-weight cases without contents.

- Configure invite email functions with Deno automatic npm dependency resolution, because managed email imports must resolve during validation and deployment without frontend dependencies.

- Persist packing allocations per order line and update product inventory atomically by the allocation delta, because whole-bean and grind rows need independent progress without duplicating FG or WIP consumption.

- Keep pack-drawer demotion as transient UI state triggered on closing a completed drawer, because live inventory updates must not unexpectedly reorder open work.
- Shopify's pull excludes orders the customer has already collected or the shop has started preparing for pickup (`supabase/functions/_shared/pickupReady.ts`), and that exclusion must stay fail-open: the pickup state needs a Shopify permission the store may not have granted, and skipping real work is worse than pulling noise.
- Keep shipped orders awaiting invoice in a dedicated Production invoicing tab, because shipping work and invoice follow-up are separate workflows.
- Store actual shipping-label cost on the order in CAD, because shop-floor staff capture it for later invoicing.
- Keep accounts as non-collapsible side rails inside Roast → Account pack drawers, because floor staff need all product lines visible after one click.
- Keep packing controls directly on product rows without expandable product drawers, because each row must be fully actionable at a glance on the production floor.
- Partition completed packing lines after unfinished lines inside both drawer views while retaining their side rails, because finished work must stay visible for reference.
- Render weight totals through the shared kg/lb weight-unit setting rather than a hardcoded unit, because the reader's unit choice must carry across the app.
- Resolve an order's location from `orders.location_id`, never `account_location_id`, because the legacy column is no longer written and reading only it silently misfiles every order under the account's first location.
- Derive a product's size fields (bag_size_g, grams_per_unit, packaging_variant) through the `normalize_product_packaging` products trigger on creation and size edits; synchronize either edited weight field and recompute the legacy badge, because every workflow must display the same current size. Keep size/type out of new product names.
- Reject roasted_batches rows on post-roast blend roast groups via the `block_batches_on_post_roast_blends` trigger, because such blends are only made from component batches and direct batches become unroastable orphans.
- Shopify orders omitted on the fetch review page are stored in `shopify_skipped_orders` and deduped alongside bundled orders in every pull mode (manual, review, cron), because an omitted order must never return on its own.
