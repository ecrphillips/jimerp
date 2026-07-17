import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Check,
  Clock,
  Layers,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { InlinePackingControl } from './InlinePackingControl';

export type PackGroupMode = 'account' | 'roastgroup';
export type WipStatus = 'full' | 'partial' | 'none';

export interface PackingRun {
  id: string;
  product_id: string;
  target_date: string;
  units_packed: number;
  kg_consumed: number;
  notes: string | null;
}

/** A single product under one account (per-account demanded quantity). */
export interface PackLeafNode {
  /** Stable key for expand state — includes the full path so the same SKU under
   *  two accounts expands independently. */
  key: string;
  productId: string;
  productName: string;
  sku: string | null;
  bagSizeG: number;
  packagingVariant: PackagingVariant | null;
  roastGroupKey: string;
  roastGroupLabel: string;
  /** Demanded units for THIS account only (display). */
  units: number;
  wholeBeanUnits: number;
  grindUnits: number;
  grindByLabel: Record<string, number>;
  requiresProduction: boolean;
}

/** Second nesting level: roast group (in account mode) or account (in roast mode). */
export interface PackL2Node {
  key: string;
  label: string;
  kind: PackGroupMode; // what THIS level represents
  totalUnits: number;
  orderCount?: number;
  wipKg?: number | null;
  planned?: { planned_kg: number; count: number } | null;
  leaves: PackLeafNode[];
}

/** Top nesting level: account (in account mode) or roast group (in roast mode). */
export interface PackL1Node {
  key: string;
  label: string;
  kind: PackGroupMode;
  totalUnits: number;
  orderCount?: number;
  wipKg?: number | null;
  planned?: { planned_kg: number; count: number } | null;
  children: PackL2Node[];
}

interface PackGroupedViewProps {
  tree: PackL1Node[];
  mode: PackGroupMode;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  expandedLeafKey: string | null;
  onToggleLeaf: (key: string) => void;
  // Global (per-SKU) inventory maps — the packing entry is always SKU-global.
  globalDemandByProduct: Record<string, number>;
  availableByProduct: Record<string, number>;
  pickedByProduct: Record<string, number>;
  wipStatusByProduct: Record<string, WipStatus>;
  wipAvailableKgByProduct: Record<string, number>;
  requiredKgByProduct: Record<string, number>;
  timeSensitiveByProduct: Record<string, boolean>;
  onUpdatePackedUnits: (
    productId: string,
    newUnits: number,
    bagSizeG: number,
    roastGroupKey: string,
    previousUnits: number,
  ) => Promise<void>;
  onEditingChange: (productId: string, isEditing: boolean) => void;
}

function GrindBadges({
  grindUnits,
  wholeBeanUnits,
  grindByLabel,
}: {
  grindUnits: number;
  wholeBeanUnits: number;
  grindByLabel: Record<string, number>;
}) {
  if (grindUnits <= 0) return null;
  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap">
      <Badge className="text-xs font-bold uppercase tracking-wide bg-orange-500 text-white border-orange-600 hover:bg-orange-500">
        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
        {grindUnits} GRIND
      </Badge>
      {wholeBeanUnits > 0 && (
        <span className="text-xs font-medium text-muted-foreground">{wholeBeanUnits} whole bean</span>
      )}
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
  );
}

/** Left-border accent by WIP readiness, matching the flat pack row cues. */
function leafAccent(wipStatus: WipStatus, requiresProduction: boolean): string {
  if (!requiresProduction) return 'border-l-amber-500';
  if (wipStatus === 'full') return 'border-l-success';
  if (wipStatus === 'partial') return 'border-l-warning';
  return 'border-l-transparent';
}

function LeafRow({
  leaf,
  props,
}: {
  leaf: PackLeafNode;
  props: PackGroupedViewProps;
}) {
  const {
    expandedLeafKey,
    onToggleLeaf,
    globalDemandByProduct,
    availableByProduct,
    pickedByProduct,
    wipStatusByProduct,
    wipAvailableKgByProduct,
    requiredKgByProduct,
    timeSensitiveByProduct,
    onUpdatePackedUnits,
    onEditingChange,
  } = props;

  const pid = leaf.productId;
  const wipStatus = wipStatusByProduct[pid] ?? 'none';
  const globalDemand = globalDemandByProduct[pid] ?? 0;
  const available = availableByProduct[pid] ?? 0;
  const picked = pickedByProduct[pid] ?? 0;
  const effectivePacked = available + picked;
  const isComplete = leaf.requiresProduction
    ? globalDemand > 0 && effectivePacked >= globalDemand
    : true;
  const isExpanded = expandedLeafKey === leaf.key && leaf.requiresProduction;
  const timeSensitive = timeSensitiveByProduct[pid] ?? false;

  return (
    <div className={`border-l-2 ${leafAccent(wipStatus, leaf.requiresProduction)}`}>
      <div
        className={`flex items-center gap-3 px-3 py-2 pl-6 border-b last:border-0 transition-colors ${
          leaf.requiresProduction ? 'cursor-pointer hover:bg-muted/50' : ''
        } ${isExpanded ? 'bg-muted/40' : ''}`}
        onClick={leaf.requiresProduction ? () => onToggleLeaf(leaf.key) : undefined}
      >
        <div className="w-4 shrink-0">
          {leaf.requiresProduction ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{leaf.productName}</span>
            <PackagingBadge variant={leaf.packagingVariant} />
            {!leaf.requiresProduction && (
              <Badge className="text-xs font-bold uppercase tracking-wide bg-amber-500 text-white border-amber-600 hover:bg-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                No production — pull from stock
              </Badge>
            )}
            {timeSensitive && (
              <Badge variant="destructive" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Urgent
              </Badge>
            )}
            {leaf.requiresProduction && wipStatus === 'full' && (
              <Badge variant="outline" className="text-xs bg-success/15 text-success border-success/30">
                <CheckCircle className="h-3 w-3 mr-1 text-success" />
                WIP ready
              </Badge>
            )}
            {leaf.requiresProduction && wipStatus === 'partial' && (
              <Badge variant="outline" className="text-xs bg-warning/15 text-warning border-warning/30">
                <AlertCircle className="h-3 w-3 mr-1 text-warning" />
                WIP partial
              </Badge>
            )}
          </div>
          <GrindBadges
            grindUnits={leaf.grindUnits}
            wholeBeanUnits={leaf.wholeBeanUnits}
            grindByLabel={leaf.grindByLabel}
          />
          <div className="text-xs text-muted-foreground mt-0.5">
            {leaf.bagSizeG}g • {leaf.sku || 'No SKU'}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <span className="font-semibold">{leaf.units}</span>
          <span className="text-muted-foreground text-xs ml-1">units</span>
        </div>

        <div className="w-24 shrink-0 flex justify-end">
          {!leaf.requiresProduction ? (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
            >
              Pull stock
            </Badge>
          ) : isComplete ? (
            <Badge variant="default" className="bg-primary text-primary-foreground">
              <Check className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          ) : effectivePacked > 0 ? (
            <Badge variant="secondary">{Math.round((effectivePacked / globalDemand) * 100)}%</Badge>
          ) : (
            <Badge variant="outline">Pending</Badge>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 py-3 pl-10 bg-muted/20 border-b">
          <div className="mb-2 text-xs text-muted-foreground">
            SKU-wide progress (all accounts) — packing is recorded once per SKU.
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm">
              <span className="font-medium">{effectivePacked}</span>
              <span className="text-muted-foreground"> / {globalDemand} packed</span>
              {leaf.roastGroupLabel && (
                <span className="text-muted-foreground">
                  {'  ·  '}WIP {(wipAvailableKgByProduct[pid] ?? 0).toFixed(1)} kg avail /{' '}
                  {(requiredKgByProduct[pid] ?? 0).toFixed(1)} kg needed
                </span>
              )}
            </div>
            <InlinePackingControl
              value={available}
              onCommit={(v) =>
                onUpdatePackedUnits(pid, v, leaf.bagSizeG, leaf.roastGroupKey, available)
              }
              onEditingChange={(editing) => onEditingChange(pid, editing)}
              isComplete={isComplete}
              fillValue={globalDemand}
            />
          </div>
          {picked > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <Layers className="h-3 w-3 inline mr-1" />
              {picked} unit{picked !== 1 ? 's' : ''} already picked by shipper (counts toward packed).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupHeader({
  label,
  kind,
  totalUnits,
  orderCount,
  wipKg,
  planned,
  collapsed,
  level,
  onClick,
}: {
  label: string;
  kind: PackGroupMode;
  totalUnits: number;
  orderCount?: number;
  wipKg?: number | null;
  planned?: { planned_kg: number; count: number } | null;
  collapsed: boolean;
  level: 1 | 2;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 cursor-pointer transition-colors ${
        level === 1
          ? 'bg-muted/70 hover:bg-muted px-3 py-2.5'
          : 'bg-muted/30 hover:bg-muted/50 px-3 py-2 pl-5'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0">
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span
          className={`truncate ${
            level === 1
              ? 'text-sm font-bold uppercase tracking-wide text-foreground'
              : 'text-sm font-semibold text-foreground'
          }`}
        >
          {label}
        </span>
        {orderCount !== undefined && (
          <Badge variant="outline" className="text-xs shrink-0">
            {orderCount} order{orderCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
        {kind === 'roastgroup' && wipKg != null && (
          <span className="font-medium">
            {wipKg.toFixed(1)} kg WIP
            {planned && planned.count > 0 && (
              <> · {planned.count} planned (~{planned.planned_kg.toFixed(1)} kg)</>
            )}
          </span>
        )}
        <span>
          <span className="font-medium text-foreground">{totalUnits}</span> units
        </span>
      </div>
    </div>
  );
}

export function PackGroupedView(props: PackGroupedViewProps) {
  const { tree, expandedKeys, onToggle } = props;

  return (
    <div className="space-y-2">
      {tree.map((l1) => {
        const l1Collapsed = !expandedKeys.has(l1.key);
        return (
          <div key={l1.key} className="rounded-md border overflow-hidden">
            <GroupHeader
              label={l1.label}
              kind={l1.kind}
              totalUnits={l1.totalUnits}
              orderCount={l1.orderCount}
              wipKg={l1.wipKg}
              planned={l1.planned}
              collapsed={l1Collapsed}
              level={1}
              onClick={() => onToggle(l1.key)}
            />
            {!l1Collapsed &&
              l1.children.map((l2) => {
                const l2Collapsed = !expandedKeys.has(l2.key);
                return (
                  <div key={l2.key} className="border-t">
                    <GroupHeader
                      label={l2.label}
                      kind={l2.kind}
                      totalUnits={l2.totalUnits}
                      orderCount={l2.orderCount}
                      wipKg={l2.wipKg}
                      planned={l2.planned}
                      collapsed={l2Collapsed}
                      level={2}
                      onClick={() => onToggle(l2.key)}
                    />
                    {!l2Collapsed && (
                      <div>
                        {l2.leaves.map((leaf) => (
                          <LeafRow key={leaf.key} leaf={leaf} props={props} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
