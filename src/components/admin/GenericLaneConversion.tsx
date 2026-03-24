import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

export function GenericLaneConversion() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [openDialog, setOpenDialog] = useState<null | 'batches' | 'wip' | 'swap' | 'fg'>(null);

  // --- Shared queries (enabled when any dialog is open) ---
  const anyOpen = openDialog !== null;

  const { data: activeRoastGroups = [] } = useQuery({
    queryKey: ['admin-active-rg'],
    enabled: anyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name')
        .eq('is_active', true)
        .order('display_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: genericRgKey, isLoading: genericLoading } = useQuery({
    queryKey: ['admin-generic-rg'],
    enabled: anyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name')
        .or('display_name.ilike.%generic%,display_name.ilike.%unspecified%')
        .limit(1);
      if (error) throw error;
      return data?.[0]?.roast_group ?? null;
    },
  });

  const { data: activeProducts = [] } = useQuery({
    queryKey: ['admin-active-products'],
    enabled: anyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, roast_group, account_id, accounts(account_name)')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        product_name: string;
        roast_group: string | null;
        account_id: string | null;
        accounts: { account_name: string } | null;
      }>;
    },
  });

  const nonGenericRgs = useMemo(
    () => activeRoastGroups.filter((rg) => rg.roast_group !== genericRgKey),
    [activeRoastGroups, genericRgKey],
  );

  const nonGenericProducts = useMemo(
    () => activeProducts.filter((p) => p.roast_group !== genericRgKey),
    [activeProducts, genericRgKey],
  );

  const productsByAccount = useMemo(() => {
    const map = new Map<string, typeof nonGenericProducts>();
    for (const p of nonGenericProducts) {
      const key = p.accounts?.account_name ?? 'No Account';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [nonGenericProducts]);

  const noGeneric = anyOpen && !genericLoading && genericRgKey === null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Generic Lane Conversion</CardTitle>
          </div>
          <CardDescription>
            Reassign batches, WIP, orders, and finished goods from the generic catch-all lane to real roast groups and products.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {noGeneric && (
            <div className="flex items-center gap-2 text-sm text-amber-600 mb-4">
              <AlertTriangle className="h-4 w-4" />
              No generic roast group found. Create a roast group with &quot;Generic&quot; or &quot;Unspecified&quot; in its name first.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpenDialog('batches')}>Reassign Batches</Button>
            <Button variant="outline" onClick={() => setOpenDialog('wip')}>Move WIP</Button>
            <Button variant="outline" onClick={() => setOpenDialog('swap')}>Swap Order Products</Button>
            <Button variant="outline" onClick={() => setOpenDialog('fg')}>Reassign FG Inventory</Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog 1 — Reassign Batches */}
      <ReassignBatchesDialog
        open={openDialog === 'batches'}
        onClose={() => setOpenDialog(null)}
        genericRgKey={genericRgKey}
        nonGenericRgs={nonGenericRgs}
        queryClient={queryClient}
      />

      {/* Dialog 2 — Move WIP */}
      <MoveWipDialog
        open={openDialog === 'wip'}
        onClose={() => setOpenDialog(null)}
        genericRgKey={genericRgKey}
        nonGenericRgs={nonGenericRgs}
        activeRoastGroups={activeRoastGroups}
        authUserId={authUser?.id ?? null}
        queryClient={queryClient}
      />

      {/* Dialog 3 — Swap Order Products */}
      <SwapOrderProductsDialog
        open={openDialog === 'swap'}
        onClose={() => setOpenDialog(null)}
        genericRgKey={genericRgKey}
        productsByAccount={productsByAccount}
        queryClient={queryClient}
      />

      {/* Dialog 4 — Reassign FG Inventory */}
      <ReassignFgDialog
        open={openDialog === 'fg'}
        onClose={() => setOpenDialog(null)}
        genericRgKey={genericRgKey}
        nonGenericProducts={nonGenericProducts}
        productsByAccount={productsByAccount}
        authUserId={authUser?.id ?? null}
        queryClient={queryClient}
      />
    </>
  );
}

// ========================== Dialog 1 ==========================
function ReassignBatchesDialog({
  open, onClose, genericRgKey, nonGenericRgs, queryClient,
}: {
  open: boolean;
  onClose: () => void;
  genericRgKey: string | null;
  nonGenericRgs: Array<{ roast_group: string; display_name: string }>;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetRg, setTargetRg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['generic-planned-batches', genericRgKey],
    enabled: open && !!genericRgKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, target_date, planned_output_kg, assigned_roaster, cropster_batch_id')
        .eq('roast_group', genericRgKey!)
        .eq('status', 'PLANNED');
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleConfirm = async () => {
    if (!targetRg || selected.size === 0) return;
    setSubmitting(true);
    try {
      const ids = [...selected];
      const { error } = await supabase
        .from('roasted_batches')
        .update({ roast_group: targetRg } as any)
        .in('id', ids);
      if (error) throw error;
      toast.success(`${ids.length} batch${ids.length !== 1 ? 'es' : ''} reassigned`);
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['generic-planned-batches'] });
      resetAndClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setSelected(new Set());
    setTargetRg('');
    onClose();
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reassign Batches</DialogTitle>
          <DialogDescription>Select planned batches on the generic lane and move them to a real roast group.</DialogDescription>
        </DialogHeader>
        {!genericRgKey ? (
          <p className="text-sm text-muted-foreground">No generic roast group found.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No planned batches on the generic lane.</p>
        ) : (
          <>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
              {batches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={selected.has(b.id)} onCheckedChange={() => toggle(b.id)} />
                  <span>{b.target_date}</span>
                  <span className="text-muted-foreground">{b.planned_output_kg} kg</span>
                  {b.assigned_roaster && <Badge variant="outline">{b.assigned_roaster}</Badge>}
                  {b.cropster_batch_id && <span className="text-xs text-muted-foreground">{b.cropster_batch_id}</span>}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label>Target roast group</Label>
              <Select value={targetRg} onValueChange={setTargetRg}>
                <SelectTrigger><SelectValue placeholder="Select roast group" /></SelectTrigger>
                <SelectContent>
                  {nonGenericRgs.map((rg) => (
                    <SelectItem key={rg.roast_group} value={rg.roast_group}>
                      {rg.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={submitting || selected.size === 0 || !targetRg}>
            {submitting ? 'Reassigning…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========================== Dialog 2 ==========================
function MoveWipDialog({
  open, onClose, genericRgKey, nonGenericRgs, activeRoastGroups, authUserId, queryClient,
}: {
  open: boolean;
  onClose: () => void;
  genericRgKey: string | null;
  nonGenericRgs: Array<{ roast_group: string; display_name: string }>;
  activeRoastGroups: Array<{ roast_group: string; display_name: string }>;
  authUserId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [amount, setAmount] = useState('');
  const [targetRg, setTargetRg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: netWip = 0, isLoading } = useQuery({
    queryKey: ['generic-wip-net', genericRgKey],
    enabled: open && !!genericRgKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('quantity_kg')
        .eq('roast_group', genericRgKey!)
        .not('quantity_kg', 'is', null);
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + Number(r.quantity_kg), 0);
    },
  });

  const targetDisplayName = activeRoastGroups.find((rg) => rg.roast_group === targetRg)?.display_name ?? targetRg;
  const numAmount = parseFloat(amount) || 0;
  const today = format(new Date(), 'yyyy-MM-dd');

  const handleConfirm = async () => {
    if (numAmount <= 0 || !targetRg || !genericRgKey) return;
    setSubmitting(true);
    try {
      // inventory_transactions
      const { error: e1 } = await supabase.from('inventory_transactions').insert([
        { roast_group: genericRgKey, transaction_type: 'ADJUSTMENT' as const, quantity_kg: -numAmount, notes: `Reallocated to ${targetDisplayName}`, created_by: authUserId, is_system_generated: false },
        { roast_group: targetRg, transaction_type: 'ADJUSTMENT' as const, quantity_kg: numAmount, notes: 'Reallocated from Generic', created_by: authUserId, is_system_generated: false },
      ]);
      if (e1) throw e1;

      // wip_ledger
      const { error: e2 } = await supabase.from('wip_ledger').insert([
        { roast_group: genericRgKey, entry_type: 'REALLOCATE_OUT' as const, delta_kg: -numAmount, target_date: today, created_by: authUserId, notes: `Reallocated to ${targetDisplayName}` },
        { roast_group: targetRg, entry_type: 'REALLOCATE_IN' as const, delta_kg: numAmount, target_date: today, created_by: authUserId, notes: 'Reallocated from Generic' },
      ]);
      if (e2) throw e2;

      toast.success(`${numAmount} kg moved to ${targetDisplayName}`);
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions-wip'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
      queryClient.invalidateQueries({ queryKey: ['generic-wip-net'] });
      resetAndClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => { setAmount(''); setTargetRg(''); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move WIP</DialogTitle>
          <DialogDescription>Transfer WIP kg from the generic lane to a real roast group.</DialogDescription>
        </DialogHeader>
        {!genericRgKey ? (
          <p className="text-sm text-muted-foreground">No generic roast group found.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">Generic lane net WIP: <span className="font-semibold">{netWip.toFixed(1)} kg</span></p>
            <div className="space-y-2">
              <Label>Amount (kg)</Label>
              <Input
                type="number"
                min={0}
                max={netWip}
                step="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
              />
            </div>
            <div className="space-y-2">
              <Label>Target roast group</Label>
              <Select value={targetRg} onValueChange={setTargetRg}>
                <SelectTrigger><SelectValue placeholder="Select roast group" /></SelectTrigger>
                <SelectContent>
                  {nonGenericRgs.map((rg) => (
                    <SelectItem key={rg.roast_group} value={rg.roast_group}>{rg.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={submitting || numAmount <= 0 || numAmount > netWip || !targetRg}>
            {submitting ? 'Moving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========================== Dialog 3 ==========================
function SwapOrderProductsDialog({
  open, onClose, genericRgKey, productsByAccount, queryClient,
}: {
  open: boolean;
  onClose: () => void;
  genericRgKey: string | null;
  productsByAccount: Array<[string, Array<{ id: string; product_name: string }>]>;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replacementId, setReplacementId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: lineItems = [], isLoading } = useQuery({
    queryKey: ['generic-order-lines', genericRgKey],
    enabled: open && !!genericRgKey,
    queryFn: async () => {
      // Get generic products
      const { data: genProducts } = await supabase
        .from('products')
        .select('id')
        .eq('roast_group', genericRgKey!);
      const genIds = (genProducts ?? []).map((p) => p.id);
      if (genIds.length === 0) return [];

      const { data, error } = await supabase
        .from('order_line_items')
        .select('id, quantity_units, product_id, products(product_name), orders!inner(id, order_number, status)')
        .in('product_id', genIds)
        .not('orders.status', 'in', '("SHIPPED","CANCELLED")');
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        quantity_units: number;
        product_id: string;
        products: { product_name: string } | null;
        orders: { id: string; order_number: string; status: string } | null;
      }>;
    },
  });

  const handleConfirm = async () => {
    if (!replacementId || selected.size === 0) return;
    setSubmitting(true);
    try {
      const ids = [...selected];
      const { error } = await supabase
        .from('order_line_items')
        .update({ product_id: replacementId } as any)
        .in('id', ids);
      if (error) throw error;
      toast.success(`${ids.length} line item${ids.length !== 1 ? 's' : ''} updated`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      queryClient.invalidateQueries({ queryKey: ['generic-order-lines'] });
      resetAndClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => { setSelected(new Set()); setReplacementId(''); onClose(); };
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Swap Order Products</DialogTitle>
          <DialogDescription>Replace generic products on open orders with real products.</DialogDescription>
        </DialogHeader>
        {!genericRgKey ? (
          <p className="text-sm text-muted-foreground">No generic roast group found.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : lineItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open order line items using generic products.</p>
        ) : (
          <>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
              {lineItems.map((li) => (
                <label key={li.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={selected.has(li.id)} onCheckedChange={() => toggle(li.id)} />
                  <span className="font-medium">{li.orders?.order_number}</span>
                  <span className="text-muted-foreground">{li.products?.product_name}</span>
                  <span>×{li.quantity_units}</span>
                  <Badge variant="outline" className="text-xs">{li.orders?.status}</Badge>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label>Replacement product</Label>
              <Select value={replacementId} onValueChange={setReplacementId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {productsByAccount.map(([acctName, products]) => (
                    <React.Fragment key={acctName}>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{acctName}</div>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.product_name}</SelectItem>
                      ))}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={submitting || selected.size === 0 || !replacementId}>
            {submitting ? 'Swapping…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========================== Dialog 4 ==========================
function ReassignFgDialog({
  open, onClose, genericRgKey, nonGenericProducts, productsByAccount, authUserId, queryClient,
}: {
  open: boolean;
  onClose: () => void;
  genericRgKey: string | null;
  nonGenericProducts: Array<{ id: string; product_name: string }>;
  productsByAccount: Array<[string, Array<{ id: string; product_name: string }>]>;
  authUserId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [sourceProductId, setSourceProductId] = useState('');
  const [targetProductId, setTargetProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: fgItems = [], isLoading } = useQuery({
    queryKey: ['generic-fg-inventory', genericRgKey],
    enabled: open && !!genericRgKey,
    queryFn: async () => {
      // Get generic products
      const { data: genProducts } = await supabase
        .from('products')
        .select('id, product_name')
        .eq('roast_group', genericRgKey!);
      const genIds = (genProducts ?? []).map((p) => p.id);
      if (genIds.length === 0) return [];

      const { data, error } = await supabase
        .from('fg_inventory')
        .select('product_id, units_on_hand')
        .in('product_id', genIds)
        .gt('units_on_hand', 0);
      if (error) throw error;

      return (data ?? []).map((row) => ({
        ...row,
        product_name: genProducts?.find((p) => p.id === row.product_id)?.product_name ?? 'Unknown',
      }));
    },
  });

  const selectedSource = fgItems.find((f) => f.product_id === sourceProductId);
  const maxUnits = selectedSource?.units_on_hand ?? 0;
  const numAmount = parseInt(amount, 10) || 0;

  const handleConfirm = async () => {
    if (!sourceProductId || !targetProductId || numAmount <= 0) return;
    setSubmitting(true);
    try {
      // Decrement source
      const { data: srcRow, error: e1 } = await supabase
        .from('fg_inventory')
        .select('units_on_hand')
        .eq('product_id', sourceProductId)
        .single();
      if (e1) throw e1;
      const newSourceUnits = (srcRow?.units_on_hand ?? 0) - numAmount;
      const { error: e2 } = await supabase
        .from('fg_inventory')
        .update({ units_on_hand: newSourceUnits } as any)
        .eq('product_id', sourceProductId);
      if (e2) throw e2;

      // Upsert target
      const { data: tgtRow } = await supabase
        .from('fg_inventory')
        .select('units_on_hand')
        .eq('product_id', targetProductId)
        .maybeSingle();
      const oldTargetUnits = tgtRow?.units_on_hand ?? 0;
      const newTargetUnits = oldTargetUnits + numAmount;
      if (tgtRow) {
        const { error: e3 } = await supabase
          .from('fg_inventory')
          .update({ units_on_hand: newTargetUnits } as any)
          .eq('product_id', targetProductId);
        if (e3) throw e3;
      } else {
        const { error: e3 } = await supabase
          .from('fg_inventory')
          .insert({ product_id: targetProductId, units_on_hand: numAmount });
        if (e3) throw e3;
      }

      // Get target product name
      const targetName = nonGenericProducts.find((p) => p.id === targetProductId)?.product_name ?? 'target';
      const sourceName = selectedSource?.product_name ?? 'Generic';

      // Log entries
      const { error: e4 } = await supabase.from('fg_inventory_log').insert([
        { product_id: sourceProductId, units_delta: -numAmount, units_after: newSourceUnits, notes: `Reassigned to ${targetName}`, created_by: authUserId },
        { product_id: targetProductId, units_delta: numAmount, units_after: newTargetUnits, notes: `Reassigned from ${sourceName}`, created_by: authUserId },
      ]);
      if (e4) throw e4;

      toast.success(`${numAmount} units moved to ${targetName}`);
      queryClient.invalidateQueries({ queryKey: ['fg-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['generic-fg-inventory'] });
      resetAndClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => { setSourceProductId(''); setTargetProductId(''); setAmount(''); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign FG Inventory</DialogTitle>
          <DialogDescription>Move finished goods units from a generic product to a real product.</DialogDescription>
        </DialogHeader>
        {!genericRgKey ? (
          <p className="text-sm text-muted-foreground">No generic roast group found.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : fgItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No FG inventory on generic products.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source generic product</Label>
              <Select value={sourceProductId} onValueChange={(v) => { setSourceProductId(v); setAmount(''); }}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {fgItems.map((f) => (
                    <SelectItem key={f.product_id} value={f.product_id}>
                      {f.product_name} ({f.units_on_hand} units)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sourceProductId && (
              <>
                <div className="space-y-2">
                  <Label>Units to move (max {maxUnits})</Label>
                  <Input
                    type="number"
                    min={1}
                    max={maxUnits}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Target product</Label>
                  <Select value={targetProductId} onValueChange={setTargetProductId}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      {productsByAccount.map(([acctName, products]) => (
                        <React.Fragment key={acctName}>
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{acctName}</div>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.product_name}</SelectItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={submitting || numAmount <= 0 || numAmount > maxUnits || !targetProductId}>
            {submitting ? 'Moving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
