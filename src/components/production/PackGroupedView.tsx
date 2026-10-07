import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Check,
  Clock,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { InlinePackingControl } from './InlinePackingControl';
import { partitionPackDrawerLines } from '@/lib/packGroupSort';

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
  return 'border-l-destructive';
}

/**
 * Aggregate WIP readiness across a drawer's leaves (incomplete, production lines only).
 * null → nothing waiting on WIP (complete or pull-from-stock).
 * 'none' only when every waiting line has no WIP; any mix reads as 'partial'.
 */
function wipStatusForLeaves(leaves: PackLeafNode[], props: PackGroupedViewProps): WipStatus | null {
  const statuses = new Set<WipStatus>();
  for (const leaf of leaves) {
    if (!leaf.requiresProduction) continue;
    if (progressForLeaf(leaf, props).complete) continue;
    statuses.add(props.wipStatusByProduct[leaf.productId] ?? 'none');
  }
  if (statuses.size === 0) return null;
  if (statuses.has('none')) return statuses.size === 1 ? 'none' : 'partial';
  return statuses.has('partial') ? 'partial' : 'full';
}

function wipBarClass(wipStatus: WipStatus | null): string {
  if (wipStatus === 'full') return 'border-l-success';
  if (wipStatus === 'partial') return 'border-l-warning';
  if (wipStatus === 'none') return 'border-l-destructive';
  return 'border-l-transparent';
}

function progressForLeaf(leaf: PackLeafNode, props: PackGroupedViewProps) {
  if (!leaf.requiresProduction) return { packed: leaf.units, needed: leaf.units, complete: true };
  const globalDemand = props.globalDemandByProduct[leaf.productId] ?? 0;
  const available = props.availableByProduct[leaf.productId] ?? 0;
  const picked = props.pickedByProduct[leaf.productId] ?? 0;
  const effectivePacked = Math.min(globalDemand, available + picked);
  const complete = globalDemand > 0 && effectivePacked >= globalDemand;
  return {
    packed: complete ? leaf.units : Math.min(leaf.units, effectivePacked),
    needed: leaf.units,
    complete,
  };
}

function progressForLeaves(leaves: PackLeafNode[], props: PackGroupedViewProps) {
  return leaves.reduce(
    (total, leaf) => {
      const progress = progressForLeaf(leaf, props);
      return {
        packed: total.packed + progress.packed,
        needed: total.needed + progress.needed,
        complete: total.complete && progress.complete,
      };
    },
    { packed: 0, needed: 0, complete: leaves.length > 0 },
  );
}

function LeafRow({
  leaf,
  props,
  compact = false,
}: {
  leaf: PackLeafNode;
  props: PackGroupedViewProps;
  compact?: boolean;
}) {
  const {
    globalDemandByProduct,
    availableByProduct,
    pickedByProduct,
    wipStatusByProduct,
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
  const isStarted = effectivePacked > 0;
  const timeSensitive = timeSensitiveByProduct[pid] ?? false;

  return (
    <div className={`border-l-4 transition-opacity ${isComplete && leaf.requiresProduction ? 'border-l-success opacity-50 focus-within:opacity-100 hover:opacity-100' : leafAccent(wipStatus, leaf.requiresProduction)}`}>
      <div
        className={`flex items-center gap-3 border-b px-3 py-3 transition-colors ${compact ? 'pl-4' : 'pl-6'} ${
          isComplete
            ? 'bg-success/15'
            : isStarted
              ? 'bg-warning/20'
              : wipStatus === 'full'
                ? 'bg-success/15'
                : wipStatus === 'partial'
                  ? 'bg-warning/20'
                  : 'bg-destructive/15'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-foreground">{leaf.productName}</span>
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
            {leaf.requiresProduction && !isComplete && wipStatus === 'none' && (
              <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                No WIP
              </Badge>
            )}
          </div>
          <GrindBadges
            grindUnits={leaf.grindUnits}
            wholeBeanUnits={leaf.wholeBeanUnits}
            grindByLabel={leaf.grindByLabel}
          />
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 text-right">
          <PackagingBadge variant={leaf.packagingVariant} bagSizeG={leaf.bagSizeG} className="bg-card/70" />
          <div className="min-w-14">
            <span className="text-lg font-black tabular-nums">{leaf.units}</span>
            <span className="block text-[10px] font-bold uppercase text-muted-foreground">units</span>
          </div>
        </div>

        <div className="min-w-24 shrink-0 flex justify-end">
          {!leaf.requiresProduction ? (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
            >
              Pull stock
            </Badge>
          ) : (
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-sm font-black tabular-nums text-foreground">
                {isComplete && <Check className="h-3.5 w-3.5 text-success" />}
                {effectivePacked}/{globalDemand}
              </div>
              <div className="text-[10px] font-bold uppercase text-muted-foreground">packed</div>
            </div>
          )}
        </div>
        {leaf.requiresProduction && (
          <div className="shrink-0">
            <InlinePackingControl
              value={available}
              onCommit={(v) =>
                onUpdatePackedUnits(pid, v, leaf.bagSizeG, leaf.roastGroupKey, available)
              }
              onEditingChange={(editing) => onEditingChange(pid, editing)}
              isComplete={isComplete}
              fillValue={Math.max(0, globalDemand - picked)}
            />
          </div>
        )}
      </div>
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
  packedUnits,
  complete,
  deemphasized,
  wipStatus,
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
  packedUnits: number;
  complete: boolean;
  deemphasized: boolean;
  /** Aggregated WIP readiness for the drawer — shown as a left bar when collapsed. */
  wipStatus: WipStatus | null;
  onClick: () => void;
}) {
  // Complete keeps its green bar; collapsed drawers show the aggregate WIP cue;
  // expanded-but-incomplete stays neutral so the row bands do the talking.
  const barClass = complete
    ? 'border-l-success'
    : collapsed
      ? wipBarClass(wipStatus)
      : 'border-l-transparent';
  return (
    <div
      className={`relative flex items-center justify-between gap-4 cursor-pointer overflow-hidden transition-all ${
        level === 1
          ? 'bg-card hover:bg-muted/40 px-4 py-4'
          : 'bg-muted/40 hover:bg-muted/60 px-4 py-3 pl-7'
      } border-l-4 ${barClass} ${
        deemphasized ? 'opacity-45 hover:opacity-75' : ''
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
              ? 'text-lg font-black uppercase text-foreground'
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
      <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
        {kind === 'roastgroup' && wipKg != null && (
          <span className="font-medium">
            {wipKg.toFixed(1)} kg WIP
            {planned && planned.count > 0 && (
              <> · {planned.count} planned (~{planned.planned_kg.toFixed(1)} kg)</>
            )}
          </span>
        )}
        <div className="min-w-20 text-right">
          <div className="text-xl font-black leading-none tabular-nums text-foreground">
            {packedUnits}<span className="mx-1 font-normal text-muted-foreground">/</span>{totalUnits}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
            {complete ? 'Complete' : 'units packed'}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountRail({
  child,
  props,
}: {
  child: PackL2Node;
  props: PackGroupedViewProps;
}) {
  const progress = progressForLeaves(child.leaves, props);

  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] border-t-2 border-border first:border-t-0">
      <div className="flex flex-col justify-between border-r-2 border-hi-navy/20 bg-muted/60 px-3 py-4">
        <div>
          <div className="text-xs font-black uppercase text-hi-navy">{child.label}</div>
          {child.orderCount !== undefined && (
            <div className="mt-1 text-[11px] font-medium text-muted-foreground">
              {child.orderCount} order{child.orderCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <div className="mt-4 text-xs font-bold tabular-nums text-foreground">
          {progress.complete ? 'Complete ' : ''}{progress.packed}/{progress.needed}
        </div>
      </div>
      <div className="min-w-0">
        {child.leaves.map((leaf) => (
          <LeafRow key={leaf.key} leaf={leaf} props={props} compact />
        ))}
      </div>
    </div>
  );
}

export function PackGroupedView(props: PackGroupedViewProps) {
  const { tree, expandedKeys, onToggle } = props;
  const [demotedKeys, setDemotedKeys] = React.useState<Set<string>>(new Set());

  const toggleGroup = React.useCallback((key: string, complete: boolean) => {
    const isClosing = expandedKeys.has(key);
    if (isClosing && complete) {
      setDemotedKeys((current) => new Set(current).add(key));
    } else if (!complete) {
      setDemotedKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
    onToggle(key);
  }, [expandedKeys, onToggle]);

  // Also demote when a completed drawer is closed by other means (e.g. Collapse all),
  // so both views follow the same rule.
  const prevExpandedRef = React.useRef<Set<string>>(expandedKeys);
  React.useEffect(() => {
    const prev = prevExpandedRef.current;
    prevExpandedRef.current = expandedKeys;
    const closed = tree.filter((l1) => prev.has(l1.key) && !expandedKeys.has(l1.key));
    if (closed.length === 0) return;
    const done = closed.filter(
      (l1) => progressForLeaves(l1.children.flatMap((c) => c.leaves), props).complete,
    );
    if (done.length === 0) return;
    setDemotedKeys((current) => {
      const next = new Set(current);
      done.forEach((l1) => next.add(l1.key));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKeys]);

  const orderedTree = React.useMemo(
    () => [...tree].sort((a, b) => {
      const ad = demotedKeys.has(a.key) && progressForLeaves(a.children.flatMap((c) => c.leaves), props).complete;
      const bd = demotedKeys.has(b.key) && progressForLeaves(b.children.flatMap((c) => c.leaves), props).complete;
      return Number(ad) - Number(bd);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, demotedKeys],
  );

  return (
    <div className="space-y-4">
      {orderedTree.map((l1) => {
        const l1Collapsed = !expandedKeys.has(l1.key);
        const l1Leaves = l1.children.flatMap((child) => child.leaves);
        const l1Progress = progressForLeaves(l1Leaves, props);
        const l1WipStatus = wipStatusForLeaves(l1Leaves, props);
        const orderedChildren = partitionPackDrawerLines<PackLeafNode, PackL2Node>(
          l1.children,
          (leaf) => leaf.requiresProduction && progressForLeaf(leaf, props).complete,
        );
        return (
          <div
            key={l1.key}
            className={`rounded-md border-2 bg-card overflow-hidden shadow-sm transition-opacity ${
              l1Collapsed && demotedKeys.has(l1.key) && l1Progress.complete ? 'opacity-50' : ''
            }`}
          >
            <GroupHeader
              label={l1.label}
              kind={l1.kind}
              totalUnits={l1.totalUnits}
              orderCount={l1.orderCount}
              wipKg={l1.wipKg}
              planned={l1.planned}
              collapsed={l1Collapsed}
              level={1}
              packedUnits={l1Progress.packed}
              complete={l1Progress.complete}
              deemphasized={l1Collapsed && demotedKeys.has(l1.key) && l1Progress.complete}
              wipStatus={l1WipStatus}
              onClick={() => toggleGroup(l1.key, l1Progress.complete)}
            />
            {!l1Collapsed && (
              <div className="ml-5 border-l-4 border-b-4 border-hi-navy/20">
                {orderedChildren.map((child) => (
                  <AccountRail key={child.key} child={child} props={props} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
