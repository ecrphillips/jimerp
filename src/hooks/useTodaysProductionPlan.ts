/**
 * useTodaysProductionPlan
 *
 * Data foundation for the (not-yet-built) Plan tab on the Run Sheet.
 *
 * Returns, for the CURRENT day (America/Vancouver):
 *  - The list of accounts scheduled for today — i.e. today's weekday is in
 *    their `accounts.production_weekdays`.
 *  - For each: the total order volume for today (sum of open-order line-item
 *    units whose work deadline lands today) and a `no_order_yet` flag that is
 *    true when the account is scheduled today but has no order for today.
 *
 * This hook is intentionally NOT wired into any UI yet. The Plan tab can drop
 * it in later without rework.
 *
 * Weekday convention matches the rest of the production scheduling module:
 * JS getDay() (0=Sun … 6=Sat) — the same values stored by the per-account
 * "Standard Production Days" config and consumed by `computeDefaultWorkDeadline`.
 *
 * "Dated today" means the order's `work_deadline_at` falls on today's Vancouver
 * date — the production model already defaults that deadline to the account's
 * next production day, so it is the natural "this account is due today" signal.
 */
import { useQuery } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import {
  TIMEZONE,
  getVancouverNow,
  getVancouverDateString,
  isProductionDayToday,
} from '@/lib/productionScheduling';

// Open = anything still in the production/fulfilment pipeline (matches the run sheet).
const OPEN_ORDER_STATUSES = ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'] as const;

export interface ProductionPlanAccount {
  account_id: string;
  account_name: string;
  production_weekdays: number[];
  /** Sum of open-order line-item units for this account dated today. */
  total_units_today: number;
  /** Number of this account's open orders dated today. */
  order_count_today: number;
  /** True when scheduled today but no order is entered for today. */
  no_order_yet: boolean;
}

interface AccountRow {
  id: string;
  account_name: string;
  production_weekdays: number[] | null;
}

interface OrderRow {
  id: string;
  account_id: string | null;
  work_deadline_at: string | null;
  line_items: { quantity_units: number | null }[] | null;
}

/** Vancouver-local YYYY-MM-DD for an ISO timestamp, or null. */
function vancouverDateOf(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const zoned = toZonedTime(parseISO(iso), TIMEZONE);
    const y = zoned.getFullYear();
    const m = String(zoned.getMonth() + 1).padStart(2, '0');
    const d = String(zoned.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

export function useTodaysProductionPlan() {
  const nowVan = getVancouverNow();
  const todayDate = getVancouverDateString();

  const accountsQuery = useQuery({
    queryKey: ['production-plan-accounts'],
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, production_weekdays')
        .not('production_weekdays', 'is', null);
      if (error) throw error;
      return (data ?? []) as unknown as AccountRow[];
    },
  });

  const ordersQuery = useQuery({
    queryKey: ['production-plan-orders'],
    queryFn: async (): Promise<OrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, account_id, work_deadline_at, line_items:order_line_items(quantity_units)')
        .in('status', OPEN_ORDER_STATUSES as unknown as string[]);
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
  });

  const accounts: ProductionPlanAccount[] = (() => {
    const accs = accountsQuery.data ?? [];
    const orders = ordersQuery.data ?? [];

    // Accounts whose standard production day is today.
    const scheduledToday = accs.filter(a => isProductionDayToday(a.production_weekdays, nowVan));

    // Tally today's open-order volume per account.
    const unitsByAccount = new Map<string, number>();
    const countByAccount = new Map<string, number>();
    for (const o of orders) {
      if (!o.account_id) continue;
      if (vancouverDateOf(o.work_deadline_at) !== todayDate) continue;
      const units = (o.line_items ?? []).reduce((sum, li) => sum + (li.quantity_units ?? 0), 0);
      unitsByAccount.set(o.account_id, (unitsByAccount.get(o.account_id) ?? 0) + units);
      countByAccount.set(o.account_id, (countByAccount.get(o.account_id) ?? 0) + 1);
    }

    return scheduledToday
      .map(a => {
        const orderCount = countByAccount.get(a.id) ?? 0;
        return {
          account_id: a.id,
          account_name: a.account_name,
          production_weekdays: a.production_weekdays ?? [],
          total_units_today: unitsByAccount.get(a.id) ?? 0,
          order_count_today: orderCount,
          no_order_yet: orderCount === 0,
        };
      })
      .sort((x, y) => x.account_name.localeCompare(y.account_name));
  })();

  return {
    accounts,
    isLoading: accountsQuery.isLoading || ordersQuery.isLoading,
    error: accountsQuery.error ?? ordersQuery.error ?? null,
    today: todayDate,
  };
}
