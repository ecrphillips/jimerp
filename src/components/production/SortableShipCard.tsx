import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format, parseISO } from 'date-fns';
import { Truck, Clock, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, ExternalLink, Layers, CheckCircle2, GripVertical } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';

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

  const isTimeSensitive = order.priority === 'TIME_SENSITIVE';
  const hasNotes = order.client_notes || order.internal_ops_notes;
  const hasOpsNotes = !!order.internal_ops_notes;
  const isShippable = order.allLineItemsPacked;

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
            
            {/* Missing metrics for non-shippable orders */}
            {!isShippable && order.missingSkuCount === 1 && order.missingUnitsTotal <= 5 && (
              <>
                <span>•</span>
                <span className="text-blue-600 font-medium">
                  Almost ready: 1 SKU, {order.missingUnitsTotal} unit{order.missingUnitsTotal !== 1 ? 's' : ''} short
                </span>
              </>
            )}
            {!isShippable && !(order.missingSkuCount === 1 && order.missingUnitsTotal <= 5) && (
              <>
                <span>•</span>
                <span className="text-muted-foreground">
                  Needs: {order.missingSkuCount} SKU{order.missingSkuCount !== 1 ? 's' : ''}, {order.missingUnitsTotal} unit{order.missingUnitsTotal !== 1 ? 's' : ''}
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
          {isShippable && (
            <Button
              size="sm"
              onClick={() => onMarkShipped(order)}
              disabled={isShipping}
              className="bg-green-600 hover:bg-green-700"
            >
              <Truck className="h-4 w-4 mr-1" />
              Mark Shipped
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

      {/* Line Items */}
      <Collapsible open={isLineItemsExpanded} onOpenChange={setIsLineItemsExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground mt-3 hover:text-foreground">
          {isLineItemsExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {order.lineItems.length} line item{order.lineItems.length !== 1 ? 's' : ''}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="space-y-1">
            {order.lineItems.map((li) => {
              const packed = packingByProduct[li.product_id] ?? 0;
              const isMissing = packed < li.quantity_units;
              
              return (
                <div 
                  key={li.id} 
                  className={`flex items-center gap-2 text-sm p-2 rounded ${
                    isMissing ? 'bg-amber-50 border border-amber-200' : 'bg-muted/30'
                  }`}
                >
                  <span className="font-medium">{li.product_name}</span>
                  <PackagingBadge variant={li.packaging_variant} />
                  <span className="text-muted-foreground">{li.bag_size_g}g</span>
                  <span className="ml-auto font-medium">× {li.quantity_units}</span>
                  {isMissing && (
                    <span className="text-amber-600 text-xs">
                      (packed: {packed})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
