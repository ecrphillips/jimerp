import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  useProductOptions,
  useProductPricing,
  useSaveProductPricing,
  type ProductPricingInput,
} from '@/hooks/useProductPricing';
import type { PricingAssumptions } from '@/lib/pricingAssumptions';
import { deriveLoadedLabourRate, findPackSpeedBand } from '@/lib/pricingAssumptions';
import type { PackSpeedBand } from '@/lib/pricingAssumptions';
import type { PricingLineResult } from '@/lib/pricingEngine';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineLabel: string;
  result: PricingLineResult | undefined;
  assumptions: PricingAssumptions;
  bands: PackSpeedBand[];
  benchmarkPerKg: number | null;
  gramsPerUnit: number | null;
  packagingMaterialPerUnit: number | null;
}

export function SaveToProductDialog({
  open,
  onOpenChange,
  lineLabel,
  result,
  assumptions,
  bands,
  benchmarkPerKg,
  gramsPerUnit,
  packagingMaterialPerUnit,
}: Props) {
  const { data: products = [] } = useProductOptions();
  const { data: existing = {} } = useProductPricing();
  const save = useSaveProductPricing();

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            p.product_name.toLowerCase().includes(q) ||
            (p.client_name ?? '').toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, 40);
  }, [products, query]);

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const priorPricing = selectedId ? existing[selectedId] : undefined;

  /**
   * A product whose bag size differs from the line's finished weight would be
   * priced on a weight it is not sold in. Surfaced rather than blocked — there
   * are legitimate reasons to differ — but it should never pass unnoticed.
   */
  const weightMismatch =
    selected != null &&
    gramsPerUnit != null &&
    Math.abs(selected.bag_size_g - gramsPerUnit) > 0.5;

  const canSave =
    selectedId != null && result != null && result.pricePerUnit != null && !save.isPending;

  const onSave = () => {
    if (!selectedId || !result) return;

    const loaded = deriveLoadedLabourRate(assumptions);
    const band = gramsPerUnit != null ? findPackSpeedBand(bands, gramsPerUnit) : null;

    const input: ProductPricingInput = {
      product_id: selectedId,
      tier: result.tier.key,
      included_lines: result.config,
      green_basis: result.greenBasis,
      green_benchmark_per_kg: benchmarkPerKg,
      green_market_per_kg: result.greenMarketValuePerKg,
      green_used_per_kg: result.lines.find((l) => l.key === 'green')?.rate ?? null,
      grams_per_unit: gramsPerUnit,
      packaging_material_per_unit: packagingMaterialPerUnit,
      services_per_unit: result.lines.find((l) => l.key === 'downstreamServices')?.rate ?? null,
      assumed_roast_throughput_green_kg_per_hr: assumptions.roast_throughput_green_kg_per_hr,
      assumed_machine_running_cost_per_hr: assumptions.machine_running_cost_per_hr,
      assumed_loaded_labour_rate_per_hr: loaded?.value ?? null,
      assumed_yield_loss_pct: assumptions.standard_yield_loss_pct,
      assumed_pack_units_per_hour: band?.units_per_hour ?? null,
      margin_per_green_kg: result.marginPerGreenKg,
      green_kg_per_unit: result.greenKgPerUnit,
      cost_floor_per_unit: result.costFloorPerUnit,
      price_per_unit: result.pricePerUnit,
      notes: null,
    };

    save.mutate(input, {
      onSuccess: () => {
        toast.success(`Priced ${selected?.product_name}`);
        onOpenChange(false);
        setSelectedId(null);
        setQuery('');
      },
      onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save “{lineLabel}” to a product</DialogTitle>
          <DialogDescription>
            Stores the whole build, not just the price — the rates in force now are snapshotted, so
            you can find products priced on a superseded rate later.
          </DialogDescription>
        </DialogHeader>

        {result?.pricePerUnit == null ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This line has no price yet
              {result?.incomplete.length ? `: ${result.incomplete.join(', ')} not set.` : '.'} Fill
              the missing inputs before saving it to a product.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div>
              <Label htmlFor="product-search">Product</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="product-search"
                  className="pl-8"
                  placeholder="Search by product or client…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {matches.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No matching products.</p>
              ) : (
                matches.map((p) => {
                  const prior = existing[p.id];
                  const isSelected = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`flex w-full items-center justify-between gap-3 p-2.5 text-left text-sm hover:bg-muted ${
                        isSelected ? 'bg-muted' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.product_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.client_name ?? 'No client'} · {p.bag_size_g}g
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {prior ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            ${Number(prior.price_per_unit ?? 0).toFixed(2)}
                            <span className="block">
                              {format(new Date(prior.updated_at), 'MMM d, yyyy')}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not priced</span>
                        )}
                        {isSelected && <Check className="ml-auto mt-1 h-4 w-4 text-emerald-600" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {weightMismatch && selected && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This line is priced on {gramsPerUnit}g but {selected.product_name} is a{' '}
                  {selected.bag_size_g}g product. Save anyway only if that is intentional.
                </AlertDescription>
              </Alert>
            )}

            {priorPricing && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {selected?.product_name} was already priced at $
                  {Number(priorPricing.price_per_unit ?? 0).toFixed(2)} on{' '}
                  {format(new Date(priorPricing.updated_at), 'MMM d, yyyy')}. Saving replaces it.
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost floor</span>
                <span>${result.costFloorPerUnit?.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin</span>
                <span>${result.marginPerUnit?.toFixed(4)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Price</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  ${result.pricePerUnit.toFixed(2)}
                </span>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            {save.isPending ? 'Saving…' : 'Save pricing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SaveToProductDialog;
