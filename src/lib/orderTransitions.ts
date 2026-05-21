import type { Database } from '@/integrations/supabase/types';

export type OrderStatus = Database['public']['Enums']['order_status'];

/**
 * Allowed order_status transitions.
 *
 * CANCELLED is reachable only from DRAFT, SUBMITTED, or CONFIRMED.
 * Once an order enters IN_PRODUCTION or beyond, it cannot be cancelled —
 * use a separate compensating workflow.
 *
 * Reverts from SHIPPED back to CONFIRMED/READY are allowed for admin
 * correction of mis-marked shipments.
 */
export const ALLOWED_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['CONFIRMED', 'CANCELLED', 'DRAFT'],
  CONFIRMED: ['IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'SHIPPED'],
  READY: ['SHIPPED', 'IN_PRODUCTION'],
  SHIPPED: ['CONFIRMED', 'READY'],
  CANCELLED: [],
} as const;

export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
