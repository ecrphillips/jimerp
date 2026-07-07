# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A full-stack lite ERP system for **Home Island Coffee Partners** — a specialty coffee roasting business. It manages orders, production planning, green coffee sourcing, inventory, client billing, and a co-roasting membership program.

## Commands

```bash
npm run dev          # Dev server on :8080
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Run Vitest once
npm run test:watch   # Vitest in watch mode
```

E2E tests use Playwright (`e2e/` folder). Unit tests use Vitest with jsdom (`src/test/setup.ts`).

## Stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix), React Query, React Hook Form + Zod
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + Edge Functions on Deno)
- **Path alias**: `@/` maps to `src/`

## Architecture

### Three User Portals

The app has three distinct portals with separate layouts and route trees:

| Portal | Layout | Users | Route prefix |
|--------|--------|-------|--------------|
| Internal | `InternalLayout` | ADMIN, OPS | `/internal/` |
| Client | `ClientLayout` | CLIENT role | `/client/` |
| Member | `MemberPortalLayout` | Co-roast accounts | `/member/` |

`ProtectedRoute` enforces role access. `AuthContext` holds `user`, `role`, and `permissions` globally.

### Key Source Directories

- `src/pages/` — Route-level components (44+ internal, 4 client, 4 member)
- `src/components/` — Feature-based folders: `orders/`, `production/`, `sourcing/`, `coroast/`, `inventory/`, `bookings/`, `crm/`, `pricing/`, `quotes/`, `clients/`, `products/`
- `src/hooks/` — Custom hooks (e.g., `useOrderNotifications`, `useDashboardMetrics`, `useAuthoritativeInventory`)
- `src/lib/` — Pure utility modules (pricing calculations, production scheduling, unit economics, SKU generation)
- `src/integrations/supabase/` — Supabase client and auto-generated DB types (`types.ts`, ~4700 lines)
- `supabase/migrations/` — 130+ SQL migrations
- `supabase/functions/` — Deno edge functions (auth hooks, email queue, order notifications, booking RPCs)

### Data Patterns

- **React Query** for all server state; real-time subscriptions via Supabase for orders, inventory, bookings
- **React Hook Form + Zod** for all forms; validation also enforced at DB level via RLS
- RLS policies enforce: ADMINs see all, OPS see assigned clients, CLIENTs see only their own data

### Core Domain Objects

```
clients → products → price_list
       → orders → order_line_items → production_plan_items

green_coffee_lots → sourcing (vendors, samples, contracts, purchases, releases)
inventory_items ← inventory_ledger

coroast_members → coroast_bookings → coroast_billing_periods → coroast_hour_ledger
               → coroast_recurring_blocks
               → coroast_loring_blocks (maintenance/unavailability)
```

**Key enums:**
- `app_role`: `ADMIN | OPS | CLIENT`
- `order_status`: `DRAFT → SUBMITTED → CONFIRMED → IN_PRODUCTION → READY → SHIPPED | CANCELLED`
- `coroast_tier`: `MEMBER | GROWTH | PRODUCTION | ACCESS`
- `product_format`: `WHOLE_BEAN | ESPRESSO | FILTER | OTHER`

### Edge Functions

Located in `supabase/functions/`. Notable ones:
- `process-email-queue` — async email delivery
- `notify-new-order` — order webhook
- `invite-user` / `invite-account-user` / `resend-invite` — user onboarding
- `create-member-booking` / `cancel-member-booking` — booking RPCs with billing period logic
- `validate-order-constraints` — order validation

### Auth Flow

```
Auth.tsx → AuthCallback.tsx → SetPassword.tsx
AuthContext (global state) → ProtectedRoute (per-route enforcement)
```

## Supabase Integration Notes

- Auto-generated types live in `src/integrations/supabase/types.ts` — regenerate with `supabase gen types` when schema changes
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- Project ID: `cgdzjkryygwlyygeznrb`

## Co-Roasting: Hour Ledger Sign Convention

`coroast_hour_ledger.hours_delta`: **positive = hours consumed**, negative = hours credited back.
- `BOOKING_CONFIRMED` → positive
- `BOOKING_RETURNED` → negative

This convention is used by the admin UI (`src/components/bookings/BookingFormDialog.tsx`, `BookingDetailModal.tsx`) **and** the member-portal RPCs — both are consistent as of `supabase/migrations/20260514120000_fix_hours_delta_sign.sql` (which flipped the originally-inverted RPC signs). When changing one path, change all so they stay consistent.

## Co-Roasting: Member Writes Go Through SECURITY DEFINER RPCs

Members do not have direct INSERT/UPDATE/DELETE RLS on `coroast_bookings`, `coroast_hour_ledger`, `coroast_recurring_blocks`, or `coroast_billing_periods`. All member writes go through SECURITY DEFINER RPCs (`create_member_booking`, `create_member_recurring_bookings`, `cancel_member_booking`). Do not grant members direct write access.

Business rules (booking horizon, cancellation lock, duration bounds, recurring-allowed) **must** be enforced inside the RPCs — UI checks alone can be bypassed. As of `20260603000000_*.sql` (Stage 2) all three RPCs call `_coroast_effective_booking_rules(account_id)`, which merges the `coroast_tier_booking_rules` tier defaults with the per-account `accounts.coroast_custom_*` overrides (both seeded in `20260512230749_*.sql`). To change a rule, update the table/override rows — do **not** hardcode new limits in the RPC bodies.

## Co-Roasting: Schema Gotchas

- `account_id` is the canonical FK to `accounts(id)` on `coroast_bookings`, `coroast_billing_periods`, `coroast_hour_ledger`, `coroast_invoices`, `coroast_storage_allocations`, `coroast_waiver_log`. Legacy `member_id` columns are nullable and unused for new writes.
- `coroast_recurring_blocks` gained `account_id` (NOT NULL, FK → `accounts(id)`) in `20260514120000_coroast_recurring_blocks_account_id.sql`; its read RLS is now account-scoped on that column. Both the admin flow (`BookingFormDialog.tsx`) and the `create_member_recurring_bookings` RPC write `account_id` (the RPC also keeps `member_id` populated for back-compat). `member_id` is nullable and slated for removal in a follow-up migration.
- Standard RLS read pattern for account-scoped tables:
  ```sql
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = <table>.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ))
  ```

## Co-Roasting: Tier Rates

Frontend tier rates have a single source of truth: `CO_ROAST_TIER_DEFAULTS` in `src/components/bookings/bookingUtils.ts`. `TIER_RATES`, `STORAGE_RATES` (same file), `DEFAULT_RATES` (`CoRoastPricing.tsx`), and `TIER_DEFAULTS` (`AccountDetail.tsx`) are all **derived** from it — do not reintroduce parallel hardcoded copies. The live runtime source is the `coroast_tier_rates` DB table (read via `useTierRates`); `CO_ROAST_TIER_DEFAULTS` mirrors its seed and is the synchronous fallback.

When changing rates, update in lockstep: (1) `CO_ROAST_TIER_DEFAULTS`, (2) the `coroast_tier_rates` table seed in `supabase/migrations/20260514094701_*.sql`, and (3) the `_get_or_create_billing_period` CASE in `supabase/migrations/20260501195324_*.sql`. The `ACCESS` tier is legacy (`isLegacy: true`) — kept for historical billing, filtered out of admin UI; do not surface in new UI.

## Orders: Cancelled Hidden by Default

As of `supabase/migrations/20260707130000_*.sql`, a **RESTRICTIVE** RLS SELECT policy on `public.orders` hides `CANCELLED` orders from every read made with a user JWT — internal portal, client portal, and RLS-scoped external readers (MCP tools). Do **not** add per-screen `.neq('status','CANCELLED')` filters; the DB does it.

- **Opt-in**: `public.orders_all` (staff-only SECURITY DEFINER view, read-only) includes cancelled orders. Used by `src/pages/internal/OrderDetail.tsx` so a just-cancelled order still renders. View columns are typed nullable — coerce NOT NULL base columns after fetch.
- **Unaffected**: `service_role` (edge functions) and SECURITY DEFINER functions still see cancelled orders — cancellation emails and server-side order logic depend on this.
- **Consequences**: direct PostgREST UPDATE/DELETE against an already-cancelled order match zero rows (silently). Cancelled orders are read-only in the UI; anything that must touch them goes through SECURITY DEFINER RPCs. Client self-cancel uses the `client_cancel_own_order` RPC (a direct update's RETURNING comes back empty under the policy and reads as failure).
- **Cancelling from OrderDetail**: non-shipped orders use `cancel_order_with_picks` in `'return'` mode (picked FG returns to stock). Shipped orders are wired to a `cancel_shipped_order` RPC that does **not exist yet** — a follow-up migration must add it (mark CANCELLED + audit row, no inventory writes) and allow `SHIPPED → CANCELLED` in the DB `is_allowed_order_transition`; the frontend cancel flow already bypasses the transition ladder.

## Migration Discipline

- Filenames: `YYYYMMDDHHMMSS_<uuid>.sql` in `supabase/migrations/`
- New migrations only — never edit applied migrations
- After schema changes, regenerate `src/integrations/supabase/types.ts`
