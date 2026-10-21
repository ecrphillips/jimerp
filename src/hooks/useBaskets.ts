import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { allocateSingleLotNumber, type AllocatedPo } from '@/lib/lotNumberGenerator';
import { findRoastGroupsUsingBasket } from '@/lib/basketDeleteGuard';
import {
  buildBasketView,
  originCodeFromText,
  type BasketLotInfo,
  type BasketLotRow,
  type BasketRow,
  type BasketView,
} from '@/lib/baskets';

export const BASKET_QUERY_KEYS = {
  baskets: ['baskets'] as const,
  members: ['basket-lots'] as const,
  lots: ['basket-green-lots'] as const,
  labels: ['basket-lot-labels'] as const,
};

/** Lot as loaded for baskets: basket fields plus what we need to label it. */
export interface BasketGreenLot extends BasketLotInfo {
  contract_id: string | null;
  lot_identifier: string | null;
  source_sample_id: string | null;
}

const LOT_COLUMNS =
  'id, lot_number, status, received_date, expected_delivery_date, is_placeholder, kg_on_hand, bags_released, bag_size_kg, estimated_days_to_consume, created_at, contract_id, lot_identifier, source_sample_id';

// ─── Queries ─────────────────────────────────────────────────────────────

export function useBasketsQuery() {
  return useQuery({
    queryKey: BASKET_QUERY_KEYS.baskets,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('baskets')
        .select('id, name, is_active, notes, created_at, updated_at')
        .order('name');
      if (error) throw error;
      return (data ?? []) as BasketRow[];
    },
  });
}

export function useBasketMembersQuery() {
  return useQuery({
    queryKey: BASKET_QUERY_KEYS.members,
    queryFn: async () =>
      (await fetchAllRows((from, to) =>
        supabase
          .from('basket_lots')
          .select('id, basket_id, lot_id, active_pct, created_at')
          .order('id')
          .range(from, to),
      )) as BasketLotRow[],
  });
}

/**
 * Basket name tags per lot, for the green inventory page.
 * Informational only — a tag never restricts where a lot can be used.
 */
export function useBasketTagsByLot() {
  const { data: baskets = [] } = useBasketsQuery();
  const { data: members = [] } = useBasketMembersQuery();
  return useMemo(() => {
    const byId = new Map(baskets.map(b => [b.id, b]));
    const m = new Map<string, { id: string; name: string; is_active: boolean; active: boolean }[]>();
    for (const r of members) {
      const b = byId.get(r.basket_id);
      if (!b) continue;
      const list = m.get(r.lot_id) ?? [];
      list.push({ id: b.id, name: b.name, is_active: b.is_active, active: r.active_pct != null });
      m.set(r.lot_id, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [baskets, members]);
}

/** Everything the Baskets pages need, plus a label for each lot. */
export function useBasketData() {
  const basketsQ = useBasketsQuery();
  const membersQ = useBasketMembersQuery();

  const lotsQ = useQuery({
    queryKey: BASKET_QUERY_KEYS.lots,
    queryFn: async () =>
      (await fetchAllRows((from, to) =>
        supabase.from('green_lots').select(LOT_COLUMNS).order('id').range(from, to),
      )) as unknown as BasketGreenLot[],
  });

  // Same label sources the Lots page uses: contract name, then lot identifier, then origin.
  const labelsQ = useQuery({
    queryKey: BASKET_QUERY_KEYS.labels,
    queryFn: async () => {
      const [{ data: contracts, error: cErr }, purchaseLines] = await Promise.all([
        supabase.from('green_contracts').select('id, name'),
        fetchAllRows((from, to) =>
          supabase
            .from('green_purchase_lines')
            .select('id, lot_id, lot_identifier, origin_country')
            .order('id')
            .range(from, to),
        ),
      ]);
      if (cErr) throw cErr;
      return {
        contractName: Object.fromEntries((contracts ?? []).map(c => [c.id, c.name])) as Record<string, string>,
        purchaseLineByLot: Object.fromEntries(
          purchaseLines.filter(p => p.lot_id).map(p => [p.lot_id!, p]),
        ) as Record<string, { lot_identifier: string | null; origin_country: string | null }>,
      };
    },
    staleTime: 60_000,
  });

  const baskets = useMemo(() => basketsQ.data ?? [], [basketsQ.data]);
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const lots = useMemo(() => lotsQ.data ?? [], [lotsQ.data]);
  const lotsById = useMemo(() => new Map(lots.map(l => [l.id, l])), [lots]);
  const basketsById = useMemo(() => new Map(baskets.map(b => [b.id, b])), [baskets]);

  const lotLabel = useMemo(() => {
    const labels = labelsQ.data;
    return (lot: BasketGreenLot): string | null => {
      const contract = lot.contract_id ? labels?.contractName[lot.contract_id] : null;
      const pl = labels?.purchaseLineByLot[lot.id];
      return contract || lot.lot_identifier || pl?.lot_identifier || pl?.origin_country || null;
    };
  }, [labelsQ.data]);

  const views = useMemo(() => {
    const now = new Date();
    return baskets.map(b => buildBasketView(b, members, lotsById, basketsById, now));
  }, [baskets, members, lotsById, basketsById]);

  const viewById = useMemo(() => new Map<string, BasketView>(views.map(v => [v.basket.id, v])), [views]);

  return {
    isLoading: basketsQ.isLoading || membersQ.isLoading || lotsQ.isLoading,
    error: basketsQ.error || membersQ.error || lotsQ.error,
    baskets,
    members,
    lots,
    lotsById,
    basketsById,
    views,
    viewById,
    lotLabel,
  };
}

// ─── Mutations ───────────────────────────────────────────────────────────

interface DbError { code?: string; message?: string }

function asDbError(err: unknown): DbError {
  return (err && typeof err === 'object' ? err : {}) as DbError;
}

function errMessage(err: unknown, fallback: string): string {
  const e = asDbError(err);
  if (e.code === '23505') return 'A basket with that name already exists.';
  return e.message || fallback;
}

export function useBasketMutations() {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: BASKET_QUERY_KEYS.baskets });
    queryClient.invalidateQueries({ queryKey: BASKET_QUERY_KEYS.members });
  };

  const createBasket = useMutation({
    mutationFn: async (input: { name: string; notes?: string | null }) => {
      const { data, error } = await supabase
        .from('baskets')
        .insert({ name: input.name.trim(), notes: input.notes?.trim() || null, created_by: authUser?.id ?? null })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => { toast.success('Basket created'); invalidate(); },
    onError: (err: unknown) => toast.error(errMessage(err, 'Failed to create basket')),
  });

  const updateBasket = useMutation({
    mutationFn: async (input: { id: string; name?: string; notes?: string | null; is_active?: boolean }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
      if (input.is_active !== undefined) updates.is_active = input.is_active;
      const { error } = await supabase.from('baskets').update(updates).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Saved'); invalidate(); },
    onError: (err: unknown) => toast.error(errMessage(err, 'Failed to save basket')),
  });

  /** Deletes the basket and its memberships (never the lots). Guarded for roast-group use. */
  const deleteBasket = useMutation({
    mutationFn: async (id: string) => {
      const users = await findRoastGroupsUsingBasket(id);
      if (users.length > 0) {
        throw new Error(`Used by roast group${users.length === 1 ? '' : 's'}: ${users.join(', ')}. Deactivate it instead.`);
      }
      const { error } = await supabase.from('baskets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Basket deleted — its lots are untouched'); invalidate(); },
    onError: (err: unknown) => toast.error(asDbError(err).message || 'Failed to delete basket'),
  });

  const addLots = useMutation({
    mutationFn: async (input: { basketId: string; lotIds: string[] }) => {
      if (input.lotIds.length === 0) return;
      const { error } = await supabase.from('basket_lots').insert(
        input.lotIds.map(lot_id => ({
          basket_id: input.basketId,
          lot_id,
          active_pct: null,
          created_by: authUser?.id ?? null,
        })),
      );
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(v.lotIds.length === 1 ? 'Lot added as lined up' : `${v.lotIds.length} lots added as lined up`); invalidate(); },
    onError: (err: unknown) => toast.error(asDbError(err).code === '23505' ? 'That lot is already in this basket.' : errMessage(err, 'Failed to add lots')),
  });

  /** Set a member's %: a number makes it active, null moves it back to lined up. */
  const setActivePct = useMutation({
    mutationFn: async (input: { memberId: string; activePct: number | null }) => {
      const { error } = await supabase.from('basket_lots').update({ active_pct: input.activePct }).eq('id', input.memberId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (err: unknown) => toast.error(asDbError(err).message || 'Failed to update lot'),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('basket_lots').delete().eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Lot removed from basket'); invalidate(); },
    onError: (err: unknown) => toast.error(asDbError(err).message || 'Failed to remove lot'),
  });

  /**
   * Create a placeholder green lot from a sample and line it up in the basket.
   *
   * Lot numbers come from the same atomic sequence every other lot uses
   * (allocateSingleLotNumber). A placeholder has no purchase order yet, so it
   * does not consume a PO number: its number carries P0000 in the PO slot.
   */
  const addFromSample = useMutation({
    mutationFn: async (input: {
      basketId: string;
      sample: { id: string; name: string; origin: string | null; vendor_id: string | null; warehouse_location: string | null };
      bags: number;
      bagSizeKg: number;
    }) => {
      let vendorAbbr: string | null = null;
      if (input.sample.vendor_id) {
        const { data: v } = await supabase.from('green_vendors').select('abbreviation').eq('id', input.sample.vendor_id).maybeSingle();
        vendorAbbr = v?.abbreviation ?? null;
      }
      const noPo: AllocatedPo = { poNumber: '', poDigits: '0000', vendorAbbr: (vendorAbbr || '???').toUpperCase() };
      const lotNumber = await allocateSingleLotNumber(noPo, originCodeFromText(input.sample.origin));

      const { data: lot, error: lotErr } = await supabase
        .from('green_lots')
        .insert({
          lot_number: lotNumber,
          is_placeholder: true,
          source_sample_id: input.sample.id,
          status: 'EN_ROUTE',
          bags_released: input.bags,
          bag_size_kg: input.bagSizeKg,
          kg_on_hand: 0,
          lot_identifier: input.sample.name,
          warehouse_location: input.sample.warehouse_location,
          notes_internal: `Placeholder created from sample "${input.sample.name}" (Baskets).`,
          created_by: authUser?.id ?? null,
        })
        .select('id, lot_number')
        .single();
      if (lotErr) throw lotErr;

      const { error: memErr } = await supabase.from('basket_lots').insert({
        basket_id: input.basketId,
        lot_id: lot.id,
        active_pct: null,
        created_by: authUser?.id ?? null,
      });
      if (memErr) throw memErr;
      return lot.lot_number as string;
    },
    onSuccess: (lotNumber) => {
      toast.success(`Placeholder lot ${lotNumber} created and lined up`);
      invalidate();
      queryClient.invalidateQueries({ queryKey: BASKET_QUERY_KEYS.lots });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
    },
    onError: (err: unknown) => toast.error(asDbError(err).message || 'Failed to create placeholder lot'),
  });

  return { createBasket, updateBasket, deleteBasket, addLots, setActivePct, removeMember, addFromSample };
}
