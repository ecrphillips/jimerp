# Architecture Rules

- Keep pack-drawer demotion as transient UI state triggered on closing a completed drawer, because live inventory updates must not unexpectedly reorder open work.
- Shopify's pull excludes orders the customer has already collected or the shop has started preparing for pickup (`supabase/functions/_shared/pickupReady.ts`), and that exclusion must stay fail-open: the pickup state needs a Shopify permission the store may not have granted, and skipping real work is worse than pulling noise.
- Keep shipped orders awaiting invoice in a dedicated Production invoicing tab, because shipping work and invoice follow-up are separate workflows.