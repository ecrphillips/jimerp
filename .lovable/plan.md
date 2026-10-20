# Fetch review page for FUNK and No Smoke

Yes, this is possible. Nothing forces the two stores to fetch together, because the fetch can already pull one store at a time. Today a fetch reads Shopify and creates the bundled order in one step. The new page puts a review step in between. The current Fetch button and the daily automatic fetch stay exactly as they are.

## New page: Orders → Shopify Fetch
1. **Choose store(s)**: FUNK, No Smoke, or both. Each shows its last fetch time.
2. **Preview**: lists every Shopify order the fetch would pull in. Nothing is created yet. Each order is an expandable row showing:
   - Order number, date, customer
   - Every line with title, variant, SKU and quantity, plus what it maps to in JIM (product, size, grind) or "needs mapping"
   - Any extra details Shopify lets us read: order note, tags, shipping/delivery method, payment status
3. **Omit**: tick to leave an order out. It shows as struck through, and the totals (orders, bags, kg per product) update live.
4. **Create order**: builds the bundled order from only the orders left in, the same way the regular fetch does. Unmapped lines still go to the existing review list.

## Omitted orders
- Omitted orders are remembered, so a later fetch, manual or automatic, won't pull them back in.
- A "Skipped orders" section on the same page lets you un-skip one. It returns on the next fetch.

## Technical details
- `shopify-pull-orders`: add a `mode` field.
  - `preview` reads Shopify and returns the orders plus their resolved mappings. It has no writes and creates no pull-log order.
  - `commit` accepts `exclude_order_ids[]`. Excluded orders are dropped before bundling and recorded as skipped.
  - With no mode, behaviour is unchanged (button and cron).
- Extend the GraphQL query with `note`, `tags`, `displayFinancialStatus` and shipping-line title. Every extra field is optional and fail-open, so a missing Shopify permission never breaks the fetch.
- Store skips in `shopify_bundle_source_orders` with a null `bundle_order_id` and a `skipped` flag, or in a small new `shopify_skipped_orders` table. Either way the existing "already imported" check also skips them. RLS is limited to ADMIN/OPS.
- New page `src/pages/internal/ShopifyFetchReview.tsx`, with a route and a link from the existing fetch tile.
