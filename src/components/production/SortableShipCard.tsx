import React, { useState, useCallback, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ShipPickInput } from './ShipPickInput';
import { NudgeScheduleButtons } from './NudgeScheduleButtons';
import { DueBadge, getDueBucket } from './OverdueBadge';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TIMEZONE } from '@/lib/productionScheduling';
import { Truck, Clock, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, ExternalLink, Layers, CheckCircle2, GripVertical, MapPin, CalendarDays, Zap } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface LineItem {
  id: string;
  product_name: string;
  quantity_units: number;
  bag_size_g: number;
  packaging_variant: PackagingVariant | null;
  product_id: string;
  roast_group: string | null;
  shipment_id: string | null;
  // False for bought-in items: picking still records ship_picks (evidence the
  // shelf item was pulled) but never writes to the inventory ledger.
  requires_production: boolean;
}

interface ShippableShipment {
  cardId: string;
  order_id: string;
  shipment_id: string;
  shipment_number: number;
  shipmentCountForOrder: number;
  isFirstShipmentInOrder: boolean;
  shipToLabel: string;
  order_number: string;
  client_name: string;
  requested_ship_date: string | null;
  work_deadline: string | null;
  delivery_method: string;
  client_notes: string | null;
  internal_ops_notes: string | null;
  roasted: boolean;
  packed: boolean;
  invoiced: boolean;
  status: string;
  lineItems: LineItem[];
  allLineItemsPacked: boolean;
  orderAllPicked: boolean;
  priority: 'NORMAL' | 'TIME_SENSITIVE';
  hasContention: boolean;
  skuCount: number;
  totalUnits: number;
  missingSkuCount: number;
  missingUnitsTotal: number;
  ship_display_order: number | null;
  manually_deprioritized?: boolean;
  isPriorityProductionDay?: boolean;
}

interface ShipPick {
  id: string;
  order_id: string;
  order_line_item_id: string;
  units_picked: number;
}

interface SortableShipCardProps {
  order: ShippableShipment;
  fgInventory: Record<string, number>; // FG inventory from ledger by product_id
  onTogglePriority: (order: ShippableShipment) => void;
  onMarkShipped: (order: ShippableShipment) => void;
  isShipping: boolean;
}

export function SortableShipCard({
  order,
  fgInventory,
  onTogglePriority,
  onMarkShipped,
  isShipping,
}: SortableShipCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isLineItemsExpanded, setIsLineItemsExpanded] = useState(false);
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: order.cardId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Once an order is SHIPPED the goods are gone — the pick was the FG consumption
  // and shipping doesn't re-consume. Freeze picks so an unpick can't write a
  // compensating return that would re-add already-shipped stock. Defense-in-depth
  // behind the list filter, in case a just-shipped order lingers mid-refetch.
  const isShipped = order.status === 'SHIPPED';

  // Fetch ship picks for this order (shared across the order's shipments)
  const { data: shipPicks } = useQuery({
    queryKey: ['ship-picks', order.order_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select('*')
        .eq('order_id', order.order_id);
      if (error) throw error;
      return (data ?? []) as ShipPick[];
    },
    staleTime: 10000,
  });

  // Map picks by line item id
  const picksByLineItem: Record<string, number> = {};
  for (const pick of shipPicks ?? []) {
    picksByLineItem[pick.order_line_item_id] = pick.units_picked;
  }

  // Upsert ship pick mutation.
  // Delegates to the set_ship_pick RPC: it reads the previous picked count under
  // lock and writes the ship_picks row + the SHIP_CONSUME_FG delta atomically, so
  // two pickers (or a double-click before refetch) can't both compute the delta
  // from a stale baseline and double-consume FG. The server also resolves
  // requires_production and order status, so those params here are advisory only.
  const upsertPickMutation = useMutation({
    mutationFn: async ({
      lineItemId,
      unitsPicked,
    }: {
      lineItemId: string;
      unitsPicked: number;
      previousPicked: number;
      productId: string;
      requiresProduction: boolean;
    }) => {
      const { error } = await supabase.rpc('set_ship_pick', {
        p_order_id: order.order_id,
        p_order_line_item_id: lineItemId,
        p_units_picked: unitsPicked,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ship-picks', order.order_id] });
      queryClient.invalidateQueries({ queryKey: ['ship-picks-gating'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-ship-picks'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-fg'] });
      // The Ship tab renders FG Avail from useAuthoritativeFg (['authoritative-fg-ledger']).
      // Without this, a pick/unpick writes the SHIP_CONSUME_FG row to the DB but the
      // on-screen FG count never refreshes — making an unpick look like it returned no stock.
      queryClient.invalidateQueries({ queryKey: ['authoritative-fg-ledger'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update picked quantity');
    },
  });

  const handlePickChange = useCallback((li: LineItem, newValue: number, available: number) => {
    const previousPicked = picksByLineItem[li.id] ?? 0;
    // Clamp to 0-available
    const clamped = Math.max(0, Math.min(newValue, available));
    upsertPickMutation.mutate({
      lineItemId: li.id,
      unitsPicked: clamped,
      previousPicked,
      productId: li.product_id,
      requiresProduction: li.requires_production !== false,
    });
  }, [upsertPickMutation, picksByLineItem]);

  const [isPickingAll, setIsPickingAll] = useState(false);

  const handlePickAllAndShip = useCallback(async () => {
    setIsPickingAll(true);
    try {
      for (const li of order.lineItems) {
        const requiresProduction = li.requires_production !== false;
        const previousPicked = picksByLineItem[li.id] ?? 0;
        // Bought-in items aren't FG-gated: always pickable up to the required qty.
        const available = requiresProduction
          ? (fgInventory[li.product_id] ?? 0)
          : li.quantity_units;
        const target = Math.min(li.quantity_units, available + previousPicked);
        if (target === previousPicked) continue;
        await upsertPickMutation.mutateAsync({
          lineItemId: li.id,
          unitsPicked: target,
          previousPicked,
          productId: li.product_id,
          requiresProduction,
        });
      }
      onMarkShipped(order);
    } catch (e) {
      // toast handled by mutation
    } finally {
      setIsPickingAll(false);
    }
  }, [order, picksByLineItem, fgInventory, upsertPickMutation, onMarkShipped]);

  // Calculate if all items are fully picked
  const allItemsFullyPicked = order.lineItems.every((li) => {
    const picked = picksByLineItem[li.id] ?? 0;
    return picked >= li.quantity_units;
  });

  // Calculate remaining to pick
  let remainingSkus = 0;
  let remainingUnits = 0;
  for (const li of order.lineItems) {
    const picked = picksByLineItem[li.id] ?? 0;
    if (picked < li.quantity_units) {
      remainingSkus++;
      remainingUnits += li.quantity_units - picked;
    }
  }

  const isTimeSensitive = order.priority === 'TIME_SENSITIVE';
  const hasNotes = order.client_notes || order.internal_ops_notes;
  const hasOpsNotes = !!order.internal_ops_notes;
  const isShippable = allItemsFullyPicked;
  
  // Due-day bucket (calm cue, replaces noisy LATE)
  const dueBucket = useMemo(() => getDueBucket(order.work_deadline), [order.work_deadline]);
  const isDueToday = dueBucket === 'today';
  
  // Format work_deadline for display in Vancouver time
  const formattedDeadline = order.work_deadline
    ? format(toZonedTime(parseISO(order.work_deadline), TIMEZONE), 'EEE MMM d, HH:mm')
    : 'Not set';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-lg p-4 transition-colors ${
        isShippable
          ? 'border-green-500 bg-green-50 ring-2 ring-green-200 shadow-sm'
          : isDueToday && !isShippable
            ? 'border-destructive/40 bg-destructive/5' // Due today - calm emphasis, no pulse/ring
            : isTimeSensitive
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-muted bg-muted/20 opacity-80'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Drag handle */}
        <div
          className="flex items-center cursor-grab active:cursor-grabbing pt-1"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-lg">{order.order_number}</span>
            {order.shipmentCountForOrder > 1 && (
              <Badge variant="secondary" className="text-xs">
                Shipment {order.shipment_number}/{order.shipmentCountForOrder}
              </Badge>
            )}
            <span className="text-muted-foreground">•</span>
            <span className="font-medium">{order.client_name}</span>
            <span className="text-muted-foreground">•</span>
            <span className="flex items-center gap-1 text-sm">
              <MapPin className="h-3 w-3" />
              {order.shipToLabel}
            </span>

            {/* Quiet cue: today is this account's standard production day, so the
                order is floated to the top of the run sheet by default. */}
            {order.isPriorityProductionDay && (
              <Badge
                variant="outline"
                className="text-xs border-hi-sand/60 bg-hi-sand/10 text-hi-steel-blue"
              >
                <CalendarDays className="h-3 w-3 mr-1" />
                Today
              </Badge>
            )}

            {/* Due-day cue - calm, replaces noisy LATE badge */}
            <DueBadge workDeadlineAt={order.work_deadline} />

            {/* Shippable badge */}
            {isShippable && (
              <Badge className="text-xs bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ready
              </Badge>
            )}

            {isTimeSensitive && !isDueToday && (
              <Badge variant="destructive" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Urgent
              </Badge>
            )}
            
            {order.hasContention && (
              <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 bg-amber-50">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Shared SKU short
              </Badge>
            )}
            
            {/* Notes indicators */}
            {hasOpsNotes && (
              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-300">
                <MessageSquare className="h-3 w-3 mr-1" />
                Ops note
              </Badge>
            )}
            {hasNotes && !hasOpsNotes && (
              <Badge variant="outline" className="text-xs">
                <MessageSquare className="h-3 w-3 mr-1" />
                Notes
              </Badge>
            )}
          </div>
          
          {/* Metrics row - show work_deadline as primary, ship date as secondary */}
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
            <span className="font-medium text-foreground">
              Deadline: {formattedDeadline}
            </span>
            <span className="text-xs">
              (Ship: {order.requested_ship_date 
                ? format(parseISO(order.requested_ship_date), 'MMM d')
                : '—'})
            </span>
            <span>•</span>
            <span>{order.delivery_method}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {order.skuCount} SKU{order.skuCount !== 1 ? 's' : ''}, {order.totalUnits} units
            </span>
            
            {/* Remaining to pick */}
            {remainingUnits > 0 && (
              <>
                <span>•</span>
                <span className="text-amber-600 font-medium">
                  {remainingSkus} SKU{remainingSkus !== 1 ? 's' : ''} / {remainingUnits} unit{remainingUnits !== 1 ? 's' : ''} to pick
                </span>
              </>
            )}
            
            {/* Nudge controls - inline compact version */}
            <NudgeScheduleButtons
              orderId={order.order_id}
              currentDeadline={order.work_deadline}
              compact
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/orders/${order.order_id}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open
          </Button>
          <Button
            size="sm"
            variant={isTimeSensitive ? 'destructive' : 'outline'}
            onClick={() => onTogglePriority(order)}
          >
            <Clock className="h-4 w-4 mr-1" />
            {isTimeSensitive ? 'Urgent' : 'Normal'}
          </Button>
          {order.isFirstShipmentInOrder && !allItemsFullyPicked && (() => {
            const shortLines = order.lineItems.filter((li) => {
              if (li.requires_production === false) return false; // shelf item, never FG-short
              const picked = picksByLineItem[li.id] ?? 0;
              const available = fgInventory[li.product_id] ?? 0;
              return (available + picked) < li.quantity_units;
            });
            const canCoverAll = shortLines.length === 0;
            const busy = isPickingAll || isShipping;
            return (
              <Button
                size="sm"
                variant="outline"
                onClick={handlePickAllAndShip}
                disabled={busy || !canCoverAll}
                title={
                  !canCoverAll
                    ? `Not enough FG for ${shortLines.length} line${shortLines.length === 1 ? '' : 's'} — pick manually`
                    : 'Pick everything currently available and ship the order'
                }
              >
                <Zap className="h-4 w-4 mr-1" />
                {isPickingAll ? 'Picking…' : 'Pick all & Ship'}
              </Button>
            );
          })()}
          {order.isFirstShipmentInOrder && (
            <Button
              size="sm"
              onClick={() => onMarkShipped(order)}
              disabled={isShipping || isPickingAll || !order.orderAllPicked}
              className={order.orderAllPicked ? 'bg-green-600 hover:bg-green-700' : ''}
              title={
                !order.orderAllPicked
                  ? order.shipmentCountForOrder > 1
                    ? 'All shipments must be fully picked before shipping the order'
                    : `${remainingSkus} SKUs / ${remainingUnits} units remaining to pick`
                  : ''
              }
            >
              <Truck className="h-4 w-4 mr-1" />
              Ship Order
            </Button>
          )}
        </div>
      </div>

      {/* Notes - always show if present */}
      {hasNotes && (
        <Collapsible defaultOpen={hasOpsNotes}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground mt-2 hover:text-foreground">
            <MessageSquare className="h-3 w-3" />
            {hasOpsNotes ? 'View notes (has ops note)' : 'View notes'}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 p-2 bg-muted/50 rounded text-sm">
            {order.internal_ops_notes && (
              <p className="mb-1"><strong className="text-orange-700">Ops:</strong> {order.internal_ops_notes}</p>
            )}
            {order.client_notes && (
              <p><strong>Client:</strong> {order.client_notes}</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Line Items with Picking */}
      <Collapsible open={isLineItemsExpanded} onOpenChange={setIsLineItemsExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground mt-3 hover:text-foreground">
          {isLineItemsExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {order.lineItems.length} line item{order.lineItems.length !== 1 ? 's' : ''}
          {remainingUnits > 0 && (
            <span className="ml-2 text-amber-600">({remainingUnits} to pick)</span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 pb-1 border-b">
              <span className="flex-1">Product</span>
              <span className="w-16 text-center">Required</span>
              <span className="w-16 text-center">FG Avail</span>
              <span className="w-28 text-center">Picked</span>
              <span className="w-16 text-center">Remaining</span>
            </div>
            
            {order.lineItems.map((li) => {
              const requiresProduction = li.requires_production !== false;
              // Use ledger-based FG inventory. Bought-in items aren't FG-tracked:
              // treat the full required qty as available so picking is never blocked.
              const available = requiresProduction
                ? (fgInventory[li.product_id] ?? 0)
                : li.quantity_units;
              const picked = picksByLineItem[li.id] ?? 0;
              const remaining = Math.max(0, li.quantity_units - picked);
              const isComplete = picked >= li.quantity_units;
              const hasAvailable = available > 0;

              return (
                <div
                  key={li.id}
                  className={`flex items-center gap-2 text-sm p-2 rounded ${
                    isComplete
                      ? 'bg-green-100 border border-green-300'
                      : hasAvailable
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-muted/30 border border-muted'
                  }`}
                >
                  <div className="flex-1 flex items-center gap-2">
                    <span className="font-medium">{li.product_name}</span>
                    <PackagingBadge variant={li.packaging_variant} />
                    {requiresProduction ? (
                      <span className="text-muted-foreground text-xs">{li.bag_size_g}g</span>
                    ) : (
                      <Badge className="text-xs font-bold uppercase tracking-wide bg-amber-500 text-white border-amber-600 hover:bg-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                        No production — pull from stock
                      </Badge>
                    )}
                  </div>

                  <span className="w-16 text-center font-medium">{li.quantity_units}</span>

                  <span className={`w-16 text-center ${requiresProduction ? (available > 0 ? 'text-green-600 font-medium' : 'text-muted-foreground') : 'text-muted-foreground'}`}>
                    {requiresProduction ? available : '—'}
                  </span>

                  {/* Picked input with local state - commits on blur/Enter */}
                  <div className="w-28">
                    <ShipPickInput
                      value={picked}
                      maxValue={Math.max(available + picked, li.quantity_units)} // Can pick up to what's available + already picked
                      fillValue={li.quantity_units} // "Pick all" fills Required, not FG available
                      onCommit={(newValue) => handlePickChange(li, newValue, available + picked)}
                      disabled={upsertPickMutation.isPending || isShipped}
                    />
                  </div>

                  <span className={`w-16 text-center ${remaining > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}`}>
                    {remaining > 0 ? remaining : '✓'}
                  </span>
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
