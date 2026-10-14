# Ethio Espress WIP mismatch: findings and fix

## What actually happened
No wrong-table problem. Ethio Espress and Am I Wrong record stock the same way as every other coffee, and the inventory page and pack tab read the same numbers.

The two screens differ because of **coffee set aside for a blend**:
- Ethio Espress has **25.8 kg** roasted on hand (inventory page is right).
- **13.4 kg** of that is one batch roasted today and set aside for **Technicolour Espresso**. When Technicolour was blended at 12:21, only 3 of today's 4 Ethio batches went in. The 4th is still held for Technicolour.
- The pack tab won't let other products use coffee held for a blend: 25.8 − 13.4 = **12.4 kg** (the drawer figure).
- Earlier, before the extra batch was roasted, nearly everything on hand was held, so Am I Wrong read "No WIP".

The same leftover holds exist on two other coffees from today's Technicolour run:
- Honduras Natural: 1 batch, 13.4 kg
- Brazil Blender: 2 batches, 26.9 kg

That's 53.8 kg held for Technicolour in total.

## Fix
1. **Show the hold everywhere.** On the inventory page's WIP table, add a "Held for blend" column plus an "Available" figure next to the on-hand total. On pack drawer headers, show "25.8 kg on hand · 13.4 kg held for Technicolour" instead of just 12.4 kg, so the two screens never seem to disagree.
2. **Let staff release a hold.** In the blend drawer on the Roast tab, list leftover held batches with a "Release to coffee stock" button. The batch stays roasted, but it's no longer held for the blend, so products like Am I Wrong can use it.
3. **Prompt at blend time.** When a blend is run without using every held batch, ask: "Keep the leftover batches held for the next blend, or release them to stock?"
4. **Today's leftovers:** I'll leave the 4 held batches alone unless you tell me to release them, because they may be meant for the next Technicolour blend.

## Technical details
- Reservation logic is in `computeAuthoritativeWip` (`useAuthoritativeInventory.ts`): ROASTED batches with `planned_for_blend_roast_group` set and `consumed_by_blend_at` null are subtracted from `wip_available_kg`. The pack tab uses `wip_available_kg`; the inventory page shows net.
- Release = clear `planned_for_blend_roast_group` on the batch (no inventory ledger rows), done through a staff-only update, then refresh the WIP query keys.
- Add a unit test: a released batch no longer reduces available WIP.
