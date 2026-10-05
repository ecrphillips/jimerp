import { describe, it, expect } from 'vitest';
import {
  isPickupPrepared,
  type PickupState,
} from '../../supabase/functions/_shared/pickupReady';

// The Shopify pull asks for open + unfulfilled orders. A local-pickup order that
// the bar has already marked "Ready for pickup" still answers to that filter, so
// it arrives as if it were new work. These are the exact Shopify states that say
// "already collected" versus "still ours to make" — checked against the live
// 2025-01 schema (Fulfillment.displayStatus, FulfillmentOrder.status +
// DeliveryMethodType).
const state = (over: Partial<PickupState> = {}): PickupState => ({
  fulfillments: [],
  fulfillmentOrders: [],
  ...over,
});

describe('isPickupPrepared — already collected', () => {
  it('skips a pickup order whose fulfillment is ready for collection', () => {
    expect(isPickupPrepared(state({ fulfillments: [{ status: 'OPEN', displayStatus: 'READY_FOR_PICKUP' }] }))).toBe(true);
  });

  it('skips a pickup order already handed to the customer', () => {
    expect(isPickupPrepared(state({ fulfillments: [{ status: 'SUCCESS', displayStatus: 'PICKED_UP' }] }))).toBe(true);
  });

  it('skips a pickup order the bar has started working', () => {
    expect(
      isPickupPrepared(
        state({
          fulfillmentOrders: [{ status: 'IN_PROGRESS', deliveryMethod: { methodType: 'PICK_UP' } }],
        }),
      ),
    ).toBe(true);
  });

  it('is case-insensitive about the API strings', () => {
    expect(
      isPickupPrepared(
        state({
          fulfillmentOrders: [{ status: 'in_progress', deliveryMethod: { methodType: 'pick_up' } }],
        }),
      ),
    ).toBe(true);
  });
});

describe('isPickupPrepared — still real work', () => {
  it('keeps a pickup order nobody has prepared yet', () => {
    expect(
      isPickupPrepared(
        state({
          fulfillmentOrders: [{ status: 'OPEN', deliveryMethod: { methodType: 'PICK_UP' } }],
        }),
      ),
    ).toBe(false);
  });

  it('keeps an order being packed for shipping', () => {
    expect(
      isPickupPrepared(
        state({
          fulfillmentOrders: [{ status: 'IN_PROGRESS', deliveryMethod: { methodType: 'SHIPPING' } }],
        }),
      ),
    ).toBe(false);
  });

  it('keeps an order still moving through the mail', () => {
    expect(
      isPickupPrepared(state({ fulfillments: [{ status: 'SUCCESS', displayStatus: 'IN_TRANSIT' }] })),
    ).toBe(false);
  });

  it('keeps a plain open order with nothing recorded against it', () => {
    expect(isPickupPrepared(state())).toBe(false);
    expect(isPickupPrepared(undefined)).toBe(false);
    expect(isPickupPrepared(null)).toBe(false);
  });

  it('keeps an order whose only fulfillment order is a hold, not work begun', () => {
    expect(
      isPickupPrepared(
        state({
          fulfillmentOrders: [
            { status: 'ON_HOLD', deliveryMethod: { methodType: 'PICK_UP' } },
            { status: 'SCHEDULED', deliveryMethod: { methodType: 'PICK_UP' } },
          ],
        }),
      ),
    ).toBe(false);
  });
});
