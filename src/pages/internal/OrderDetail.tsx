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
import { parseDateOnly } from '@/lib/dateOnly';
import { ArrowLeft, Truck, Check, AlertTriangle, ExternalLink, Flame, Package, PenSquare, CalendarClock, FileText, Clock, Trash2, Printer } from 'lucide-react';
import { printPackingSlips } from '@/components/orders/printPackingSlips';
import { LocationBadge } from '@/components/orders/LocationSelect';
import { OrderShipmentsCard } from '@/components/orders/OrderShipmentsCard';
import { CreatedByBadge } from '@/components/orders/CreatedByBadge';
import { formatGramsLabel } from '@/components/GramPackagingBadge';
import { toast } from 'sonner';
import { HistoricalEditWarningModal } from '@/components/internal/HistoricalEditWarningModal';
import { IncompleteFulfillmentModal } from '@/components/internal/IncompleteFulfillmentModal';
import { StatusChangeModal } from '@/components/internal/StatusChangeModal';
import { OrderEditModal } from '@/components/internal/OrderEditModal';
import { OrderDateAuditHistory } from '@/components/internal/OrderDateAuditHistory';
import { WorkDeadlinePicker } from '@/components/orders/WorkDeadlinePicker';
import { OrderDeleteModal } from '@/components/internal/OrderDeleteModal';
import { ALLOWED_ORDER_TRANSITIONS } from '@/lib/orderTransitions';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];

// Linear fulfillment ladder for the status stepper (CANCELLED is off-ladder).
const PRODUCTION_LADDER: OrderStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'SHIPPED',
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CONFIRMED: 'Confirmed',
  IN_PRODUCTION: 'In Production',
  READY: 'Ready',
  SHIPPED: 'Shipped',
  CANCELLED: 'Cancelled',
};

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
          work_deadline,
          work_deadline_at,
          delivery_method,
          client_po,
          client_notes,
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          created_by_user_id,
          account_id,
          location_id,
          updated_at,
           client:clients(name),
           account:accounts(account_name)
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
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
          shipment_id,
          product:products(id, product_name, roast_group, bag_size_g, grams_per_unit, packaging_variant, packaging_type:packaging_types(name))
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
  
  // Work deadline editing state (using new timestamptz field)
  const [workDeadlineAt, setWorkDeadlineAt] = useState<string | null>(null);
  const [workDeadlineLoaded, setWorkDeadlineLoaded] = useState(false);
  
  // Historical edit warning modal state
  const [showHistoricalWarning, setShowHistoricalWarning] = useState(false);
  const [pendingChecklistUpdate, setPendingChecklistUpdate] = useState<{
    roasted?: boolean;
    packed?: boolean;
    shipped_or_ready?: boolean;
    invoiced?: boolean;
  } | null>(null);

  // Incomplete fulfillment modal state. `incompleteIntent` records which
  // advancement the soft-warning is gating so the modal's confirm can dispatch it.
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [incompleteSteps, setIncompleteSteps] = useState<string[]>([]);
  const [incompleteIntent, setIncompleteIntent] = useState<'SHIP' | 'READY'>('SHIP');

  // Status change modal state (for undoing shipped status)
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<OrderStatus | null>(null);

  // Check if order is in a "historical" state that requires confirmation
  const isHistoricalStatus = order?.status === 'SHIPPED' || order?.status === 'CANCELLED';

  // Initialize ops notes and work_deadline_at when order loads
  React.useEffect(() => {
    if (order && !opsNotesLoaded) {
      setOpsNotes(order.internal_ops_notes ?? '');
      setOpsNotesLoaded(true);
    }
    if (order && !workDeadlineLoaded) {
      setWorkDeadlineAt((order as any).work_deadline_at ?? null);
      setWorkDeadlineLoaded(true);
    }
  }, [order, opsNotesLoaded, workDeadlineLoaded]);

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
  // Uses derived pack complete status - no longer checks invoiced as a blocker
  const handleMarkAsShipped = useCallback(() => {
    if (!order) return;

    // Only check pack completion - invoiced is tracked separately
    if (!isDerivedPackComplete) {
      setIncompleteSteps(['Packed (per run sheet)']);
      setIncompleteIntent('SHIP');
      setShowIncompleteModal(true);
    } else {
      markAsShippedMutation.mutate();
    }
  }, [order, isDerivedPackComplete]);

  // Handler to mark as invoiced
  const handleMarkAsInvoiced = useCallback(() => {
    markAsInvoicedMutation.mutate();
  }, []);

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
      const { error } = await supabase.rpc('update_order_status' as any, {
        p_order_id: id!,
        p_target_status: 'CONFIRMED',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order confirmed');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      supabase.functions.invoke('notify-order-event', {
        body: { order_id: id, event_type: 'ORDER_CONFIRMED' },
      }).catch((e) => console.warn('[notify-order-event] CONFIRMED failed:', e));
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

  // Mutation to save work_deadline_at (timestamptz)
  const saveWorkDeadlineMutation = useMutation({
    mutationFn: async (deadlineAt: string | null) => {
      const { error } = await supabase
        .from('orders')
        .update({ work_deadline_at: deadlineAt })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Work deadline saved');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['order-date-audit', id] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save work deadline');
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

  // Mark order as shipped via RPC (status + shipped_or_ready set atomically by RPC)
  const markAsShippedMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_order_status' as any, {
        p_order_id: id!,
        p_target_status: 'SHIPPED',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as shipped');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      supabase.functions.invoke('notify-order-event', {
        body: { order_id: id, event_type: 'ORDER_SHIPPED' },
      }).catch((e) => console.warn('[notify-order-event] SHIPPED failed:', e));
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark as shipped');
    },
  });

  // Mark order as invoiced
  const markAsInvoicedMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('orders')
        .update({ invoiced: true })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as invoiced');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark as invoiced');
    },
  });

  // Change order status via RPC (validates transition, clears shipped_or_ready on revert).
  const changeStatusMutation = useMutation({
    mutationFn: async (newStatus: OrderStatus) => {
      const { error } = await supabase.rpc('update_order_status' as any, {
        p_order_id: id!,
        p_target_status: newStatus,
      });
      if (error) throw error;
      return newStatus;
    },
    onSuccess: (newStatus) => {
      toast.success('Order status updated');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Fan-out emails for landmark transitions. Admin-cancellation does NOT
      // hit the shared mailbox (only client-cancels do); the edge function
      // gates that. Here we still notify placer + owners.
      const map: Partial<Record<OrderStatus, string>> = {
        CONFIRMED: 'ORDER_CONFIRMED',
        SHIPPED: 'ORDER_SHIPPED',
        CANCELLED: 'ORDER_CANCELLED',
      };
      const evt = map[newStatus];
      if (evt) {
        supabase.functions.invoke('notify-order-event', {
          body: { order_id: id, event_type: evt, details: 'Status changed by ops' },
        }).catch((e) => console.warn('[notify-order-event] status change failed:', e));
      }
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

  // Advancement is always a deliberate click. SHIPPED keeps its pack-complete gate;
  // READY soft-warns when not packed but still allows an override.
  const handleAdvanceTo = (target: OrderStatus) => {
    if (target === 'SHIPPED') {
      handleMarkAsShipped();
      return;
    }
    if (target === 'CONFIRMED' && order.status === 'SUBMITTED') {
      confirmMutation.mutate();
      return;
    }
    if (target === 'READY' && !isDerivedPackComplete) {
      setIncompleteSteps(['Packed (per run sheet)']);
      setIncompleteIntent('READY');
      setShowIncompleteModal(true);
      return;
    }
    handleStatusChange(target);
  };

  // Primary recommended next action for the current status.
  const primaryNext: { target: OrderStatus; label: string; pending: boolean } | null = (() => {
    switch (order.status) {
      case 'SUBMITTED':
        return { target: 'CONFIRMED', label: 'Confirm Order', pending: confirmMutation.isPending };
      case 'CONFIRMED':
        return { target: 'IN_PRODUCTION', label: 'Start Production', pending: changeStatusMutation.isPending };
      case 'IN_PRODUCTION':
        return { target: 'READY', label: 'Mark Ready', pending: changeStatusMutation.isPending };
      case 'READY':
        return { target: 'SHIPPED', label: 'Mark as Shipped', pending: markAsShippedMutation.isPending };
      default:
        return null;
    }
  })();

  // Human label for a transition target, phrased as revert when moving backward.
  const currentIdx = PRODUCTION_LADDER.indexOf(order.status);
  const transitionLabel = (target: OrderStatus): string => {
    const targetIdx = PRODUCTION_LADDER.indexOf(target);
    const isRevert = targetIdx !== -1 && currentIdx !== -1 && targetIdx < currentIdx;
    if (target === 'CANCELLED') return 'Cancel Order';
    if (isRevert) return `Revert to ${STATUS_LABEL[target]}`;
    return STATUS_LABEL[target];
  };

  // Remaining allowed transitions for the secondary menu (excludes the primary
  // recommendation and the rarely-needed move back to DRAFT).
  const secondaryTransitions = (ALLOWED_ORDER_TRANSITIONS[order.status] ?? []).filter(
    (t) => t !== primaryNext?.target && t !== 'DRAFT',
  );

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
            <Button variant="default" size="default" className="gap-2 shadow-sm">
              <ArrowLeft className="h-4 w-4" />
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
            <CreatedByBadge userId={order.created_by_user_id} />
          )}
          <LocationBadge locationId={(order as any).location_id} />
        </div>
        <div className="flex items-center gap-2">
          {/* Delete Order button - destructive action */}
          <Button 
            variant="outline" 
            onClick={() => setShowDeleteModal(true)} 
            className="gap-2 text-destructive border-destructive/50 hover:bg-destructive/10 hover:border-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          
          {/* Print Packing Slips - one slip per shipment */}
          <Button
            variant="outline"
            onClick={() => {
              printPackingSlips(order.id).catch((err) => {
                console.error(err);
                toast.error(err instanceof Error ? err.message : 'Failed to print packing slips');
              });
            }}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            Print Packing Slips
          </Button>

          {/* Edit Order button */}
          <Button variant="outline" onClick={() => setShowEditModal(true)} className="gap-2">
            <PenSquare className="h-4 w-4" />
            Edit Order
          </Button>
          
          {/* Primary next-action button — the one obvious step for this status */}
          {primaryNext && (
            <Button
              onClick={() => handleAdvanceTo(primaryNext.target)}
              disabled={primaryNext.pending}
              className="gap-2"
            >
              {primaryNext.target === 'SHIPPED' && <Truck className="h-4 w-4" />}
              {primaryNext.target === 'IN_PRODUCTION' && <Flame className="h-4 w-4" />}
              {primaryNext.pending ? 'Working…' : primaryNext.label}
            </Button>
          )}

          {/* Secondary transitions (reverts, cancel, alternate advances) */}
          {secondaryTransitions.length > 0 && (
            <Select
              value=""
              onValueChange={(value) => handleAdvanceTo(value as OrderStatus)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={primaryNext ? 'More actions' : 'Change Status'} />
              </SelectTrigger>
              <SelectContent>
                {secondaryTransitions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {transitionLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Status stepper — at-a-glance position in the fulfillment ladder */}
      {order.status !== 'CANCELLED' && (
        <div className="mb-4 flex flex-wrap items-center gap-1 text-xs">
          {PRODUCTION_LADDER.map((s, i) => {
            const done = currentIdx !== -1 && i < currentIdx;
            const current = i === currentIdx;
            return (
              <React.Fragment key={s}>
                <span
                  className={`rounded px-2 py-1 ${
                    current
                      ? 'bg-primary text-primary-foreground font-medium'
                      : done
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {STATUS_LABEL[s]}
                </span>
                {i < PRODUCTION_LADDER.length - 1 && (
                  <span className="text-muted-foreground">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Order Info</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><strong>Client:</strong> {(order as any).account?.account_name ?? order.client?.name ?? 'Unknown'}</div>
            <div><strong>Status:</strong> {order.status}</div>
            <div><strong>Delivery:</strong> {order.delivery_method}</div>
            <div><strong>Client PO:</strong> {order.client_po || '—'}</div>
            <div>
              <strong>Expected Ship Date:</strong>{' '}
              {order.requested_ship_date
                ? format(parseDateOnly(order.requested_ship_date)!, 'MMM d, yyyy')
                : '—'}
              <span className="text-xs text-muted-foreground ml-1">(client intent)</span>
            </div>
            
            {/* Work Deadline - editable by Ops (date + time picker) */}
            <div className="border-t pt-3 mt-3">
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                <Label className="font-semibold">Work Deadline</Label>
                <span className="text-xs text-muted-foreground">(internal priority)</span>
              </div>
              <WorkDeadlinePicker
                value={workDeadlineAt}
                onChange={setWorkDeadlineAt}
                onSave={() => saveWorkDeadlineMutation.mutate(workDeadlineAt)}
                isSaving={saveWorkDeadlineMutation.isPending}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The absolute latest moment this order must be staged and ready to leave.
              </p>
            </div>
            
            {/* Audit History - collapsible */}
            <div className="border-t pt-3 mt-3">
              <OrderDateAuditHistory orderId={order.id} />
            </div>
          </CardContent>
        </Card>

        <OrderShipmentsCard orderId={order.id} />

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

            {/* Shipped Status - Read-only badge + action button */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Shipped</Label>
                </div>
                {order.status === 'SHIPPED' ? (
                  <Badge className="bg-primary text-primary-foreground text-xs gap-1">
                    <Check className="h-3 w-3" />
                    Yes
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Clock className="h-3 w-3" />
                    Pending
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Shipping status is set via the "Mark as Shipped" action.
              </p>
            </div>

            {/* Invoiced Status - Read-only badge + action button */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Invoiced</Label>
                </div>
                {order.invoiced ? (
                  <Badge className="bg-primary text-primary-foreground text-xs gap-1">
                    <Check className="h-3 w-3" />
                    Yes
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Clock className="h-3 w-3" />
                    Pending
                  </Badge>
                )}
              </div>
              {!order.invoiced && order.status !== 'CANCELLED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMarkAsInvoiced}
                  disabled={markAsInvoicedMutation.isPending}
                  className="w-full"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {markAsInvoicedMutation.isPending ? 'Processing…' : 'Mark as Invoiced'}
                </Button>
              )}
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
                    <th className="pb-2">Unit Price</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItemsWithPackedStatus.map((li) => (
                    <tr key={li.id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="flex flex-col gap-1">
                          <span>{li.product?.product_name ?? 'Unknown'}</span>
                          {(() => {
                            const prod = li.product as { grams_per_unit?: number | null; bag_size_g?: number | null } | null;
                            const grams = prod?.grams_per_unit ?? prod?.bag_size_g ?? null;
                            return grams ? (
                              <span className="text-xs text-muted-foreground">{formatGramsLabel(grams)}</span>
                            ) : null;
                          })()}
                        </div>
                      </td>
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
                      
                      <td className="py-2">${li.unit_price_locked.toFixed(2)}</td>
                      <td className="py-2 text-right">${(li.quantity_units * li.unit_price_locked).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="pt-4 text-right font-medium">Total:</td>
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
          if (incompleteIntent === 'READY') {
            changeStatusMutation.mutate('READY');
          } else {
            markAsShippedMutation.mutate();
          }
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
            account_id: (order as any).account_id,
            created_by_admin: order.created_by_admin,
            created_by_user_id: order.created_by_user_id,
          }}
          lineItems={lineItemsWithPackedStatus.map(li => ({
            id: li.id,
            product_id: li.product_id,
            product_name: li.product?.product_name ?? 'Unknown',
            quantity_units: li.quantity_units,
            grind: li.grind,
            unit_price_locked: li.unit_price_locked,
            shipment_id: (li as { shipment_id?: string | null }).shipment_id ?? null,
          }))}
          clientId={(order as any).account_id}
        />
      )}

      {/* Order Delete Modal */}
      {order && (
        <OrderDeleteModal
          open={showDeleteModal}
          onOpenChange={setShowDeleteModal}
          orderId={order.id}
          orderNumber={order.order_number}
        />
      )}
    </div>
  );
}
