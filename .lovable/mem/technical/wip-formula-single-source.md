---
name: WIP Formula Single Source of Truth
description: All WIP calculations must use computeAuthoritativeWip — never reimplement per page
type: technical
---
The Inventory page WIP table, the AuthoritativeTotals dropdown on production tabs, and the floor-count "current_kg" baseline ALL derive from `computeAuthoritativeWip` in `src/hooks/useAuthoritativeInventory.ts`. Do not write a parallel WIP reducer in another file — it will drift and break floor counts (counts apply a delta against the page's view, so if two views disagree, zeroing one leaves the other non-zero).

The hook exposes two fields:
- `wip_net_kg`: unclamped (can be negative) — use for displays where signed value matters (Inventory page, floor count baseline).
- `wip_available_kg`: clamped to `max(0, net - reserved)` — use for production UX where negatives are meaningless.
