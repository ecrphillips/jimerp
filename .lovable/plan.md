# Fetch FUNK and No Smoke orders separately

## Finding
Nothing forces the two stores to fetch together. The fetch already supports pulling one store at a time. The single button was a screen simplification made when the old No Smoke button and the FUNK file import were replaced. Fetching separately is a screen-only change.

## What changes
1. **Orders page fetch tile**: replace the single "Fetch FUNK and No Smoke Orders" button with one row per active store:
   - Store name, its own "Last fetch" time (auto/manual, and any errors), and its own **Fetch** button.
   - Fetching one store never touches the other.
   - Add a small "Fetch all" link for when you do want both.
2. **Results toast**: shows only the store you fetched.
3. **Daily automatic fetch**: unchanged. It still pulls both stores once a day. Turning it off per store would be a separate option if you want it.

## Not in this plan (offer later if still needed)
- A bulk "dismiss / cancel" tool for orders that came in unwanted. Separate fetching should remove most of that need.

## Technical details
- `ShopifyFetchTile.tsx`: load the active `shopify_sources` rows (id, store_slug or label). For each one, read its latest `shopify_pull_log` row filtered by `source_id`. Call `shopify-pull-orders` with `{ source_id }` for each row's button, or `{}` for Fetch all.
- Per-source spinner state; query invalidation is unchanged.
- No backend or database changes.
