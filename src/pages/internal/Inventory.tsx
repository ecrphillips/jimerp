import React, { useState, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Scale, Plus, Minus, History, AlertTriangle, ArrowLeft } from 'lucide-react';
import { PackagingBadge } from '@/components/PackagingBadge';
import { format } from 'date-fns';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { WipAdjustmentModal } from '@/components/inventory/WipAdjustmentModal';
import { WipFloorCountModal, type WipFloorRow } from '@/components/inventory/WipFloorCountModal';
import { computeAuthoritativeWip, useAuthoritativeFg } from '@/hooks/useAuthoritativeInventory';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useBlendHolds, heldKgByGroup } from '@/hooks/useBlendHolds';
import { BlendHoldsPanel } from '@/components/production/BlendHoldsPanel';
import { useOrderCreator } from '@/hooks/useOrderCreator';
import { availableWipKg, isNegativeBalance, type AvailabilityMode } from '@/lib/inventoryAvailability';
import { fgFloorCountDelta } from '@/lib/fgFloorCount';
import { FGCountInput } from '@/components/products/FGCountInput';

function AvailabilityToggle({ mode, onChange, negativeCount }: { mode: AvailabilityMode; onChange: (v: AvailabilityMode) => void; negativeCount: number }) {
  const opts: { v: AvailabilityMode; label: string }[] = [
    { v: 'available', label: 'Available' },
    { v: 'negative', label: negativeCount > 0 ? `Negative · ${negativeCount}` : 'Negative' },
    { v: 'all', label: 'All' },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-md border p-0.5" role="group" aria-label="Rows to show">
      {opts.map((o) => (
        <Button
          key={o.v}
          size="sm"
          className={`h-7 ${o.v === 'negative' && negativeCount > 0 && mode !== 'negative' ? 'text-destructive' : ''}`}
          variant={mode === o.v ? 'default' : 'ghost'}
          aria-pressed={mode === o.v}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

interface LastCount {
  created_at: string;
  created_by: string | null;
}

/**
 * "Last counted by X at <time>" footnote for a WIP/FG row. Reads the most recent
 * manual ADJUSTMENT (floor count / recount) written to inventory_transactions and
 * resolves the user id to a name. Display only — no ledger writes.
 */
function LastCountedLine({ entry }: { entry?: LastCount }) {
  const { data: profile } = useOrderCreator(entry?.created_by);
  if (!entry) return null;
  const who = profile?.name?.trim() || profile?.email || 'Unknown';
  return (
    <span className="block text-xs font-normal text-muted-foreground">
      Last counted by {who} at {format(new Date(entry.created_at), 'MMM d, h:mm a')}
    </span>
  );
}

type WipAdjustmentReason = 'LOSS' | 'COUNT_ADJUSTMENT' | 'CONTAMINATION' | 'OTHER';

interface WipByRoastGroup {
  roast_group: string;
  roasted_kg: number;
  blended_kg: number;
  consumed_kg: number;
  adjusted_kg: number;
  net_wip_kg: number;
}

interface FgInventoryRow {
  id: string;
  product_id: string;
  units_on_hand: number;
  notes: string | null;
  updated_at: string;
  product: {
    id: string;
    product_name: string;
    bag_size_g: number;
    packaging_variant: string | null;
    client: {
      name: string;
    };
  };
}

export default function Inventory() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  
  // Read from query params
  const fromParam = searchParams.get('from');
  const tabParam = searchParams.get('tab');
  const showBackToPack = fromParam === 'pack';
  
  const [activeTab, setActiveTab] = useState(tabParam === 'fg' ? 'fg' : 'wip');
  
  // WIP Adjustment dialog state
  const [showWipAdjust, setShowWipAdjust] = useState(false);
  const [adjustRoastGroup, setAdjustRoastGroup] = useState('');
  const [adjustKgDelta, setAdjustKgDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState<WipAdjustmentReason>('COUNT_ADJUSTMENT');
  const [adjustNotes, setAdjustNotes] = useState('');
  
  // WIP delete confirmation state
  const [confirmClearWip, setConfirmClearWip] = useState<string | null>(null);
  const isAdmin = authUser?.role === 'ADMIN';
  const isAdminOrOps = authUser?.role === 'ADMIN' || authUser?.role === 'OPS';

  // New "set absolute balance" modal state
  const [absoluteAdjustOpen, setAbsoluteAdjustOpen] = useState(false);
  const [absoluteAdjustGroup, setAbsoluteAdjustGroup] = useState<{ key: string; name: string; balance: number } | null>(null);

  // Roast-group picker for opening-balance / new-group flow (always available)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerGroup, setPickerGroup] = useState<string>('');

  // WIP Floor Count modal
  const [floorCountOpen, setFloorCountOpen] = useState(false);

  // "Available only" view filters: roasted-not-packed (WIP) and finished-not-picked (FG)
  const [wipMode, setWipMode] = useState<AvailabilityMode>('available');
  const wipAvailableOnly = wipMode === 'available';
  const [fgMode, setFgMode] = useState<AvailabilityMode>('available');
  const fgAvailableOnly = fgMode === 'available';

  // ===== WIP Tab Queries =====
  
  // Fetch roast groups to identify blends
  const { data: roastGroupsInfo } = useQuery({
    queryKey: ['roast-groups-info-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name, is_blend, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });
  
  // Fetch ALL inventory transactions for WIP calculation (ledger-based source of truth)
  const { data: inventoryTransactions } = useQuery({
    queryKey: ['inventory-transactions-wip'],
    queryFn: async () =>
      fetchAllRows((from, to) =>
        supabase
          .from('inventory_transactions')
          .select('id, roast_group, quantity_kg, notes, transaction_type')
          .not('roast_group', 'is', null)
          .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'BLEND', 'ADJUSTMENT', 'LOSS'])
          .order('id', { ascending: true })
          .range(from, to),
      ),
  });

  // Most recent manual ADJUSTMENT per roast_group and per product — powers the
  // "last counted by X at <time>" footnote on WIP and FG rows. Read-only.
  const { data: lastCounts } = useQuery({
    queryKey: ['inventory-last-counts'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('inventory_transactions')
          .select('id, roast_group, product_id, created_at, created_by')
          .eq('transaction_type', 'ADJUSTMENT')
          .eq('is_system_generated', false)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      );
      const byGroup: Record<string, LastCount> = {};
      const byProduct: Record<string, LastCount> = {};
      for (const r of data ?? []) {
        if (r.roast_group && !byGroup[r.roast_group]) {
          byGroup[r.roast_group] = { created_at: r.created_at, created_by: r.created_by };
        }
        if (r.product_id && !byProduct[r.product_id]) {
          byProduct[r.product_id] = { created_at: r.created_at, created_by: r.created_by };
        }
      }
      return { byGroup, byProduct };
    },
  });

  // Fetch all roast groups
  const { data: roastGroups } = useQuery({
    queryKey: ['all-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group')
        .eq('is_active', true);
      if (error) throw error;
      return data?.map(r => r.roast_group) ?? [];
    },
  });

  const activeRoastGroupKeys = useMemo(() => new Set(roastGroups ?? []), [roastGroups]);

  // Calculate WIP by roast group using the SINGLE SOURCE OF TRUTH:
  // computeAuthoritativeWip — the same reducer used by AuthoritativeTotals everywhere
  // else in the app. This ensures floor-count baselines, the WIP table on this page,
  // and the production-tab dropdowns all agree.
  //
  // Formula (per group):
  //   wip_net_kg = sum(ROAST_OUTPUT) - sum(|PACK_CONSUME_WIP|) + sum(BLEND) + sum(ADJUSTMENT + LOSS)
  // Blend movement (BLEND rows) is tracked in its own column; manual adjustments
  // (floor counts, recounts, opening balances) are ADJUSTMENT rows in
  // inventory_transactions now — the separate wip_adjustments table is retired.
  const { data: blendHolds } = useBlendHolds();
  const heldByGroup = useMemo(() => heldKgByGroup(blendHolds), [blendHolds]);
  const wipByRoastGroup = useMemo((): WipByRoastGroup[] => {
    const computed = computeAuthoritativeWip(
      (inventoryTransactions ?? []).map((tx) => ({
        roast_group: tx.roast_group,
        quantity_kg: tx.quantity_kg,
        transaction_type: tx.transaction_type,
      })),
      [], // no reservation accounting in the inventory-page table
    );

    return Object.values(computed)
      .map((w) => ({
        roast_group: w.roast_group,
        roasted_kg: w.roasted_completed_kg,
        blended_kg: w.blended_kg,
        consumed_kg: w.packed_consumed_kg,
        adjusted_kg: w.adjustments_kg,
        net_wip_kg: w.wip_net_kg,
      }))
      .filter((row) => row.roasted_kg !== 0 || row.blended_kg !== 0 || row.consumed_kg !== 0 || row.adjusted_kg !== 0)
      .sort((a, b) => a.roast_group.localeCompare(b.roast_group));
  }, [inventoryTransactions]);

  // WIP adjustment mutation — writes a balancing ADJUSTMENT row to the
  // inventory_transactions ledger (the single source of truth). The reason is
  // folded into notes; the row is stamped with the logged-in user and now().
  const createWipAdjustment = useMutation({
    mutationFn: async () => {
      const delta = parseFloat(adjustKgDelta);
      if (isNaN(delta) || delta === 0) throw new Error('Invalid kg delta');

      const note = adjustNotes?.trim()
        ? `WIP adjustment (${adjustReason}): ${adjustNotes.trim()}`
        : `WIP adjustment (${adjustReason})`;
      const { error } = await supabase
        .from('inventory_transactions')
        .insert({
          transaction_type: 'ADJUSTMENT',
          roast_group: adjustRoastGroup,
          quantity_kg: delta,
          notes: note,
          created_by: authUser?.id,
          is_system_generated: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('WIP adjustment recorded');
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions-wip'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-wip-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-last-counts'] });
      setShowWipAdjust(false);
      setAdjustKgDelta('');
      setAdjustNotes('');
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to record adjustment');
    },
  });

  // WIP history delete mutation (orphaned roast groups only).
  // inventory_transactions is the only live WIP ledger now.
  const deleteWipHistory = useMutation({
    mutationFn: async (roastGroupKey: string) => {
      const { error: e1 } = await supabase
        .from('inventory_transactions')
        .delete()
        .eq('roast_group', roastGroupKey);
      if (e1) throw e1;
    },
    onSuccess: () => {
      toast.success('WIP history cleared');
      setConfirmClearWip(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions-wip'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-wip-ledger'] });
    },
    onError: (err: any) => {
      console.error(err);
      toast.error(err.message || 'Failed to clear WIP history');
    },
  });

  // ===== Finished Goods Tab =====
  
  // FG on-hand is derived from the SAME authoritative source as the production
  // tabs / Authoritative Totals box: the inventory_transactions ledger
  // (PACK_PRODUCE_FG + SHIP_CONSUME_FG + ADJUSTMENT units per product) so every
  // surface agrees and a floor-count ADJUSTMENT row moves the on-hand number.
  const { data: authoritativeFg } = useAuthoritativeFg();

  // Fetch all active products (for adding new FG entries)
  const { data: allProducts } = useQuery({
    queryKey: ['all-active-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g, packaging_variant, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // FG floor count — writes ONE balancing ADJUSTMENT row to the
  // inventory_transactions ledger (product-scoped, quantity_units = counted −
  // current ledger balance). No writes to the retired fg_inventory /
  // fg_inventory_log tables. Stamped with the logged-in user and now().
  const upsertFgInventory = useMutation({
    mutationFn: async ({ productId, newUnits }: {
      productId: string;
      newUnits: number;
    }) => {
      const transactions = await fetchAllRows((from, to) =>
        supabase.from('inventory_transactions')
          .select('quantity_units')
          .eq('product_id', productId)
          .in('transaction_type', ['PACK_PRODUCE_FG', 'SHIP_CONSUME_FG', 'ADJUSTMENT'])
          .order('id', { ascending: true })
          .range(from, to),
      );
      const signedBalance = transactions.reduce((sum, tx) => sum + Number(tx.quantity_units ?? 0), 0);
      const unitsDelta = fgFloorCountDelta(newUnits, signedBalance);
      if (!unitsDelta) return;
      const { error } = await supabase
        .from('inventory_transactions')
        .insert({
          transaction_type: 'ADJUSTMENT',
          product_id: productId,
          quantity_units: unitsDelta,
          notes: `FG floor count: counted ${newUnits} units (delta ${unitsDelta >= 0 ? '+' : ''}${unitsDelta})`,
          created_by: authUser?.id,
          is_system_generated: false,
        });
      if (error) throw error;
      return newUnits;
    },
    onSuccess: async (newUnits) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['authoritative-fg-ledger'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-last-counts'] }),
      ]);
      if (newUnits != null) toast.success(`Counted ${newUnits} units.`);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory');
    },
  });

  const handleFgAdjust = (productId: string, currentUnits: number, delta: number) => {
    if (upsertFgInventory.isPending) return;
    const newUnits = Math.max(0, currentUnits + delta);
    upsertFgInventory.mutate({ productId, newUnits });
  };

  const handleFgSet = (productId: string, newUnits: number) => {
    if (upsertFgInventory.isPending) return;
    upsertFgInventory.mutate({ productId, newUnits });
  };

  const openAdjustDialog = (roastGroup: string) => {
    setAdjustRoastGroup(roastGroup);
    setAdjustKgDelta('');
    setAdjustReason('COUNT_ADJUSTMENT');
    setAdjustNotes('');
    setShowWipAdjust(true);
  };

  const displayNameFor = (rgKey: string): string => {
    const info = roastGroupsInfo?.find((r) => r.roast_group === rgKey);
    return info?.display_name || rgKey;
  };

  const openAbsoluteAdjust = (rgKey: string, currentBalance: number) => {
    setAbsoluteAdjustGroup({ key: rgKey, name: displayNameFor(rgKey), balance: currentBalance });
    setAbsoluteAdjustOpen(true);
  };

  // Roasted-not-packed view: roast groups with positive net WIP awaiting packing.
  const wipAvailableRows = useMemo(
    () => wipByRoastGroup.filter((r) => availableWipKg(r.net_wip_kg, heldByGroup[r.roast_group] ?? 0) > 0),
    [wipByRoastGroup, heldByGroup],
  );
  const wipNegativeRows = useMemo(() => wipByRoastGroup.filter((r) => isNegativeBalance(r.net_wip_kg)), [wipByRoastGroup]);
  const wipDisplayRows = wipMode === 'available' ? wipAvailableRows : wipMode === 'negative' ? wipNegativeRows : wipByRoastGroup;
  const wipAvailableTotalKg = useMemo(
    () => wipAvailableRows.reduce((sum, r) => sum + availableWipKg(r.net_wip_kg, heldByGroup[r.roast_group] ?? 0), 0),
    [wipAvailableRows, heldByGroup],
  );

  // One row per active product, units sourced from the authoritative FG map.
  const fgRows = useMemo<FgInventoryRow[]>(() => {
    const fg = authoritativeFg ?? {};
    return (allProducts ?? []).map((p) => ({
      id: p.id,
      product_id: p.id,
      units_on_hand: fg[p.id]?.fg_available_units ?? 0,
      notes: null,
      updated_at: '',
      product: {
        id: p.id,
        product_name: p.product_name,
        bag_size_g: p.bag_size_g,
        packaging_variant: p.packaging_variant,
        client: p.client,
      },
    })) as unknown as FgInventoryRow[];
  }, [allProducts, authoritativeFg]);

  // Finished-not-picked view: products with packed units on hand not yet shipped.
  const fgAvailableRows = useMemo(
    () => fgRows.filter((r) => r.units_on_hand > 0),
    [fgRows],
  );
  const fgNegativeRows = useMemo(
    () => fgRows.filter((r) => isNegativeBalance(authoritativeFg?.[r.product_id]?.fg_signed_units ?? 0, 1)),
    [fgRows, authoritativeFg],
  );
  const fgDisplayRows = fgMode === 'available' ? fgAvailableRows : fgMode === 'negative' ? fgNegativeRows : fgRows;
  const fgAvailableUnits = useMemo(
    () => fgAvailableRows.reduce((sum, r) => sum + r.units_on_hand, 0),
    [fgAvailableRows],
  );

  return (
    <div className="p-6 space-y-6">
      <GreenCoffeeAlerts />
      {/* Context-aware back navigation */}
      {showBackToPack && (
        <Link 
          to="/production?tab=pack" 
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pack
        </Link>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Levels</h1>
          <p className="text-muted-foreground">
            Current on-hand snapshot of WIP (roasted coffee) and finished goods (packed units)
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="wip" className="gap-2">
            <Scale className="h-4 w-4" />
            WIP (Roasted)
          </TabsTrigger>
          <TabsTrigger value="fg" className="gap-2">
            <Package className="h-4 w-4" />
            Finished Goods
          </TabsTrigger>
        </TabsList>

        {/* WIP Tab */}
        <TabsContent value="wip" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Work-in-Progress by Roast Group</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Net WIP = Roasted + Blended − Packing Consumed + Adjustments
                  </p>
                  <p className="text-xs text-muted-foreground">
                    For post-roast blends, WIP is created when components are blended, not when components are roasted.
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {wipAvailableTotalKg.toFixed(1)} kg available to pack across {wipAvailableRows.length}{' '}
                    {wipAvailableRows.length === 1 ? 'group' : 'groups'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <AvailabilityToggle mode={wipMode} onChange={setWipMode} negativeCount={wipNegativeRows.length} />
                  {isAdminOrOps && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPickerGroup('');
                          setPickerOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        Add WIP for roast group
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFloorCountOpen(true)}
                      >
                        <Scale className="h-4 w-4" />
                        Floor Count
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4"><BlendHoldsPanel /></div>
              {wipDisplayRows.length === 0 ? (
                <div className="py-6">
                  <p className="text-muted-foreground">
                    {wipMode === 'negative' && wipByRoastGroup.length > 0
                      ? 'No negative balances.'
                      : wipAvailableOnly && wipByRoastGroup.length > 0
                      ? 'No roasted coffee is currently available to pack. Choose “All” to see every group.'
                      : 'No WIP data available. Use “Add WIP for roast group” above to enter an opening balance.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2">Roast Group</th>
                      <th className="pb-2 text-right">Roasted</th>
                      <th className="pb-2 text-right">Blended</th>
                      <th className="pb-2 text-right">Consumed</th>
                      <th className="pb-2 text-right">Adjustments</th>
                      <th className="pb-2 text-right">Net WIP</th>
                      <th className="pb-2 text-right">Held for blend</th>
                      <th className="pb-2 text-right">Available</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wipDisplayRows.map((row) => (
                      <tr key={row.roast_group} className="border-b">
                        <td className="py-3 font-medium">
                          {row.roast_group}
                          <LastCountedLine entry={lastCounts?.byGroup[row.roast_group]} />
                        </td>
                        <td className="py-3 text-right">{row.roasted_kg.toFixed(1)} kg</td>
                        <td className="py-3 text-right">
                          {row.blended_kg !== 0 && (
                            <span className={row.blended_kg > 0 ? 'text-green-600' : 'text-destructive'}>
                              {row.blended_kg > 0 ? '+' : ''}{row.blended_kg.toFixed(1)} kg
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right text-muted-foreground">
                          −{row.consumed_kg.toFixed(1)} kg
                        </td>
                        <td className="py-3 text-right">
                          {row.adjusted_kg !== 0 && (
                            <span className={row.adjusted_kg > 0 ? 'text-green-600' : 'text-destructive'}>
                              {row.adjusted_kg > 0 ? '+' : ''}{row.adjusted_kg.toFixed(1)} kg
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <span className={`font-semibold ${row.net_wip_kg < 0 ? 'text-destructive' : ''}`}>
                            {row.net_wip_kg.toFixed(1)} kg
                          </span>
                        </td>
                        <td className="py-3 text-right text-muted-foreground">
                          {(heldByGroup[row.roast_group] ?? 0) > 0 ? `${heldByGroup[row.roast_group].toFixed(1)} kg` : ''}
                        </td>
                        <td className="py-3 text-right font-semibold">
                          {availableWipKg(row.net_wip_kg, heldByGroup[row.roast_group] ?? 0).toFixed(1)} kg
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isAdminOrOps && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                title="Adjust WIP balance"
                                onClick={() => openAbsoluteAdjust(row.roast_group, row.net_wip_kg)}
                              >
                                Adjust
                              </Button>
                            )}
                            {authUser?.role === 'ADMIN' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setConfirmClearWip(row.roast_group)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Finished Goods Tab */}
        <TabsContent value="fg" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Finished Goods Inventory</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Packed units on hand by product
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {fgAvailableUnits} {fgAvailableUnits === 1 ? 'unit' : 'units'} finished awaiting pick across{' '}
                    {fgAvailableRows.length} {fgAvailableRows.length === 1 ? 'product' : 'products'}
                  </p>
                </div>
                <AvailabilityToggle mode={fgMode} onChange={setFgMode} negativeCount={fgNegativeRows.length} />
              </div>
            </CardHeader>
            <CardContent>
              {fgMode === 'negative' && fgDisplayRows.length === 0 ? (
                <p className="text-muted-foreground py-4">No negative balances.</p>
              ) : fgAvailableOnly && fgDisplayRows.length === 0 ? (
                <p className="text-muted-foreground py-4">
                  No finished goods are currently awaiting pick. Choose “All” to see every product.
                </p>
              ) : fgMode === 'all' && fgRows.length === 0 ? (
                <p className="text-muted-foreground py-4">No products configured.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2">Product</th>
                      <th className="pb-2">Client</th>
                      <th className="pb-2">Format</th>
                      <th className="pb-2 text-right">Units on Hand</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fgDisplayRows.map((row) => (
                      <FgInventoryRow
                        key={row.id}
                        row={row}
                        lastCount={lastCounts?.byProduct[row.product_id]}
                        onAdjust={(delta) => handleFgAdjust(row.product_id, row.units_on_hand, delta)}
                        onSet={(value) => handleFgSet(row.product_id, value)}
                        disabled={upsertFgInventory.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* WIP Adjustment Dialog */}
      <Dialog open={showWipAdjust} onOpenChange={setShowWipAdjust}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust WIP Inventory</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Roast Group</Label>
              <p className="font-medium">{adjustRoastGroup}</p>
            </div>
            <div>
              <Label htmlFor="kgDelta">Adjustment (kg)</Label>
              <Input
                id="kgDelta"
                type="number"
                step="0.1"
                value={adjustKgDelta}
                onChange={(e) => setAdjustKgDelta(e.target.value)}
                placeholder="e.g., -2.5 for loss"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use negative for losses, positive for found inventory
              </p>
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={adjustReason} onValueChange={(v) => setAdjustReason(v as WipAdjustmentReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOSS">Loss</SelectItem>
                  <SelectItem value="COUNT_ADJUSTMENT">Count Adjustment</SelectItem>
                  <SelectItem value="CONTAMINATION">Contamination</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWipAdjust(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createWipAdjustment.mutate()}
              disabled={!adjustKgDelta || createWipAdjustment.isPending}
            >
              {createWipAdjustment.isPending ? 'Saving...' : 'Save Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIP Clear History Confirmation Dialog */}
      <Dialog open={confirmClearWip !== null} onOpenChange={(open) => { if (!open) setConfirmClearWip(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear WIP History</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Clear WIP history for <span className="font-semibold text-foreground">{confirmClearWip}</span>? This will permanently delete all inventory transaction records for this roast group. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearWip(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteWipHistory.isPending}
              onClick={() => confirmClearWip && deleteWipHistory.mutate(confirmClearWip)}
            >
              {deleteWipHistory.isPending ? 'Clearing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New absolute-balance WIP Adjustment Modal */}
      {absoluteAdjustGroup && (
        <WipAdjustmentModal
          open={absoluteAdjustOpen}
          onOpenChange={(o) => {
            setAbsoluteAdjustOpen(o);
            if (!o) setAbsoluteAdjustGroup(null);
          }}
          roastGroup={absoluteAdjustGroup.key}
          roastGroupDisplayName={absoluteAdjustGroup.name}
          currentBalanceKg={absoluteAdjustGroup.balance}
        />
      )}

      {/* Roast group picker — always available from the WIP tab header */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pick a roast group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose a roast group to adjust its WIP balance.
            </p>
            <Select value={pickerGroup} onValueChange={setPickerGroup}>
              <SelectTrigger><SelectValue placeholder="Select roast group" /></SelectTrigger>
              <SelectContent>
                {(roastGroupsInfo ?? [])
                  .slice()
                  .sort((a, b) =>
                    (a.display_name || a.roast_group).localeCompare(b.display_name || b.roast_group),
                  )
                  .map((rg) => {
                    const existing = wipByRoastGroup.find((r) => r.roast_group === rg.roast_group);
                    const balanceLabel = existing
                      ? `${existing.net_wip_kg.toFixed(1)} kg`
                      : '—';
                    return (
                      <SelectItem key={rg.roast_group} value={rg.roast_group}>
                        <div className="flex flex-col">
                          <span>{rg.display_name || rg.roast_group}</span>
                          <span className="text-xs text-muted-foreground">
                            Current WIP: {balanceLabel}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button
              disabled={!pickerGroup}
              onClick={() => {
                const existing = wipByRoastGroup.find((r) => r.roast_group === pickerGroup);
                openAbsoluteAdjust(pickerGroup, existing?.net_wip_kg ?? 0);
                setPickerOpen(false);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIP Floor Count modal */}
      <WipFloorCountModal
        open={floorCountOpen}
        onOpenChange={setFloorCountOpen}
        rows={(roastGroupsInfo ?? []).map<WipFloorRow>((rg) => {
          const existing = wipByRoastGroup.find((r) => r.roast_group === rg.roast_group);
          return {
            roast_group: rg.roast_group,
            display_name: rg.display_name || rg.roast_group,
            current_kg: existing?.net_wip_kg ?? 0,
          };
        })}
      />
    </div>
  );
}

// Sub-component for FG inventory row with inline controls
function FgInventoryRow({
  row,
  lastCount,
  onAdjust,
  onSet,
  disabled,
}: {
  row: FgInventoryRow;
  lastCount?: LastCount;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <tr className="border-b">
      <td className="py-3 font-medium">
        {row.product.product_name}
        <LastCountedLine entry={lastCount} />
      </td>
      <td className="py-3">{row.product.client?.name ?? '—'}</td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs">{row.product.bag_size_g}g</span>
          {row.product.packaging_variant && (
            <PackagingBadge variant={row.product.packaging_variant as any} />
          )}
        </div>
      </td>
      <td className="py-3 text-right font-medium">{row.units_on_hand}</td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => onAdjust(-1)}
            aria-label={`Decrease on hand for ${row.product.product_name}`}
            disabled={disabled || row.units_on_hand <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <FGCountInput
            units={row.units_on_hand}
            productName={row.product.product_name}
            disabled={disabled}
            onCount={onSet}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => onAdjust(1)}
            aria-label={`Increase on hand for ${row.product.product_name}`}
            disabled={disabled}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}