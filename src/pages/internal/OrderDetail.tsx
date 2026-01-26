import React, { useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ArrowLeft, UserPlus, Truck, Check, AlertTriangle, ExternalLink, Flame, Package, Edit, PenSquare } from 'lucide-react';
import { toast } from 'sonner';
import { HistoricalEditWarningModal } from '@/components/internal/HistoricalEditWarningModal';
import { IncompleteFulfillmentModal } from '@/components/internal/IncompleteFulfillmentModal';
import { StatusChangeModal } from '@/components/internal/StatusChangeModal';
import { OrderEditModal } from '@/components/internal/OrderEditModal';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];

interface PackingRun {
  product_id: string;
  target_date: string;
  units_packed: number;
  kg_consumed: number;
}

interface RoastedBatch {
  roast_group: string;
  target_date: string;
  actual_output_kg: number;
  status: string;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          requested_ship_date,
          delivery_method,
          client_po,
          client_notes,
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          client_id,
          updated_at,
          client:clients(name)
        `)
        .eq('id', id!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);

  // Fetch line items with product details including roast_group
  const { data: lineItems } = useQuery({
    queryKey: ['order-line-items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          grind,
          unit_price_locked,
          line_notes,
          product:products(id, product_name, roast_group, bag_size_g)
        `)
        .eq('order_id', id!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  // Fetch packing runs for the order's requested_ship_date
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs-for-order', order?.requested_ship_date],
    queryFn: async () => {
      if (!order?.requested_ship_date) return [];
      const { data, error } = await supabase
        .from('packing_runs')
        .select('product_id, target_date, units_packed, kg_consumed')
        .eq('target_date', order.requested_ship_date);
      if (error) throw error;
      return (data ?? []) as PackingRun[];
    },
    enabled: !!order?.requested_ship_date,
  });

  // Fetch roasted batches for the order's requested_ship_date
  const { data: roastedBatches } = useQuery({
    queryKey: ['roasted-batches-for-order', order?.requested_ship_date],
    queryFn: async () => {
      if (!order?.requested_ship_date) return [];
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('roast_group, target_date, actual_output_kg, status')
        .eq('target_date', order.requested_ship_date)
        .eq('status', 'ROASTED');
      if (error) throw error;
      return (data ?? []) as RoastedBatch[];
    },
    enabled: !!order?.requested_ship_date,
  });

  // Map packing runs by product_id
  const packingByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = (map[pr.product_id] ?? 0) + pr.units_packed;
    }
    return map;
  }, [packingRuns]);

  // Compute per-line item packed status
  const lineItemsWithPackedStatus = useMemo(() => {
    return (lineItems ?? []).map((li) => {
      const packedUnits = packingByProduct[li.product_id] ?? 0;
      const isPackedComplete = packedUnits >= li.quantity_units;
      return {
        ...li,
        packedUnits,
        isPackedComplete,
      };
    });
  }, [lineItems, packingByProduct]);

  // Derived pack complete for order: all line items have packed >= demanded
  const isDerivedPackComplete = useMemo(() => {
    if (lineItemsWithPackedStatus.length === 0) return false;
    return lineItemsWithPackedStatus.every((li) => li.isPackedComplete);
  }, [lineItemsWithPackedStatus]);

  // Compute roasted inventory on hand by roast_group
  const roastedInventoryByGroup = useMemo(() => {
    // Sum roasted output by group
    const roastedOutput: Record<string, number> = {};
    for (const b of roastedBatches ?? []) {
      roastedOutput[b.roast_group] = (roastedOutput[b.roast_group] ?? 0) + b.actual_output_kg;
    }

    // Sum kg consumed by roast_group
    const consumed: Record<string, number> = {};
    for (const li of lineItems ?? []) {
      const roastGroup = li.product?.roast_group;
      if (!roastGroup) continue;
      
      const pr = packingRuns?.find((p) => p.product_id === li.product_id);
      if (pr) {
        consumed[roastGroup] = (consumed[roastGroup] ?? 0) + pr.kg_consumed;
      }
    }

    // Net inventory
    const inventory: Record<string, number> = {};
    const allGroups = new Set([...Object.keys(roastedOutput), ...Object.keys(consumed)]);
    for (const group of allGroups) {
      inventory[group] = (roastedOutput[group] ?? 0) - (consumed[group] ?? 0);
    }
    return inventory;
  }, [roastedBatches, lineItems, packingRuns]);

  // Get unique roast groups from this order's line items
  const orderRoastGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const li of lineItems ?? []) {
      if (li.product?.roast_group) {
        groups.add(li.product.roast_group);
      }
    }
    return Array.from(groups);
  }, [lineItems]);

  const [opsNotes, setOpsNotes] = useState('');
  const [opsNotesLoaded, setOpsNotesLoaded] = useState(false);
  
  // Historical edit warning modal state
  const [showHistoricalWarning, setShowHistoricalWarning] = useState(false);
  const [pendingChecklistUpdate, setPendingChecklistUpdate] = useState<{
    roasted?: boolean;
    packed?: boolean;
    shipped_or_ready?: boolean;
    invoiced?: boolean;
  } | null>(null);

  // Incomplete fulfillment modal state
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [incompleteSteps, setIncompleteSteps] = useState<string[]>([]);

  // Status change modal state (for undoing shipped status)
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<OrderStatus | null>(null);

  // Check if order is in a "historical" state that requires confirmation
  const isHistoricalStatus = order?.status === 'SHIPPED' || order?.status === 'CANCELLED';

  // Initialize ops notes when order loads
  React.useEffect(() => {
    if (order && !opsNotesLoaded) {
      setOpsNotes(order.internal_ops_notes ?? '');
      setOpsNotesLoaded(true);
    }
  }, [order, opsNotesLoaded]);

  // Handler for checklist changes - shows warning for historical orders
  const handleChecklistChange = useCallback((updates: {
    roasted?: boolean;
    packed?: boolean;
    shipped_or_ready?: boolean;
    invoiced?: boolean;
  }) => {
    if (isHistoricalStatus) {
      setPendingChecklistUpdate(updates);
      setShowHistoricalWarning(true);
    } else {
      updateChecklistMutation.mutate(updates);
    }
  }, [isHistoricalStatus]);

  // Confirm the historical edit
  const confirmHistoricalEdit = useCallback(() => {
    if (pendingChecklistUpdate) {
      updateChecklistMutation.mutate(pendingChecklistUpdate);
      setPendingChecklistUpdate(null);
    }
    setShowHistoricalWarning(false);
  }, [pendingChecklistUpdate]);

  // Handler to initiate "Mark as Shipped" with safety check
  // Uses derived pack complete status instead of manual order.packed
  const handleMarkAsShipped = useCallback(() => {
    if (!order) return;
    
    const missing: string[] = [];
    // Use derived pack status from packing_runs
    if (!isDerivedPackComplete) missing.push('Packed (per run sheet)');
    if (!order.invoiced) missing.push('Invoiced');
    
    if (missing.length > 0) {
      setIncompleteSteps(missing);
      setShowIncompleteModal(true);
    } else {
      markAsShippedMutation.mutate();
    }
  }, [order, isDerivedPackComplete]);

  // Handler to request status change (for undo)
  const handleStatusChange = useCallback((newStatus: OrderStatus) => {
    if (isHistoricalStatus) {
      setPendingStatusChange(newStatus);
      setShowStatusChangeModal(true);
    } else {
      changeStatusMutation.mutate(newStatus);
    }
  }, [isHistoricalStatus]);

  // Confirm the status change
  const confirmStatusChange = useCallback(() => {
    if (pendingStatusChange) {
      changeStatusMutation.mutate(pendingStatusChange);
      setPendingStatusChange(null);
    }
    setShowStatusChangeModal(false);
  }, [pendingStatusChange]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'CONFIRMED' })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order confirmed');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to confirm order');
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ internal_ops_notes: notes })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Notes saved');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save notes');
    },
  });

  const updateChecklistMutation = useMutation({
    mutationFn: async (updates: { 
      roasted?: boolean; 
      packed?: boolean; 
      shipped_or_ready?: boolean; 
      invoiced?: boolean; 
    }) => {
      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update checklist');
    },
  });

  // Mark order as shipped (sets status and shipped_or_ready flag)
  const markAsShippedMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'SHIPPED', shipped_or_ready: true })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as shipped');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark as shipped');
    },
  });

  // Change order status (for undo/status changes)
  // When reverting from SHIPPED, also clear shipped_or_ready to keep checklist consistent
  const changeStatusMutation = useMutation({
    mutationFn: async (newStatus: OrderStatus) => {
      const updates: { status: OrderStatus; shipped_or_ready?: boolean } = { status: newStatus };
      
      // If reverting from SHIPPED, also clear the shipped_or_ready checkbox
      if (order?.status === 'SHIPPED' && newStatus !== 'SHIPPED') {
        updates.shipped_or_ready = false;
      }
      
      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order status updated');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update status');
    },
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <p className="text-destructive">Failed to load order: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Order not found.</p>
        <Link to="/orders">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Button>
        </Link>
      </div>
    );
  }

  const lineTotal = lineItemsWithPackedStatus.reduce((sum, li) => sum + li.quantity_units * li.unit_price_locked, 0);

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/orders">
            <Button variant="ghost" size="icon" title="Back to Orders">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Link to="/production?tab=ship">
            <Button variant="outline" size="sm" className="gap-1">
              <Truck className="h-4 w-4" />
              Back to Production
            </Button>
          </Link>
          <h1 className="page-title">{order.order_number}</h1>
          <span className={`rounded px-2 py-1 text-xs font-medium ${
            order.status === 'SUBMITTED' ? 'bg-warning/15 text-warning' : 
            order.status === 'CONFIRMED' ? 'bg-primary/15 text-primary' : 
            order.status === 'SHIPPED' ? 'bg-muted text-muted-foreground' :
            order.status === 'CANCELLED' ? 'bg-destructive/15 text-destructive' :
            'bg-muted text-muted-foreground'
          }`}>
            {order.status}
          </span>
          {order.created_by_admin && (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <UserPlus className="h-3 w-3" />
              Admin Created
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Edit Order button */}
          <Button variant="outline" onClick={() => setShowEditModal(true)} className="gap-2">
            <PenSquare className="h-4 w-4" />
            Edit Order
          </Button>
          
          {/* Confirm button for SUBMITTED orders */}
          {order.status === 'SUBMITTED' && (
            <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? 'Confirming…' : 'Confirm Order'}
            </Button>
          )}
          
          {/* Mark as Shipped button for non-shipped, non-cancelled orders */}
          {order.status !== 'SHIPPED' && order.status !== 'CANCELLED' && order.status !== 'DRAFT' && (
            <Button 
              onClick={handleMarkAsShipped} 
              disabled={markAsShippedMutation.isPending}
              className="gap-2"
            >
              <Truck className="h-4 w-4" />
              {markAsShippedMutation.isPending ? 'Processing…' : 'Mark as Shipped'}
            </Button>
          )}
          
          {/* Status change dropdown for SHIPPED orders (undo) */}
          {order.status === 'SHIPPED' && (
            <Select onValueChange={(value) => handleStatusChange(value as OrderStatus)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Change Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CONFIRMED">Revert to Confirmed</SelectItem>
                <SelectItem value="READY">Revert to Ready</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Order Info</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Client:</strong> {order.client?.name ?? 'Unknown'}</div>
            <div><strong>Status:</strong> {order.status}</div>
            <div><strong>Delivery:</strong> {order.delivery_method}</div>
            <div><strong>Client PO:</strong> {order.client_po || '—'}</div>
            <div>
              <strong>Requested Ship Date:</strong>{' '}
              {order.requested_ship_date
                ? format(new Date(order.requested_ship_date), 'MMM d, yyyy')
                : '—'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Fulfillment Status
              {isHistoricalStatus && (
                <span className="text-xs font-normal text-muted-foreground">(edits require confirmation)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Roast Availability - Derived from roasted_batches */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Roasted Inventory (kg)</Label>
                <span className="text-xs text-muted-foreground">(read-only)</span>
              </div>
              {orderRoastGroups.length > 0 ? (
                <div className="flex flex-wrap gap-2 ml-6">
                  {orderRoastGroups.map((group) => (
                    <Badge key={group} variant="outline" className="text-xs">
                      {group}: {(roastedInventoryByGroup[group] ?? 0).toFixed(2)} kg
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground ml-6">No roast groups assigned</p>
              )}
            </div>

            {/* Pack Status - Derived from packing_runs */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Pack Status</Label>
                {isDerivedPackComplete ? (
                  <Badge className="bg-green-600 text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    Complete
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Incomplete
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                Pack completion is derived from Pack tab (packing_runs). This is read-only.
              </p>
            </div>

            {/* Shipped / Ready - Manual checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="shipped_or_ready" 
                checked={order.shipped_or_ready}
                onCheckedChange={(checked) => handleChecklistChange({ shipped_or_ready: !!checked })}
              />
              <Label htmlFor="shipped_or_ready" className="cursor-pointer">Shipped / Ready for Pickup</Label>
            </div>

            {/* Invoiced - Manual checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="invoiced" 
                checked={order.invoiced}
                onCheckedChange={(checked) => handleChecklistChange({ invoiced: !!checked })}
              />
              <Label htmlFor="invoiced" className="cursor-pointer">Invoiced</Label>
            </div>

            {/* Link to Production */}
            {order.requested_ship_date && (
              <div className="pt-2 border-t">
                <Link 
                  to={`/production`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in Production Run Sheet
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        <Card>
          <CardHeader><CardTitle>Client Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{order.client_notes || '—'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Internal Ops Notes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              id="opsNotes"
              value={opsNotes}
              onChange={(e) => setOpsNotes(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveNotesMutation.mutate(opsNotes)}
              disabled={saveNotesMutation.isPending}
            >
              {saveNotesMutation.isPending ? 'Saving…' : 'Save Notes'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
        <CardContent>
          {lineItemsWithPackedStatus.length === 0 ? (
            <p className="text-muted-foreground">No line items.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Demanded</th>
                    <th className="pb-2">Packed</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Grind</th>
                    <th className="pb-2">Unit Price</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItemsWithPackedStatus.map((li) => (
                    <tr key={li.id} className="border-b last:border-0">
                      <td className="py-2">{li.product?.product_name ?? 'Unknown'}</td>
                      <td className="py-2">{li.quantity_units}</td>
                      <td className="py-2">{li.packedUnits}</td>
                      <td className="py-2">
                        {li.isPackedComplete ? (
                          <Badge className="bg-green-600 text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Ready
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {li.packedUnits}/{li.quantity_units}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2">{li.grind ?? '—'}</td>
                      <td className="py-2">${li.unit_price_locked.toFixed(2)}</td>
                      <td className="py-2 text-right">${(li.quantity_units * li.unit_price_locked).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} className="pt-4 text-right font-medium">Total:</td>
                    <td className="pt-4 text-right font-medium">${lineTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Historical edit warning modal */}
      <HistoricalEditWarningModal
        open={showHistoricalWarning}
        onOpenChange={(open) => {
          setShowHistoricalWarning(open);
          if (!open) setPendingChecklistUpdate(null);
        }}
        orderStatus={order.status}
        onConfirm={confirmHistoricalEdit}
      />

      {/* Incomplete fulfillment warning modal */}
      <IncompleteFulfillmentModal
        open={showIncompleteModal}
        onOpenChange={setShowIncompleteModal}
        incompleteSteps={incompleteSteps}
        onConfirm={() => {
          setShowIncompleteModal(false);
          markAsShippedMutation.mutate();
        }}
      />

      {/* Status change confirmation modal */}
      <StatusChangeModal
        open={showStatusChangeModal}
        onOpenChange={(open) => {
          setShowStatusChangeModal(open);
          if (!open) setPendingStatusChange(null);
        }}
        currentStatus={order.status}
        newStatus={pendingStatusChange ?? ''}
        onConfirm={confirmStatusChange}
      />

      {/* Order Edit Modal */}
      {order && lineItemsWithPackedStatus && (
        <OrderEditModal
          open={showEditModal}
          onOpenChange={setShowEditModal}
          order={{
            id: order.id,
            order_number: order.order_number,
            requested_ship_date: order.requested_ship_date,
            delivery_method: order.delivery_method,
            status: order.status,
            client_id: (order as any).client_id,
            created_by_admin: order.created_by_admin,
          }}
          lineItems={lineItemsWithPackedStatus.map(li => ({
            id: li.id,
            product_id: li.product_id,
            product_name: li.product?.product_name ?? 'Unknown',
            quantity_units: li.quantity_units,
            grind: li.grind,
            unit_price_locked: li.unit_price_locked,
          }))}
          clientId={(order as any).client_id}
        />
      )}
    </div>
  );
}
