import React, { useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format, parseISO } from 'date-fns';
import { Truck, Clock, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, ExternalLink, Layers, CheckCircle2, GripVertical, Minus, Plus } from 'lucide-react';
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
}

interface ShippableOrder {
  id: string;
  order_number: string;
  client_name: string;
  requested_ship_date: string | null;
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
}

interface ShipPick {
  id: string;
  order_id: string;
  order_line_item_id: string;
  units_picked: number;
}

interface SortableShipCardProps {
  order: ShippableOrder;
  packingByProduct: Record<string, number>;
  onTogglePriority: (order: ShippableOrder) => void;
  onMarkShipped: (order: ShippableOrder) => void;
  isShipping: boolean;
}

export function SortableShipCard({
  order,
  packingByProduct,
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

  // Upsert ship pick mutation
  const upsertPickMutation = useMutation({
    mutationFn: async ({ lineItemId, unitsPicked }: { lineItemId: string; unitsPicked: number }) => {
      const { error } = await supabase
        .from('ship_picks')
        .upsert({
          order_id: order.id,
          order_line_item_id: lineItemId,
          units_picked: unitsPicked,
          updated_by: user?.id,
        }, {
          onConflict: 'order_line_item_id',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ship-picks', order.id] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update picked quantity');
    },
  });

  const handlePickChange = useCallback((lineItemId: string, newValue: number, available: number) => {
    // Clamp to 0-available
    const clamped = Math.max(0, Math.min(newValue, available));
    upsertPickMutation.mutate({ lineItemId, unitsPicked: clamped });
  }, [upsertPickMutation]);

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
  const isShippable = order.allLineItemsPacked && allItemsFullyPicked;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-lg p-4 transition-colors ${
        isShippable 
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
            
            {/* Shippable badge */}
            {isShippable && (
              <Badge className="text-xs bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ready
              </Badge>
            )}
            
            {isTimeSensitive && (
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
          
          {/* Metrics row */}
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
            <span>
              Ship: {order.requested_ship_date 
                ? format(parseISO(order.requested_ship_date), 'MMM d, yyyy')
                : 'Not set'}
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
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/orders/${order.id}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open Order
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
            Mark Shipped
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
              <span className="w-16 text-center">Available</span>
              <span className="w-28 text-center">Picked</span>
              <span className="w-16 text-center">Remaining</span>
            </div>
            
            {order.lineItems.map((li) => {
              const available = packingByProduct[li.product_id] ?? 0;
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
                  
                  {/* Picked input with +/- buttons */}
                  <div className="w-28 flex items-center justify-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      onClick={() => handlePickChange(li.id, picked - 1, available)}
                      disabled={picked <= 0 || upsertPickMutation.isPending}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      min="0"
                      max={available}
                      value={picked}
                      onChange={(e) => handlePickChange(li.id, parseInt(e.target.value) || 0, available)}
                      className="w-12 h-7 text-center text-sm px-1"
                      disabled={upsertPickMutation.isPending}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      onClick={() => handlePickChange(li.id, picked + 1, available)}
                      disabled={picked >= available || upsertPickMutation.isPending}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
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