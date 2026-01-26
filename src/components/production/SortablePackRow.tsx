import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Check, AlertTriangle, Clock, ShoppingCart, CheckCircle, GripVertical } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { InlinePackingControl } from './InlinePackingControl';
import { PackRowDrawer } from './PackRowDrawer';

interface PackingRun {
  id: string;
  product_id: string;
  target_date: string;
  units_packed: number;
  kg_consumed: number;
  notes: string | null;
}

interface SortablePackRowProps {
  productId: string;
  productName: string;
  sku: string | null;
  bagSizeG: number;
  packagingVariant: PackagingVariant | null;
  roastGroup: string | null;
  demandedUnits: number;
  packedUnits: number;
  hasTimeSensitive: boolean;
  hasWipAvailable: boolean;
  unblocksOrders: number;
  wipAvailableKg: number;
  requiredKg: number;
  packingRun: PackingRun | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdatePackedUnits: (newValue: number) => Promise<void>;
  onEditingChange: (isEditing: boolean) => void;
}

export function SortablePackRow({
  productId,
  productName,
  sku,
  bagSizeG,
  packagingVariant,
  roastGroup,
  demandedUnits,
  packedUnits,
  hasTimeSensitive,
  hasWipAvailable,
  unblocksOrders,
  wipAvailableKg,
  requiredKg,
  packingRun,
  isExpanded,
  onToggleExpand,
  onUpdatePackedUnits,
  onEditingChange,
}: SortablePackRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: productId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isComplete = packedUnits >= demandedUnits;

  return (
    <React.Fragment>
      <tr
        ref={setNodeRef}
        style={style}
        className={`border-b last:border-0 cursor-pointer transition-colors 
          ${hasTimeSensitive ? 'bg-destructive/5' : ''} 
          ${hasWipAvailable
            ? (isExpanded
                ? 'bg-success/15 border-l-2 border-l-success'
                : 'bg-success/10 border-l-2 border-l-success')
            : isExpanded
              ? 'bg-muted/40 border-l-2 border-l-border'
              : 'hover:bg-muted/50'}
        `}
        onClick={onToggleExpand}
      >
        {/* Drag handle */}
        <td
          className="py-1 w-10 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </td>
        <td className="py-3 w-8">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{productName}</span>
            <PackagingBadge variant={packagingVariant} />
            {hasTimeSensitive && (
              <Badge variant="destructive" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Urgent
              </Badge>
            )}
            {unblocksOrders > 0 && (demandedUnits - packedUnits) > 0 && (
              <Badge variant="outline" className="text-xs">
                <ShoppingCart className="h-3 w-3 mr-1" />
                Unblocks: {unblocksOrders} order{unblocksOrders !== 1 ? 's' : ''}
              </Badge>
            )}
            {hasWipAvailable && (
              <Badge
                variant="outline"
                className="text-xs bg-success/15 text-success border-success/30"
              >
                <CheckCircle className="h-3 w-3 mr-1 text-success" />
                WIP ready
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {bagSizeG}g • {sku || 'No SKU'}
          </div>
        </td>
        <td className="py-3">
          {roastGroup ? (
            <Badge variant="secondary">{roastGroup}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 text-right">
          <span className="font-medium">{demandedUnits}</span>
          <span className="text-muted-foreground text-xs ml-1">units</span>
        </td>
        <td className="py-3" onClick={(e) => e.stopPropagation()}>
          <InlinePackingControl
            value={packedUnits}
            onCommit={onUpdatePackedUnits}
            onEditingChange={onEditingChange}
            isComplete={isComplete}
          />
        </td>
        <td className="py-3 text-right">
          {isComplete ? (
            <Badge variant="default" className="bg-primary text-primary-foreground">
              <Check className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          ) : packedUnits > 0 ? (
            <Badge variant="secondary">
              {Math.round((packedUnits / demandedUnits) * 100)}%
            </Badge>
          ) : (
            <Badge variant="outline">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Pending
            </Badge>
          )}
        </td>
      </tr>
      {isExpanded && (
        <PackRowDrawer
          productId={productId}
          productName={productName}
          sku={sku}
          roastGroup={roastGroup}
          packingRun={packingRun ?? null}
          unblocksOrders={unblocksOrders}
          wipAvailableKg={wipAvailableKg}
          requiredKg={requiredKg}
          hasWipAvailable={hasWipAvailable}
        />
      )}
    </React.Fragment>
  );
}
