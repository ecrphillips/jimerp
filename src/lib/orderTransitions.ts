import type { Database } from '@/integrations/supabase/types';

export type OrderStatus = Database['public']['Enums']['order_status'];

/**
 * Allowed order_status transitions.
 *
 * CANCELLED is a side-exit from the pipeline, reachable from any active
 * stage (DRAFT, SUBMITTED, CONFIRMED, IN_PRODUCTION, READY). The cancel
 * flow runs the stop-and-ask inventory prompt for any outstanding picks.
 * Only SHIPPED and CANCELLED orders cannot be cancelled.
 *
 * Reverts from SHIPPED back to CONFIRMED/READY are allowed for admin
 * correction of mis-marked shipments.
 */
export const ALLOWED_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['CONFIRMED', 'CANCELLED', 'DRAFT'],
  CONFIRMED: ['IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'SHIPPED', 'CANCELLED'],
  READY: ['SHIPPED', 'IN_PRODUCTION', 'CANCELLED'],
  SHIPPED: ['CONFIRMED', 'READY'],
  CANCELLED: [],
} as const;

export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
