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

This is the convention used by the admin UI in `src/components/bookings/BookingFormDialog.tsx` and `BookingDetailModal.tsx`. The member-portal RPCs in `supabase/migrations/20260501195324_*.sql` currently use the **opposite sign** and need to be flipped. When changing one path, change all so they stay consistent.

## Co-Roasting: Member Writes Go Through SECURITY DEFINER RPCs

Members do not have direct INSERT/UPDATE/DELETE RLS on `coroast_bookings`, `coroast_hour_ledger`, `coroast_recurring_blocks`, or `coroast_billing_periods`. All member writes go through SECURITY DEFINER RPCs (`create_member_booking`, `create_member_recurring_bookings`, `cancel_member_booking`). Do not grant members direct write access.

Business rules (4-week MEMBER-tier horizon, 48-hour cancellation lock) **must** be enforced inside the RPCs — UI checks alone can be bypassed.

## Co-Roasting: Schema Gotchas

- `account_id` is the canonical FK to `accounts(id)` on `coroast_bookings`, `coroast_billing_periods`, `coroast_hour_ledger`, `coroast_invoices`, `coroast_storage_allocations`, `coroast_waiver_log`. Legacy `member_id` columns are nullable and unused for new writes.
- **Exception**: `coroast_recurring_blocks` has only `member_id` (no `account_id` column). New writes populate `member_id` with the account UUID. `BookingFormDialog.tsx` currently writes to a non-existent `account_id` field on this table — that admin flow is broken.
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

`TIER_RATES` are defined in `src/components/bookings/bookingUtils.ts` **and** duplicated in `supabase/migrations/20260501195324_*.sql` (`_get_or_create_billing_period`). When updating rates, update **both**. The `ACCESS` tier is legacy — kept for historical billing records, do not surface in new UI.

## Migration Discipline

- Filenames: `YYYYMMDDHHMMSS_<uuid>.sql` in `supabase/migrations/`
- New migrations only — never edit applied migrations
- After schema changes, regenerate `src/integrations/supabase/types.ts`
