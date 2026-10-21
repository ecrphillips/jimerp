/**
 * Baskets — pure logic (no Supabase calls), shared by the Baskets pages and
 * the green inventory (Lots) page.
 *
 * A basket is a named green coffee profile kept in stock year-round. Each
 * membership row (basket_lots) is either:
 *   - active   : active_pct is a number (share of the basket, should total 100)
 *   - lined up : active_pct is null (queued; sorted automatically, never by hand)
 */
import { parseDateOnly } from '@/lib/dateOnly';
import { COFFEE_ORIGIN_COUNTRIES } from '@/lib/coffeeOrigins';
import { DEPLETION_THRESHOLD } from '@/hooks/useGreenLotDepletion';

// ─── Types ────────────────────────────────────────────────────────────────

/** The green_lots fields basket logic needs. */
export interface BasketLotInfo {
  id: string;
  lot_number: string;
  status: string;
  received_date: string | null;
  expected_delivery_date: string | null;
  is_placeholder: boolean;
  kg_on_hand: number;
  bags_released: number;
  bag_size_kg: number;
  estimated_days_to_consume: number | null;
  created_at: string;
}

export interface BasketRow {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BasketLotRow {
  id: string;
  basket_id: string;
  lot_id: string;
  active_pct: number | null;
  created_at: string;
}

/** Lined-up groups, in the order they are shown. */
export type LotSupplyGroup = 'IN_STORE' | 'CONTRACTED' | 'PLANNED';

export const SUPPLY_GROUP_ORDER: LotSupplyGroup[] = ['IN_STORE', 'CONTRACTED', 'PLANNED'];

export const SUPPLY_GROUP_LABEL: Record<LotSupplyGroup, string> = {
  IN_STORE: 'In store',
  CONTRACTED: 'Contracted — not received',
  PLANNED: 'Planned (placeholders)',
};

// ─── Classification ──────────────────────────────────────────────────────

/**
 * Has the lot physically arrived?
 *
 * Same rule the green inventory (Lots) page shows: anything not EN_ROUTE reads
 * "Received" there. Also counts any lot with a received_date, matching
 * `_client_green_lot_json` (migration 20261008130000) — lots that arrived but
 * are still being costed can carry a non-RECEIVED status.
 */
export function isLotReceived(lot: Pick<BasketLotInfo, 'status' | 'received_date'>): boolean {
  return lot.status !== 'EN_ROUTE' || !!lot.received_date;
}

/**
 * Which supply group a lot falls into:
 *   IN_STORE   — arrived (see isLotReceived)
 *   PLANNED    — not arrived and flagged is_placeholder (incl. lots made from samples)
 *   CONTRACTED — not arrived, real lot (released / booked, on its way)
 */
export function lotSupplyGroup(lot: Pick<BasketLotInfo, 'status' | 'received_date' | 'is_placeholder'>): LotSupplyGroup {
  if (isLotReceived(lot)) return 'IN_STORE';
  if (lot.is_placeholder) return 'PLANNED';
  return 'CONTRACTED';
}

/**
 * kg a not-yet-received lot will bring in: bags × bag size — the same figure
 * the Lots page cards show (kg_on_hand stays 0 until a lot is received).
 */
export function lotExpectedKg(lot: Pick<BasketLotInfo, 'bags_released' | 'bag_size_kg'>): number {
  return (Number(lot.bags_released) || 0) * (Number(lot.bag_size_kg) || 0);
}

// ─── Sorting lined-up lots ───────────────────────────────────────────────

function cmpDateAsc(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b);
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

/**
 * Automatic order for lined-up lots:
 *   1. In store — oldest received first
 *   2. Contracted, not received — soonest expected first
 *   3. Planned placeholders — oldest created first
 * Ties fall back to created_at, then lot number, so the order is stable.
 */
export function compareLinedUp(a: BasketLotInfo, b: BasketLotInfo): number {
  const ga = SUPPLY_GROUP_ORDER.indexOf(lotSupplyGroup(a));
  const gb = SUPPLY_GROUP_ORDER.indexOf(lotSupplyGroup(b));
  if (ga !== gb) return ga - gb;
  const group = lotSupplyGroup(a);
  let c = 0;
  if (group === 'IN_STORE') c = cmpDateAsc(a.received_date, b.received_date);
  else if (group === 'CONTRACTED') c = cmpDateAsc(a.expected_delivery_date, b.expected_delivery_date);
  if (c !== 0) return c;
  c = a.created_at.localeCompare(b.created_at);
  if (c !== 0) return c;
  return a.lot_number.localeCompare(b.lot_number);
}

// ─── Running low ─────────────────────────────────────────────────────────

/** Days-left warning used by roast group Green Lot Mapping. */
export const RUNNING_LOW_DAYS = 5;

/**
 * Days of coffee left, from estimated_days_to_consume counted from the
 * received date (or expected date if not received). Mirrors the calculation
 * in GreenLotMappingSection. null when no estimate is set.
 */
export function lotDaysRemaining(
  lot: Pick<BasketLotInfo, 'status' | 'received_date' | 'expected_delivery_date' | 'estimated_days_to_consume'>,
  now: Date = new Date(),
): number | null {
  if (!lot.estimated_days_to_consume) return null;
  const start = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
  const startDate = parseDateOnly(start);
  if (!startDate) return null;
  const end = new Date(startDate);
  end.setDate(end.getDate() + lot.estimated_days_to_consume);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

/**
 * An in-store lot is running low when either existing warning would fire:
 *   - kg on hand at or below the 10 kg depletion threshold (useGreenLotDepletion), or
 *   - fewer than 5 days left on its consumption estimate (Green Lot Mapping).
 * Lots that haven't arrived are never "running low".
 */
export function isLotRunningLow(lot: BasketLotInfo, now: Date = new Date()): boolean {
  if (!isLotReceived(lot)) return false;
  if (Number(lot.kg_on_hand) <= DEPLETION_THRESHOLD) return true;
  const days = lotDaysRemaining(lot, now);
  return days != null && days < RUNNING_LOW_DAYS;
}

// ─── Percentages ─────────────────────────────────────────────────────────

export function activePctTotal(members: Pick<BasketLotRow, 'active_pct'>[]): number {
  return members.reduce((s, m) => s + (m.active_pct != null ? Number(m.active_pct) : 0), 0);
}

/** True when active lots exist and their % does not add to 100 (0.01 tolerance). */
export function activePctIsOff(members: Pick<BasketLotRow, 'active_pct'>[]): boolean {
  const active = members.filter(m => m.active_pct != null);
  if (active.length === 0) return false;
  return Math.abs(activePctTotal(active) - 100) > 0.01;
}

/** Default % for a lot being promoted to active: whatever is left of 100 (never negative). */
export function defaultPromotePct(members: Pick<BasketLotRow, 'active_pct'>[]): number {
  return Math.max(0, Math.round((100 - activePctTotal(members)) * 100) / 100);
}

// ─── Volumes ─────────────────────────────────────────────────────────────

export interface BasketVolumes {
  /** Sum of kg_on_hand for lots in store. */
  kgInStore: number;
  /** Sum of bags × bag size for real lots not yet received. */
  kgContracted: number;
}

/**
 * Volumes for a set of lots. Each lot id is counted once, so passing the lots
 * of several baskets gives a combined total with shared lots counted once.
 */
export function computeVolumes(lots: BasketLotInfo[]): BasketVolumes {
  const seen = new Set<string>();
  let kgInStore = 0;
  let kgContracted = 0;
  for (const lot of lots) {
    if (seen.has(lot.id)) continue;
    seen.add(lot.id);
    const g = lotSupplyGroup(lot);
    if (g === 'IN_STORE') kgInStore += Number(lot.kg_on_hand) || 0;
    else if (g === 'CONTRACTED') kgContracted += lotExpectedKg(lot);
  }
  return { kgInStore, kgContracted };
}

// ─── Basket view model ───────────────────────────────────────────────────

export interface BasketMemberView {
  member: BasketLotRow;
  lot: BasketLotInfo;
  group: LotSupplyGroup;
  /** Names of the other baskets this lot is in. */
  sharedWith: string[];
  runningLow: boolean;
  /** Oldest in-store lined-up lot — use it first. */
  useFirst: boolean;
}

export interface BasketView {
  basket: BasketRow;
  active: BasketMemberView[];
  /** Lined-up lots, already in automatic order. */
  linedUp: BasketMemberView[];
  pctTotal: number;
  pctOff: boolean;
  volumes: BasketVolumes;
  /** Active lots that are running low. */
  lowActive: BasketMemberView[];
  /** First lined-up lot — what the low-stock prompt suggests promoting. */
  nextUp: BasketMemberView | null;
}

/** lot_id → basket ids it belongs to. */
export function basketIdsByLot(members: BasketLotRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of members) {
    const list = m.get(r.lot_id) ?? [];
    if (!list.includes(r.basket_id)) list.push(r.basket_id);
    m.set(r.lot_id, list);
  }
  return m;
}

export function buildBasketView(
  basket: BasketRow,
  allMembers: BasketLotRow[],
  lotsById: Map<string, BasketLotInfo>,
  basketsById: Map<string, Pick<BasketRow, 'id' | 'name'>>,
  now: Date = new Date(),
): BasketView {
  const byLot = basketIdsByLot(allMembers);
  const views: BasketMemberView[] = [];
  for (const member of allMembers) {
    if (member.basket_id !== basket.id) continue;
    const lot = lotsById.get(member.lot_id);
    if (!lot) continue;
    const sharedWith = (byLot.get(lot.id) ?? [])
      .filter(id => id !== basket.id)
      .map(id => basketsById.get(id)?.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b));
    views.push({
      member,
      lot,
      group: lotSupplyGroup(lot),
      sharedWith,
      runningLow: isLotRunningLow(lot, now),
      useFirst: false,
    });
  }

  const active = views
    .filter(v => v.member.active_pct != null)
    .sort((a, b) => Number(b.member.active_pct) - Number(a.member.active_pct) || compareLinedUp(a.lot, b.lot));
  const linedUp = views.filter(v => v.member.active_pct == null).sort((a, b) => compareLinedUp(a.lot, b.lot));
  const firstInStore = linedUp.find(v => v.group === 'IN_STORE');
  if (firstInStore) firstInStore.useFirst = true;

  const activeMembers = active.map(v => v.member);
  return {
    basket,
    active,
    linedUp,
    pctTotal: activePctTotal(activeMembers),
    pctOff: activePctIsOff(activeMembers),
    volumes: computeVolumes(views.map(v => v.lot)),
    lowActive: active.filter(v => v.runningLow),
    nextUp: linedUp[0] ?? null,
  };
}

// ─── Placeholder lots from samples ───────────────────────────────────────

/**
 * Samples store origin as free text. Turn it into the ISO3 code the lot
 * number generator expects (code or country name); null when unknown.
 */
export function originCodeFromText(origin: string | null | undefined): string | null {
  const v = (origin || '').trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  const byCode = COFFEE_ORIGIN_COUNTRIES.find(c => c.code === upper);
  if (byCode) return byCode.code;
  const lower = v.toLowerCase();
  const byName = COFFEE_ORIGIN_COUNTRIES.find(c => c.name.toLowerCase() === lower)
    ?? COFFEE_ORIGIN_COUNTRIES.find(c => lower.includes(c.name.toLowerCase()));
  return byName?.code ?? null;
}

/** Case-insensitive, trimmed name comparison (matches the DB unique index). */
export function normalizeBasketName(name: string): string {
  return name.trim().toLowerCase();
}
