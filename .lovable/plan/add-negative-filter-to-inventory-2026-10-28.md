# Add "Negative" filter to Inventory

Turn the Available / All toggle on both the WIP and Finished Goods sections into three choices: **Available / Negative / All**.

- **Negative** shows only lines whose on-hand balance is below zero (beyond rounding, i.e. under −0.05 kg for WIP; under 0 units for FG), so they can be stocktaken and corrected.
- Shows a count badge on the Negative option (e.g. "Negative · 3") so problems are visible without clicking.
- Empty state: "No negative balances" when nothing qualifies.
- Default stays Available.

## Technical details
- `src/lib/inventoryAvailability.ts`: add `isNegativeBalance(netKg)` using `-MIN_VISIBLE_KG`; FG uses signed unit balance < 0.
- `Inventory.tsx`: replace boolean `wipAvailableOnly`/`fgAvailableOnly` with `'available' | 'negative' | 'all'`; extend `AvailabilityToggle` to three segments; filter rows accordingly (WIP uses raw signed `net_wip_kg`, not held-adjusted).
- Add a unit test for `isNegativeBalance`.
