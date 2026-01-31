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
import { OverdueBadge, isOrderOverdue } from './OverdueBadge';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TIMEZONE } from '@/lib/productionScheduling';
import { Truck, Clock, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, ExternalLink, Layers, CheckCircle2, GripVertical } from 'lucide-react';
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
}

interface ShippableOrder {
  id: string;
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
  lineItems: LineItem[];
  allLineItemsPacked: boolean;
  priority: 'NORMAL' | 'TIME_SENSITIVE';
  hasContention: boolean;
  skuCount: number;
  totalUnits: number;
  missingSkuCount: number;
  missingUnitsTotal: number;
  ship_display_order: number | null;
  manually_deprioritized?: boolean;
}

interface ShipPick {
  id: string;
  order_id: string;
  order_line_item_id: string;
  units_picked: number;
}

interface SortableShipCardProps {
  order: ShippableOrder;
  fgInventory: Record<string, number>; // FG inventory from ledger by product_id
  onTogglePriority: (order: ShippableOrder) => void;
  onMarkShipped: (order: ShippableOrder) => void;
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
  } = useSortable({ id: order.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Fetch ship picks for this order
  const { data: shipPicks } = useQuery({
    queryKey: ['ship-picks', order.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select('*')
        .eq('order_id', order.id);
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

  // Upsert ship pick mutation - now writes ledger transactions
  const upsertPickMutation = useMutation({
    mutationFn: async ({ 
      lineItemId, 
      unitsPicked, 
      previousPicked, 
      productId 
    }: { 
      lineItemId: string; 
      unitsPicked: number; 
      previousPicked: number;
      productId: string;
    }) => {
      const delta = unitsPicked - previousPicked;
      
      // Update ship_picks record
      const { error: pickError } = await supabase
        .from('ship_picks')
        .upsert({
          order_id: order.id,
          order_line_item_id: lineItemId,
          units_picked: unitsPicked,
          updated_by: user?.id,
        }, {
          onConflict: 'order_line_item_id',
        });
      if (pickError) throw pickError;
      
      // Write SHIP_CONSUME_FG transaction for the delta
      // Positive delta = consume FG (negative units)
      // Negative delta = return FG (positive units)
      if (delta !== 0) {
        const { error: ledgerError } = await supabase
          .from('inventory_transactions')
          .insert({
            transaction_type: 'SHIP_CONSUME_FG',
            product_id: productId,
            order_id: order.id,
            quantity_units: -delta, // negative for consumption, positive for return
            notes: delta > 0 
              ? `Picked ${delta} units for order ${order.order_number}` 
              : `Returned ${Math.abs(delta)} units from order ${order.order_number}`,
            is_system_generated: true,
            created_by: user?.id,
          });
        
        if (ledgerError) {
          console.error('[SortableShipCard] Ledger write failed:', ledgerError);
          throw ledgerError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ship-picks', order.id] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-ship-picks'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-fg'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update picked quantity');
    },
  });

  const handlePickChange = useCallback((lineItemId: string, newValue: number, available: number, productId: string) => {
    const previousPicked = picksByLineItem[lineItemId] ?? 0;
    // Clamp to 0-available
    const clamped = Math.max(0, Math.min(newValue, available));
    upsertPickMutation.mutate({ lineItemId, unitsPicked: clamped, previousPicked, productId });
  }, [upsertPickMutation, picksByLineItem]);

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
  
  // Check if order is overdue
  const isOverdue = useMemo(() => isOrderOverdue(order.work_deadline), [order.work_deadline]);
  
  // Format work_deadline for display in Vancouver time
  const formattedDeadline = order.work_deadline
    ? format(toZonedTime(parseISO(order.work_deadline), TIMEZONE), 'EEE MMM d, HH:mm')
    : 'Not set';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-lg p-4 transition-colors ${
        isOverdue && !isShippable
          ? 'border-destructive bg-destructive/5 ring-2 ring-destructive/30 shadow-md' // OVERDUE - highest priority styling
          : isShippable 
            ? 'border-green-500 bg-green-50 ring-2 ring-green-200 shadow-sm' 
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
            <span className="text-muted-foreground">•</span>
            <span className="font-medium">{order.client_name}</span>
            
            {/* Overdue badge - highest priority, always visible */}
            {isOverdue && (
              <OverdueBadge workDeadlineAt={order.work_deadline} />
            )}
            
            {/* Shippable badge */}
            {isShippable && (
              <Badge className="text-xs bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ready
              </Badge>
            )}
            
            {isTimeSensitive && !isOverdue && (
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
              orderId={order.id}
              currentDeadline={order.work_deadline}
              compact
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/orders/${order.id}`)}
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
          <Button
            size="sm"
            onClick={() => onMarkShipped(order)}
            disabled={isShipping || !allItemsFullyPicked}
            className={allItemsFullyPicked ? 'bg-green-600 hover:bg-green-700' : ''}
            title={!allItemsFullyPicked ? `${remainingSkus} SKUs / ${remainingUnits} units remaining to pick` : ''}
          >
            <Truck className="h-4 w-4 mr-1" />
            Ship
          </Button>
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
              // Use ledger-based FG inventory
              const available = fgInventory[li.product_id] ?? 0;
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
                    <span className="text-muted-foreground text-xs">{li.bag_size_g}g</span>
                  </div>
                  
                  <span className="w-16 text-center font-medium">{li.quantity_units}</span>
                  
                  <span className={`w-16 text-center ${available > 0 ? 'text-green-600 font-medium' : 'text-muted-foreground'}`}>
                    {available}
                  </span>
                  
                  {/* Picked input with local state - commits on blur/Enter */}
                  <div className="w-28">
                    <ShipPickInput
                      value={picked}
                      maxValue={Math.max(available + picked, li.quantity_units)} // Can pick up to what's available + already picked
                      onCommit={(newValue) => handlePickChange(li.id, newValue, available + picked, li.product_id)}
                      disabled={upsertPickMutation.isPending}
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
