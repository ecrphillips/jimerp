import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Network, AlertTriangle, Package, Leaf } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type LotLink = { roast_group: string; pct_of_lot: number | null };
type LotContract = {
  origin: string | null;
  origin_country: string | null;
  producer: string | null;
  variety: string | null;
};
type Lot = {
  id: string;
  lot_number: string;
  status: string;
  kg_on_hand: number;
  contract: LotContract | null;
  links: LotLink[];
};

type RGComponent = { component_roast_group: string; pct: number };
type RoastGroup = {
  roast_group: string;
  display_name: string;
  is_blend: boolean;
  blend_type: string | null;
  origin: string | null;
  components: RGComponent[];
};

type ProductAccount = { id: string; account_name: string };
type Product = {
  id: string;
  product_name: string;
  bag_size_g: number;
  roast_group: string | null;
  account_id: string | null;
  accounts: ProductAccount | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  if (status === 'EN_ROUTE')
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1.5 py-0 font-medium">
        EN ROUTE
      </Badge>
    );
  if (status === 'RECEIVED')
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0 font-medium">
        RECEIVED
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
      {status}
    </Badge>
  );
}

function bagLabel(g: number): string {
  return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProductMap() {
  const [hoveredLotId, setHoveredLotId] = useState<string | null>(null);
  const [hoveredRg, setHoveredRg] = useState<string | null>(null);
  const [alignTop, setAlignTop] = useState<number | null>(null);
  const [hoverSource, setHoverSource] = useState<'lot' | 'rg' | 'product' | null>(null);

  const lotColRef = useRef<HTMLDivElement>(null);
  const rgColRef = useRef<HTMLDivElement>(null);
  const productColRef = useRef<HTMLDivElement>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: lots, isLoading: lotsLoading } = useQuery({
    queryKey: ['product-map-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select(`
          id, lot_number, status, kg_on_hand,
          contract:green_contracts(origin, origin_country, producer, variety),
          links:green_lot_roast_group_links!green_lot_roast_group_links_lot_id_fkey(roast_group, pct_of_lot)
        `)
        .in('status', ['EN_ROUTE', 'RECEIVED'])
        .order('lot_number');
      if (error) throw error;
      return data as Lot[];
    },
  });

  const { data: roastGroups, isLoading: rgsLoading } = useQuery({
    queryKey: ['product-map-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select(`
          roast_group, display_name, is_blend, blend_type, origin,
          components:roast_group_components!roast_group_components_parent_roast_group_fkey(component_roast_group, pct)
        `)
        .eq('is_active', true)
        .order('display_name');
      if (error) throw error;
      return data as RoastGroup[];
    },
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['product-map-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, product_name, bag_size_g, roast_group, account_id,
          accounts(id, account_name)
        `)
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data as Product[];
    },
  });

  // ── Derived maps ─────────────────────────────────────────────────────────

  const { lotToRGs, rgToLots, rgToProducts, blendComponents, rgNameMap } = useMemo(() => {
    const lotToRGs = new Map<string, string[]>();
    const rgToLots = new Map<string, string[]>();
    const rgToProducts = new Map<string, Product[]>();
    const blendComponents = new Map<string, string[]>();
    const rgNameMap = new Map<string, string>();

    for (const rg of roastGroups ?? []) {
      rgNameMap.set(rg.roast_group, rg.display_name);
      if (rg.is_blend && rg.components.length > 0) {
        blendComponents.set(rg.roast_group, rg.components.map(c => c.component_roast_group));
      }
    }

    for (const lot of lots ?? []) {
      const linkedRgs = lot.links.map(l => l.roast_group);
      lotToRGs.set(lot.id, linkedRgs);
      for (const rg of linkedRgs) {
        const arr = rgToLots.get(rg) ?? [];
        arr.push(lot.id);
        rgToLots.set(rg, arr);
      }
    }

    for (const p of products ?? []) {
      if (!p.roast_group) continue;
      const arr = rgToProducts.get(p.roast_group) ?? [];
      arr.push(p);
      rgToProducts.set(p.roast_group, arr);
    }

    return { lotToRGs, rgToLots, rgToProducts, blendComponents, rgNameMap };
  }, [lots, products, roastGroups]);

  // ── Highlight sets ────────────────────────────────────────────────────────

  const { highlightedLotIds, highlightedRgs, highlightedProductIds } = useMemo(() => {
    const lotIds = new Set<string>();
    const rgs = new Set<string>();
    const productIds = new Set<string>();

    if (hoveredLotId) {
      lotIds.add(hoveredLotId);
      for (const rg of lotToRGs.get(hoveredLotId) ?? []) {
        rgs.add(rg);
        for (const p of rgToProducts.get(rg) ?? []) productIds.add(p.id);
      }
    }

    if (hoveredRg) {
      rgs.add(hoveredRg);
      for (const compRg of blendComponents.get(hoveredRg) ?? []) {
        rgs.add(compRg);
        for (const lotId of rgToLots.get(compRg) ?? []) lotIds.add(lotId);
      }
      for (const lotId of rgToLots.get(hoveredRg) ?? []) lotIds.add(lotId);
      for (const p of rgToProducts.get(hoveredRg) ?? []) productIds.add(p.id);
    }

    return { highlightedLotIds: lotIds, highlightedRgs: rgs, highlightedProductIds: productIds };
  }, [hoveredLotId, hoveredRg, lotToRGs, rgToLots, rgToProducts, blendComponents]);

  const anyHover = hoveredLotId !== null || hoveredRg !== null;

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleLotEnter(e: React.MouseEvent, lotId: string) {
    setHoveredLotId(lotId);
    setHoverSource('lot');
    setAlignTop(e.currentTarget.getBoundingClientRect().top);
  }
  function handleLotLeave() {
    setHoveredLotId(null);
    setHoverSource(null);
    setAlignTop(null);
  }

  function handleRgEnter(e: React.MouseEvent, rg: string) {
    setHoveredRg(rg);
    setHoverSource('rg');
    setAlignTop(e.currentTarget.getBoundingClientRect().top);
  }
  function handleRgLeave() {
    setHoveredRg(null);
    setHoverSource(null);
    setAlignTop(null);
  }

  function handleProductGroupEnter(e: React.MouseEvent, rg: string) {
    setHoveredRg(rg);
    setHoverSource('product');
    setAlignTop(e.currentTarget.getBoundingClientRect().top);
  }
  function handleProductGroupLeave() {
    setHoveredRg(null);
    setHoverSource(null);
    setAlignTop(null);
  }

  // ── Spacer helper ─────────────────────────────────────────────────────────

  function getSpacerHeight(colRef: React.RefObject<HTMLDivElement>): number {
    if (alignTop === null || !colRef.current) return 0;
    return Math.max(0, alignTop - colRef.current.getBoundingClientRect().top);
  }

  // ── Sort helpers ──────────────────────────────────────────────────────────

  function sortLots() {
    const connected: Lot[] = [], unconnected: Lot[] = [];
    for (const lot of lots ?? [])
      (highlightedLotIds.has(lot.id) ? connected : unconnected).push(lot);
    return { connected, unconnected };
  }

  function sortRgs() {
    const connected: RoastGroup[] = [], unconnected: RoastGroup[] = [];
    for (const rg of roastGroups ?? [])
      (highlightedRgs.has(rg.roast_group) ? connected : unconnected).push(rg);
    return { connected, unconnected };
  }

  function sortProductGroups() {
    const connected: RoastGroup[] = [], unconnected: RoastGroup[] = [];
    for (const rg of roastGroups ?? []) {
      if ((rgToProducts.get(rg.roast_group) ?? []).length === 0) continue;
      (highlightedRgs.has(rg.roast_group) ? connected : unconnected).push(rg);
    }
    return { connected, unconnected };
  }

  // ── Pre-render partitions ─────────────────────────────────────────────────

  const needsLotSort = hoverSource === 'rg' || hoverSource === 'product';
  const needsRgSort = hoverSource === 'lot' || hoverSource === 'product';
  const needsProdSort = hoverSource === 'lot' || hoverSource === 'rg';

  const { connected: connectedLots, unconnected: unconnectedLots } =
    needsLotSort ? sortLots() : { connected: [], unconnected: [] };
  const { connected: connectedRgs, unconnected: unconnectedRgs } =
    needsRgSort ? sortRgs() : { connected: [], unconnected: [] };
  const { connected: connectedProdGroups, unconnected: unconnectedProdGroups } =
    needsProdSort ? sortProductGroups() : { connected: [], unconnected: [] };

  // ── Card styles ───────────────────────────────────────────────────────────

  function cardClass(highlighted: boolean) {
    return cn(
      'transition-all duration-100 rounded-lg border p-3 cursor-default select-none',
      anyHover
        ? highlighted
          ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200 shadow-sm'
          : 'opacity-30 border-border'
        : 'border-border hover:border-muted-foreground/40 hover:shadow-sm'
    );
  }

  const isLoading = lotsLoading || rgsLoading || productsLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col">
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <Network className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Product Map</h1>
        </div>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Loading supply chain…
        </div>
      </div>
    );
  }

  // ── Lot card renderer ─────────────────────────────────────────────────────

  function LotCard({ lot }: { lot: Lot }) {
    return (
      <div
        key={lot.id}
        className={cardClass(highlightedLotIds.has(lot.id))}
        onMouseEnter={e => handleLotEnter(e, lot.id)}
        onMouseLeave={handleLotLeave}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-sm font-semibold">{lot.lot_number}</span>
          {statusBadge(lot.status)}
        </div>
        {lot.contract && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
            {[lot.contract.origin ?? lot.contract.origin_country, lot.contract.producer]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {lot.kg_on_hand.toFixed(1)} kg on hand
        </p>
        {lot.links.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
            No roast group linked
          </p>
        )}
      </div>
    );
  }

  // ── RG card renderer ──────────────────────────────────────────────────────

  function RgCard({ rg }: { rg: RoastGroup }) {
    const directLots = rgToLots.get(rg.roast_group) ?? [];
    const componentRgs = blendComponents.get(rg.roast_group) ?? [];
    const hasComponentsWithLots = componentRgs.some(c => (rgToLots.get(c) ?? []).length > 0);
    const showNoLotsWarning = directLots.length === 0 && !hasComponentsWithLots;
    const productsForRg = rgToProducts.get(rg.roast_group) ?? [];

    return (
      <div
        key={rg.roast_group}
        className={cardClass(highlightedRgs.has(rg.roast_group))}
        onMouseEnter={e => handleRgEnter(e, rg.roast_group)}
        onMouseLeave={handleRgLeave}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold">{rg.display_name}</span>
          {rg.is_blend ? (
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] px-1.5 py-0 flex-shrink-0 font-medium">
              {rg.blend_type === 'PRE_ROAST'
                ? 'PRE-ROAST BLEND'
                : rg.blend_type === 'POST_ROAST'
                ? 'POST-ROAST BLEND'
                : 'BLEND'}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-green-700 border-green-200 flex-shrink-0"
            >
              SINGLE ORIGIN
            </Badge>
          )}
        </div>

        {!rg.is_blend && rg.origin && (
          <p className="text-xs text-muted-foreground mt-0.5">{rg.origin}</p>
        )}

        {rg.is_blend && rg.components.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {rg.components.map(c => (
              <p key={c.component_roast_group} className="text-xs text-muted-foreground">
                {rgNameMap.get(c.component_roast_group) ?? c.component_roast_group}
                <span className="ml-1.5 font-medium text-foreground/70">{c.pct}%</span>
              </p>
            ))}
          </div>
        )}

        {rg.is_blend && rg.blend_type === 'POST_ROAST' && (
          <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
            Post-roast — green lots per component above
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap gap-x-3">
          {showNoLotsWarning && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              No lots linked
            </p>
          )}
          {productsForRg.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50 italic">No products</p>
          )}
        </div>
      </div>
    );
  }

  // ── Product group card renderer ───────────────────────────────────────────

  function ProductGroupCard({ rg }: { rg: RoastGroup }) {
    const productsForRg = rgToProducts.get(rg.roast_group) ?? [];
    if (productsForRg.length === 0) return null;

    const byAccount = new Map<string, { name: string; products: Product[] }>();
    for (const p of productsForRg) {
      const key = p.account_id ?? '__unknown__';
      const name = p.accounts?.account_name ?? 'Unknown Account';
      if (!byAccount.has(key)) byAccount.set(key, { name, products: [] });
      byAccount.get(key)!.products.push(p);
    }

    const rgHighlighted = highlightedRgs.has(rg.roast_group);

    return (
      <div
        key={rg.roast_group}
        className={cn(
          'rounded-lg border transition-all duration-100 cursor-default',
          anyHover
            ? rgHighlighted
              ? 'border-amber-300 ring-1 ring-amber-200'
              : 'opacity-30 border-border'
            : 'border-border hover:border-muted-foreground/40'
        )}
        onMouseEnter={e => handleProductGroupEnter(e, rg.roast_group)}
        onMouseLeave={handleProductGroupLeave}
      >
        <div className="px-3 py-2 border-b bg-muted/30 rounded-t-lg">
          <span className="text-xs font-semibold text-foreground/80">{rg.display_name}</span>
        </div>
        <div className="p-2 space-y-2">
          {Array.from(byAccount.values()).map(({ name, products: acctProducts }) => (
            <div key={name}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-0.5">
                {name}
              </p>
              {acctProducts.map(p => (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center justify-between rounded px-2 py-1 cursor-default transition-all duration-100',
                    anyHover
                      ? highlightedProductIds.has(p.id)
                        ? 'bg-amber-50'
                        : 'opacity-40'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <span className="text-xs">{p.product_name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0 font-mono">
                    {bagLabel(p.bag_size_g)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center gap-3">
        <Network className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Product Map</h1>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span>{(lots ?? []).length} active lots</span>
          <span>{(roastGroups ?? []).length} roast groups</span>
          <span>{(products ?? []).filter(p => p.roast_group).length} products</span>
        </div>
      </div>

      {/* ── Three columns ────────────────────────────────────────────────── */}
      <div className="flex divide-x flex-1">

        {/* ── Green Lots ─────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
            <Leaf className="h-3 w-3" />
            Green Lots
          </h2>

          <div ref={lotColRef}>
            {(lots ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground italic">No active lots</p>
            )}

            {!needsLotSort ? (
              <div className="space-y-2">
                {(lots ?? []).map(lot => <LotCard key={lot.id} lot={lot} />)}
              </div>
            ) : (
              <>
                <div style={{ height: getSpacerHeight(lotColRef) }} />
                <div className="space-y-2">
                  {connectedLots.map(lot => <LotCard key={lot.id} lot={lot} />)}
                </div>
                {unconnectedLots.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {unconnectedLots.map(lot => <LotCard key={lot.id} lot={lot} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Roast Groups ─────────────────────────────────────────────────── */}
        <div className="flex-1 p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
            <Network className="h-3 w-3" />
            Roast Groups
          </h2>

          <div ref={rgColRef}>
            {(roastGroups ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground italic">No active roast groups</p>
            )}

            {!needsRgSort ? (
              <div className="space-y-2">
                {(roastGroups ?? []).map(rg => <RgCard key={rg.roast_group} rg={rg} />)}
              </div>
            ) : (
              <>
                <div style={{ height: getSpacerHeight(rgColRef) }} />
                <div className="space-y-2">
                  {connectedRgs.map(rg => <RgCard key={rg.roast_group} rg={rg} />)}
                </div>
                {unconnectedRgs.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {unconnectedRgs.map(rg => <RgCard key={rg.roast_group} rg={rg} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Products ──────────────────────────────────────────────────────── */}
        <div className="w-80 flex-shrink-0 p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
            <Package className="h-3 w-3" />
            Products
          </h2>

          <div ref={productColRef}>
            {!needsProdSort ? (
              <div className="space-y-2">
                {(roastGroups ?? []).map(rg => <ProductGroupCard key={rg.roast_group} rg={rg} />)}
              </div>
            ) : (
              <>
                <div style={{ height: getSpacerHeight(productColRef) }} />
                <div className="space-y-2">
                  {connectedProdGroups.map(rg => <ProductGroupCard key={rg.roast_group} rg={rg} />)}
                </div>
                {unconnectedProdGroups.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {unconnectedProdGroups.map(rg => <ProductGroupCard key={rg.roast_group} rg={rg} />)}
                  </div>
                )}
              </>
            )}

            {(roastGroups ?? []).every(rg => (rgToProducts.get(rg.roast_group) ?? []).length === 0) && (
              <p className="text-sm text-muted-foreground italic">No products linked to active roast groups</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
