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

type WipAdjustmentReason = 'LOSS' | 'COUNT_ADJUSTMENT' | 'CONTAMINATION' | 'OTHER';

interface WipByRoastGroup {
  roast_group: string;
  roasted_kg: number;
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
  const { user } = useAuth();
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
  const isAdmin = user?.role === 'ADMIN';
  const activeRoastGroupKeys = useMemo(() => new Set(roastGroups ?? []), [roastGroups]);

  // ===== WIP Tab Queries =====
  
  // Fetch roast groups to identify blends
  const { data: roastGroupsInfo } = useQuery({
    queryKey: ['roast-groups-info-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, is_blend, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });
  
  // Fetch ALL inventory transactions for WIP calculation (ledger-based source of truth)
  const { data: inventoryTransactions } = useQuery({
    queryKey: ['inventory-transactions-wip'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg, notes, transaction_type')
        .not('roast_group', 'is', null)
        .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'ADJUSTMENT', 'LOSS']);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch WIP adjustments from wip_adjustments table (manual adjustments ONLY)
  const { data: wipAdjustments } = useQuery({
    queryKey: ['wip-adjustments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wip_adjustments')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
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

  // Calculate WIP by roast group for DISPLAY purposes
  // This shows the full picture: what was roasted, what was consumed, what was manually adjusted
  // 
  // All calculations are based on the inventory_transactions ledger (source of truth):
  // - "Roasted/Blended" = ROAST_OUTPUT + blend credits ("Created blend" ADJUSTMENT)
  // - "Consumed" = PACK_CONSUME_WIP + blend consumption ("Blended into" ADJUSTMENT)
  // - "Adjustments" = ONLY manual adjustments from wip_adjustments table
  const wipByRoastGroup = useMemo((): WipByRoastGroup[] => {
    const groupMap: Record<string, { 
      roasted: number;      // From ROAST_OUTPUT transactions
      blendCredit: number;  // Blend output credits (for parent blends, from ADJUSTMENT "Created blend")
      packConsumed: number; // From PACK_CONSUME_WIP transactions (negative values)
      blendConsumed: number;// Blend consumption (for components, from ADJUSTMENT "Blended into")
      manualAdj: number;    // Manual adjustments from wip_adjustments table
    }> = {};
    
    // Identify blend roast groups
    const blendGroups = new Set<string>();
    for (const rg of roastGroupsInfo ?? []) {
      if (rg.is_blend) {
        blendGroups.add(rg.roast_group);
      }
    }

    // Process all inventory transactions from the ledger
    for (const tx of inventoryTransactions ?? []) {
      if (!tx.roast_group) continue;
      
      if (!groupMap[tx.roast_group]) {
        groupMap[tx.roast_group] = { roasted: 0, blendCredit: 0, packConsumed: 0, blendConsumed: 0, manualAdj: 0 };
      }
      
      const kg = Number(tx.quantity_kg) || 0;
      const notes = tx.notes || '';
      
      switch (tx.transaction_type) {
        case 'ROAST_OUTPUT':
          // Direct roast output
          groupMap[tx.roast_group].roasted += kg;
          break;
          
        case 'PACK_CONSUME_WIP':
          // Packing consumption: negative kg = consumed, positive kg = reversal
          if (kg < 0) {
            groupMap[tx.roast_group].packConsumed += Math.abs(kg);
          } else {
            // Reversal - subtract from consumed
            groupMap[tx.roast_group].packConsumed -= kg;
          }
          break;
          
        case 'ADJUSTMENT':
          // Categorize adjustment by notes content
          if (notes.includes('Blended into') && kg < 0) {
            // Component consumed by blend
            groupMap[tx.roast_group].blendConsumed += Math.abs(kg);
          } else if (notes.includes('Created blend') && kg > 0) {
            // Parent blend output credit
            groupMap[tx.roast_group].blendCredit += kg;
          } else if (notes.includes('Reverted batch') && kg < 0) {
            // Roast reversal - subtract from roasted output
            groupMap[tx.roast_group].roasted += kg; // kg is negative
          } else if (notes.includes('Reversed') && kg > 0) {
            // Pack reversal - subtract from consumed
            groupMap[tx.roast_group].packConsumed -= kg;
          } else {
            // Other adjustments - treat as manual (shouldn't happen often)
            // Skip here - manual adjustments come from wip_adjustments table
          }
          break;
          
        case 'LOSS':
          // Loss transactions count as consumption
          groupMap[tx.roast_group].packConsumed += Math.abs(kg);
          break;
      }
    }

    // Add manual WIP adjustments (from wip_adjustments table ONLY)
    for (const adj of wipAdjustments ?? []) {
      if (!groupMap[adj.roast_group]) {
        groupMap[adj.roast_group] = { roasted: 0, blendCredit: 0, packConsumed: 0, blendConsumed: 0, manualAdj: 0 };
      }
      groupMap[adj.roast_group].manualAdj += Number(adj.kg_delta) || 0;
    }

    return Object.entries(groupMap)
      .map(([roast_group, data]) => {
        const isBlend = blendGroups.has(roast_group);
        
        // Roasted/Blended column:
        // - For blends: show blend credit (from "Created blend" ADJUSTMENT)
        // - For single origins: show direct roast output from ROAST_OUTPUT transactions
        const roastedDisplay = isBlend ? data.blendCredit : data.roasted;
        
        // Consumed column:
        // - Packing consumption + blend consumption (for components)
        const consumedDisplay = data.packConsumed + data.blendConsumed;
        
        // Net WIP = Roasted - Consumed + Manual Adjustments
        const netWip = roastedDisplay - consumedDisplay + data.manualAdj;
        
        return {
          roast_group,
          roasted_kg: roastedDisplay,
          consumed_kg: consumedDisplay,
          adjusted_kg: data.manualAdj,
          net_wip_kg: netWip,
        };
      })
      .filter(row => row.roasted_kg !== 0 || row.consumed_kg !== 0 || row.adjusted_kg !== 0)
      .sort((a, b) => a.roast_group.localeCompare(b.roast_group));
  }, [inventoryTransactions, wipAdjustments, roastGroupsInfo]);

  // WIP adjustment mutation
  const createWipAdjustment = useMutation({
    mutationFn: async () => {
      const delta = parseFloat(adjustKgDelta);
      if (isNaN(delta) || delta === 0) throw new Error('Invalid kg delta');
      
      const { error } = await supabase
        .from('wip_adjustments')
        .insert({
          roast_group: adjustRoastGroup,
          kg_delta: delta,
          reason: adjustReason,
          notes: adjustNotes,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('WIP adjustment recorded');
      queryClient.invalidateQueries({ queryKey: ['wip-adjustments'] });
      setShowWipAdjust(false);
      setAdjustKgDelta('');
      setAdjustNotes('');
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to record adjustment');
    },
  });

  // WIP history delete mutation (orphaned roast groups only)
  const deleteWipHistory = useMutation({
    mutationFn: async (roastGroupKey: string) => {
      const { error: e1 } = await supabase
        .from('inventory_transactions')
        .delete()
        .eq('roast_group', roastGroupKey);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from('wip_adjustments')
        .delete()
        .eq('roast_group', roastGroupKey);
      if (e2) throw e2;

      const { error: e3 } = await supabase
        .from('wip_ledger')
        .delete()
        .eq('roast_group', roastGroupKey);
      if (e3) throw e3;
    },
    onSuccess: () => {
      toast.success('WIP history cleared');
      setConfirmDeleteGroup(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions-wip'] });
      queryClient.invalidateQueries({ queryKey: ['wip-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
    },
    onError: (err: any) => {
      console.error(err);
      toast.error(err.message || 'Failed to clear WIP history');
    },
  });

  // ===== Finished Goods Tab =====
  
  // Fetch FG inventory with product details
  const { data: fgInventory } = useQuery({
    queryKey: ['fg-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fg_inventory')
        .select(`
          id,
          product_id,
          units_on_hand,
          notes,
          updated_at,
          product:products(
            id,
            product_name,
            bag_size_g,
            packaging_variant,
            client:clients(name)
          )
        `)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FgInventoryRow[];
    },
  });

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

  // Upsert FG inventory mutation
  const upsertFgInventory = useMutation({
    mutationFn: async ({ productId, unitsDelta, newUnits }: { 
      productId: string; 
      unitsDelta: number;
      newUnits: number;
    }) => {
      // Upsert fg_inventory
      const { error: upsertError } = await supabase
        .from('fg_inventory')
        .upsert({
          product_id: productId,
          units_on_hand: newUnits,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        }, {
          onConflict: 'product_id',
        });
      if (upsertError) throw upsertError;

      // Log the change
      const { error: logError } = await supabase
        .from('fg_inventory_log')
        .insert({
          product_id: productId,
          units_delta: unitsDelta,
          units_after: newUnits,
          created_by: user?.id,
        });
      if (logError) throw logError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fg-inventory'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory');
    },
  });

  const handleFgAdjust = (productId: string, currentUnits: number, delta: number) => {
    const newUnits = Math.max(0, currentUnits + delta);
    upsertFgInventory.mutate({ productId, unitsDelta: delta, newUnits });
  };

  const handleFgSet = (productId: string, currentUnits: number, newValue: string) => {
    const newUnits = parseInt(newValue, 10);
    if (isNaN(newUnits) || newUnits < 0) return;
    const delta = newUnits - currentUnits;
    upsertFgInventory.mutate({ productId, unitsDelta: delta, newUnits });
  };

  const openAdjustDialog = (roastGroup: string) => {
    setAdjustRoastGroup(roastGroup);
    setAdjustKgDelta('');
    setAdjustReason('COUNT_ADJUSTMENT');
    setAdjustNotes('');
    setShowWipAdjust(true);
  };

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
              <CardTitle className="text-lg">Work-in-Progress by Roast Group</CardTitle>
              <p className="text-sm text-muted-foreground">
                Net WIP = Roasted/Blended Output − Packing Consumed + Adjustments
              </p>
              <p className="text-xs text-muted-foreground">
                For post-roast blends, WIP is created when components are blended, not when components are roasted.
              </p>
            </CardHeader>
            <CardContent>
              {wipByRoastGroup.length === 0 ? (
                <p className="text-muted-foreground py-4">No WIP data available.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2">Roast Group</th>
                      <th className="pb-2 text-right">Roasted/Blended</th>
                      <th className="pb-2 text-right">Consumed</th>
                      <th className="pb-2 text-right">Adjustments</th>
                      <th className="pb-2 text-right">Net WIP</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wipByRoastGroup.map((row) => (
                      <tr key={row.roast_group} className="border-b">
                        <td className="py-3 font-medium">{row.roast_group}</td>
                        <td className="py-3 text-right">{row.roasted_kg.toFixed(1)} kg</td>
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
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openAdjustDialog(row.roast_group)}
                            >
                              Adjust
                            </Button>
                            {isAdmin && !(roastGroups ?? []).includes(row.roast_group) && (
                              confirmDeleteGroup === row.roast_group ? (
                                <div className="flex items-center gap-1 ml-2">
                                  <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={`Clear WIP history for ${row.roast_group}? This will permanently delete all inventory transaction records for this roast group. This cannot be undone.`}>
                                    Clear history?
                                  </span>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteGroup(null)}>
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 text-xs"
                                    disabled={deleteWipHistory.isPending}
                                    onClick={() => deleteWipHistory.mutate(row.roast_group)}
                                  >
                                    Confirm
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setConfirmDeleteGroup(row.roast_group)}
                                  title={`Clear WIP history for ${row.roast_group}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )
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
              <CardTitle className="text-lg">Finished Goods Inventory</CardTitle>
              <p className="text-sm text-muted-foreground">
                Packed units on hand by product
              </p>
            </CardHeader>
            <CardContent>
              {fgInventory?.length === 0 && allProducts?.length === 0 ? (
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
                    {/* Show products that have FG inventory */}
                    {fgInventory?.map((row) => (
                      <FgInventoryRow
                        key={row.id}
                        row={row}
                        onAdjust={(delta) => handleFgAdjust(row.product_id, row.units_on_hand, delta)}
                        onSet={(value) => handleFgSet(row.product_id, row.units_on_hand, value)}
                      />
                    ))}
                    {/* Show products without FG inventory (units = 0) */}
                    {allProducts
                      ?.filter(p => !fgInventory?.some(fg => fg.product_id === p.id))
                      .map((product) => (
                        <tr key={product.id} className="border-b text-muted-foreground">
                          <td className="py-3">{product.product_name}</td>
                          <td className="py-3">{(product.client as any)?.name ?? '—'}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs">{product.bag_size_g}g</span>
                              {product.packaging_variant && (
                                <PackagingBadge variant={product.packaging_variant as any} />
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-right">0</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0"
                                onClick={() => handleFgAdjust(product.id, 0, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                className="w-16 h-7 text-center text-sm"
                                value={0}
                                onChange={(e) => handleFgSet(product.id, 0, e.target.value)}
                                min={0}
                              />
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
    </div>
  );
}

// Sub-component for FG inventory row with inline controls
function FgInventoryRow({ 
  row, 
  onAdjust, 
  onSet 
}: { 
  row: FgInventoryRow; 
  onAdjust: (delta: number) => void;
  onSet: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(row.units_on_hand.toString());
  
  // Sync local value when row changes
  React.useEffect(() => {
    setLocalValue(row.units_on_hand.toString());
  }, [row.units_on_hand]);

  const handleBlur = () => {
    if (localValue !== row.units_on_hand.toString()) {
      onSet(localValue);
    }
  };

  return (
    <tr className="border-b">
      <td className="py-3 font-medium">{row.product.product_name}</td>
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
            disabled={row.units_on_hand <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            className="w-16 h-7 text-center text-sm"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            min={0}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => onAdjust(1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}