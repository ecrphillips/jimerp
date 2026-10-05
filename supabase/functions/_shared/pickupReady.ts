// Which Shopify orders the bar has already collected / marked ready for pickup.
//
// Shopify marks a local-pickup order "Ready for pickup" with
// fulfillmentOrderLineItemsPreparedForPickup, which flags the fulfillment ORDER.
// The line-item flag itself has no readable field (verified against the live
// 2025-01 schema: FulfillmentOrderLineItem exposes 15 fields, none of them
// pickup-related), so the state is read from the two places that do show it:
//
//   1. a fulfillment whose displayStatus is READY_FOR_PICKUP or PICKED_UP —
//      readable with read_orders alone;
//   2. a fulfillment order whose delivery method is PICK_UP and whose status has
//      moved to IN_PROGRESS ("the fulfillment order is being processed") — needs
//      the read_merchant_managed_fulfillment_orders scope.
//
// Anything else stays in the pull: a pickup order whose fulfillment order is
// still OPEN has not been prepared, and a SHIPPING fulfillment order in
// progress is an order that still has to be packed.

export interface FulfillmentNode {
  status?: string | null;
  displayStatus?: string | null;
}

export interface FulfillmentOrderNode {
  status?: string | null;
  deliveryMethod?: { methodType?: string | null } | null;
}

export interface PickupState {
  fulfillments: FulfillmentNode[];
  fulfillmentOrders: FulfillmentOrderNode[];
}

const COLLECTED_DISPLAY_STATUSES = new Set(['READY_FOR_PICKUP', 'PICKED_UP']);
const WORK_STARTED_STATUSES = new Set(['IN_PROGRESS']);

const upper = (v: unknown): string => String(v ?? '').toUpperCase();

export function isPickupPrepared(state: PickupState | undefined | null): boolean {
  if (!state) return false;

  for (const f of state.fulfillments ?? []) {
    if (COLLECTED_DISPLAY_STATUSES.has(upper(f?.displayStatus))) return true;
  }

  for (const fo of state.fulfillmentOrders ?? []) {
    const method = upper(fo?.deliveryMethod?.methodType);
    const status = upper(fo?.status);
    if (method === 'PICK_UP' && WORK_STARTED_STATUSES.has(status)) return true;
  }

  return false;
}
