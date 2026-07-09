import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Check, AlertTriangle, Clock, ShoppingCart, CheckCircle, AlertCircle, GripVertical, Layers } from 'lucide-react';
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

export type WipStatus = 'full' | 'partial' | 'none';

interface SortablePackRowProps {
  productId: string;
  productName: string;
  sku: string | null;
  bagSizeG: number;
  packagingVariant: PackagingVariant | null;
  roastGroup: string | null;
  demandedUnits: number;
  /** Gross FG produced (sum of PACK_PRODUCE_FG), all-time. Used only for the
   *  "covered by picks" comparison; it never drops when bags ship, so do NOT
   *  use it for the input value or completeness. */
  packedUnits: number;
  /** Net FG on-hand (created + shipNet + adjust). Drives the editable input
   *  value AND completeness/shortage — the RPC baseline is this same net figure,
   *  so a SKU whose stock already shipped shows 0 packed and reads pending. */
  availableUnits: number;
  /** Downstream picks for open orders. Counted as implicit packs so the row
   *  is flagged complete and won't pressure the packer to over-pack a SKU the
   *  shipper has already grabbed. The numeric input still edits raw packs. */
  pickedUnits?: number;
  /** Grind alarm: of demandedUnits, how many are whole bean vs need grinding,
   *  and the per-grind-label breakdown. Drives the unmissable GRIND badge. */
  wholeBeanUnits?: number;
  grindUnits?: number;
  grindByLabel?: Record<string, number>;
  hasTimeSensitive: boolean;
  wipStatus: WipStatus;
  unblocksOrders: number;
  wipAvailableKg: number;
  requiredKg: number;
  plannedKg: number;
  plannedCount: number;
  packingRun: PackingRun | undefined;
  /** False for bought-in items: attention-only row — no pack controls, no WIP
   *  math, never writes to any ledger. Rendered with an amber badge so the
   *  packer remembers to pull the item off the shelf. */
  requiresProduction?: boolean;
  isExpanded: boolean;
  /** When true, the row was already complete at session/snapshot time and is
   *  visually de-emphasized so the packer's eye lands on outstanding work.
   *  The drawer is also force-collapsed for de-emphasized rows. */
  deemphasized?: boolean;
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
  availableUnits,
  pickedUnits = 0,
  wholeBeanUnits = 0,
  grindUnits = 0,
  grindByLabel = {},
  hasTimeSensitive,
  wipStatus,
  unblocksOrders,
  wipAvailableKg,
  requiredKg,
  plannedKg,
  plannedCount,
  packingRun,
  requiresProduction = true,
  isExpanded,
  deemphasized = false,
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

  // Effective packed = net on-hand + open-order picks. availableUnits already
  // subtracts every ship (incl. bags shipped to past orders), so adding back
  // the open-order picks yields "FG physically in play for current demand" =
  // on-shelf + already-picked. Using gross packedUnits here would keep a SKU
  // marked complete on stock that already shipped away. The numeric input binds
  // to availableUnits (net on-hand) — matching the RPC baseline — so editing it
  // drives real stock and never shows shipped-away bags as still packed.
  const effectivePacked = availableUnits + pickedUnits;
  const isComplete = effectivePacked >= demandedUnits;
  const coveredByPicks = pickedUnits > packedUnits && isComplete;

  // Determine row styling based on wipStatus
  // - 'full': GREEN - enough WIP to complete entire row
  // - 'partial': AMBER - some WIP available but not enough
  // - 'none': NO COLOR - no WIP at all
  const getRowClasses = () => {
    const baseClasses = 'border-b last:border-0 cursor-pointer transition-colors';

    // De-emphasized rows (already complete at snapshot time) drop all colored
    // accents and fade so the eye lands on outstanding work. Click still expands.
    if (deemphasized) {
      return `${baseClasses} opacity-50 hover:opacity-100 hover:bg-muted/40`;
    }

    if (hasTimeSensitive) {
      // Urgent items keep their destructive background but can have WIP indicator
      if (wipStatus === 'full') {
        return `${baseClasses} bg-destructive/5 border-l-2 border-l-success`;
      }
      if (wipStatus === 'partial') {
        return `${baseClasses} bg-destructive/5 border-l-2 border-l-warning`;
      }
      return `${baseClasses} bg-destructive/5`;
    }
    
    if (wipStatus === 'full') {
      return `${baseClasses} ${isExpanded ? 'bg-success/15' : 'bg-success/10'} border-l-2 border-l-success`;
    }
    
    if (wipStatus === 'partial') {
      return `${baseClasses} ${isExpanded ? 'bg-warning/15' : 'bg-warning/10'} border-l-2 border-l-warning`;
    }
    
    // None - no color
    return `${baseClasses} ${isExpanded ? 'bg-muted/40 border-l-2 border-l-border' : 'hover:bg-muted/50'}`;
  };

  return (
    <React.Fragment>
      <tr
        ref={setNodeRef}
        style={style}
        className={getRowClasses()}
        onClick={requiresProduction ? onToggleExpand : undefined}
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
          {!requiresProduction ? null : isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{productName}</span>
            <PackagingBadge variant={packagingVariant} />
            {/* Bought-in item: attention-only cue, styled like the grind alarm */}
            {!requiresProduction && (
              <Badge className="text-xs font-bold uppercase tracking-wide bg-amber-500 text-white border-amber-600 hover:bg-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                No production — pull from stock
              </Badge>
            )}
            {hasTimeSensitive && (
              <Badge variant="destructive" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Urgent
              </Badge>
            )}
            {requiresProduction && unblocksOrders > 0 && (demandedUnits - effectivePacked) > 0 && (
              <Badge variant="outline" className="text-xs">
                <ShoppingCart className="h-3 w-3 mr-1" />
                Unblocks: {unblocksOrders} order{unblocksOrders !== 1 ? 's' : ''}
              </Badge>
            )}
            {coveredByPicks && (
              <Badge
                variant="outline"
                className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
                title="The shipper has already picked enough bags of this SKU. The pack is covered — record any remaining physical packs if you want, but no shortage exists."
              >
                Covered by picks ({pickedUnits})
              </Badge>
            )}
            {/* WIP status badges */}
            {requiresProduction && wipStatus === 'full' && (
              <Badge
                variant="outline"
                className="text-xs bg-success/15 text-success border-success/30"
              >
                <CheckCircle className="h-3 w-3 mr-1 text-success" />
                WIP ready
              </Badge>
            )}
            {requiresProduction && wipStatus === 'partial' && (
              <Badge
                variant="outline"
                className="text-xs bg-warning/15 text-warning border-warning/30"
              >
                <AlertCircle className="h-3 w-3 mr-1 text-warning" />
                WIP partial
              </Badge>
            )}
            {requiresProduction && wipStatus !== 'full' && plannedCount > 0 && (
              <Badge variant="outline" className="text-xs">
                <Layers className="h-3 w-3 mr-1" />
                {plannedCount} planned (~{plannedKg.toFixed(1)} kg)
              </Badge>
            )}
          </div>
          {/* Grind alarm — unmissable when any units need grinding. Failsafe so the
              packer can never ship whole bean by mistake. No badge when all whole bean. */}
          {grindUnits > 0 && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <Badge className="text-xs font-bold uppercase tracking-wide bg-orange-500 text-white border-orange-600 hover:bg-orange-500">
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                {grindUnits} GRIND
              </Badge>
              <span className="text-xs font-medium text-muted-foreground">
                {wholeBeanUnits} whole bean
              </span>
              {Object.entries(grindByLabel).map(([label, qty]) => (
                <Badge
                  key={label}
                  variant="outline"
                  className="text-xs font-semibold border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800"
                >
                  {qty} × {label}
                </Badge>
              ))}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {requiresProduction
              ? `${bagSizeG}g • ${sku || 'No SKU'}`
              : [sku, 'Bought-in item'].filter(Boolean).join(' • ')}
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
          {requiresProduction ? (
            <InlinePackingControl
              value={availableUnits}
              onCommit={onUpdatePackedUnits}
              onEditingChange={onEditingChange}
              isComplete={isComplete}
              fillValue={demandedUnits}
            />
          ) : (
            // Bought-in item: nothing to pack, nothing to write to any ledger.
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </td>
        <td className="py-3 text-right">
          {!requiresProduction ? (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Pull from stock
            </Badge>
          ) : isComplete ? (
            <Badge variant="default" className="bg-primary text-primary-foreground">
              <Check className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          ) : effectivePacked > 0 ? (
            <Badge variant="secondary">
              {Math.round((effectivePacked / demandedUnits) * 100)}%
            </Badge>
          ) : (
            <Badge variant="outline">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Pending
            </Badge>
          )}
        </td>
      </tr>
      {isExpanded && requiresProduction && (
        <PackRowDrawer
          productId={productId}
          productName={productName}
          sku={sku}
          roastGroup={roastGroup}
          packingRun={packingRun ?? null}
          unblocksOrders={unblocksOrders}
          wipAvailableKg={wipAvailableKg}
          requiredKg={requiredKg}
          plannedKg={plannedKg}
          plannedCount={plannedCount}
          wipStatus={wipStatus}
        />
      )}
    </React.Fragment>
  );
}