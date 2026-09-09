import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const sb = supabase as any;

const errMsg = (e: unknown): string => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const anyE = e as any;
    return anyE.message ?? anyE.error_description ?? JSON.stringify(anyE);
  }
  return String(e);
};

interface MappingRow {
  id: string;
  source_id: string;
  shopify_product_id: string;
  shopify_variant_id: string | null;
  shopify_product_title: string | null;
  shopify_sku: string | null;
  jim_product_id: string | null;
  do_not_produce: boolean;
  units_per_shopify_unit: number;
  last_seen_at: string | null;
  notes: string | null;
}

interface ProductOption {
  id: string;
  account_id: string;
  label: string;
}

const QK = ['shopify-mappings', 'list'];

function ProductPicker({
  products,
  value,
  onChange,
  disabled,
}: {
  products: ProductOption[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = products.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-[280px] justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.label : 'Not mapped — pick product…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products…" />
          <CommandList>
            <CommandEmpty>No active products for this store's account.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.label}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === p.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{p.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Review + fix the saved Shopify variant → JIM product mappings. Each row can be
 * remapped, have its units-per-Shopify-unit corrected, be toggled do-not-produce,
 * or deleted so the next pull re-derives it from scratch.
 */
export function ShopifyMappedProducts() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [drafts, setDrafts] = React.useState<
    Record<string, { jim_product_id: string | null; units: number; dnp: boolean }>
  >({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<MappingRow | null>(null);

  const mappingsQ = useQuery({
    queryKey: QK,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_product_mappings')
        .select(
          'id, source_id, shopify_product_id, shopify_variant_id, shopify_product_title, shopify_sku, jim_product_id, do_not_produce, units_per_shopify_unit, last_seen_at, notes',
        )
        .order('shopify_product_title', { ascending: true });
      if (error) throw error;
      return (data ?? []) as MappingRow[];
    },
  });

  const rows = mappingsQ.data ?? [];

  const sourcesQ = useQuery({
    queryKey: ['shopify-mappings', 'sources'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, linked_account_id');
      if (error) throw error;
      const map = new Map<string, { store_name: string | null; linked_account_id: string }>();
      for (const s of data ?? []) map.set(s.id, s);
      return map;
    },
  });

  const accountIds = [
    ...new Set([...(sourcesQ.data?.values() ?? [])].map((s) => s.linked_account_id)),
  ];

  const productsQ = useQuery({
    queryKey: ['shopify-mappings', 'products', accountIds.sort().join(',')],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('products')
        .select('id, account_id, product_name, sku, bag_size_g')
        .in('account_id', accountIds)
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      const byAccount = new Map<string, ProductOption[]>();
      const byId = new Map<string, ProductOption>();
      for (const p of data ?? []) {
        const size = p.bag_size_g ? ` · ${p.bag_size_g}g` : '';
        const sku = p.sku ? ` · ${p.sku}` : '';
        const opt: ProductOption = {
          id: p.id,
          account_id: p.account_id,
          label: `${p.product_name ?? '(unnamed)'}${size}${sku}`,
        };
        const arr = byAccount.get(p.account_id) ?? [];
        arr.push(opt);
        byAccount.set(p.account_id, arr);
        byId.set(p.id, opt);
      }
      return { byAccount, byId };
    },
  });

  const draftFor = (r: MappingRow) =>
    drafts[r.id] ?? {
      jim_product_id: r.jim_product_id,
      units: r.units_per_shopify_unit,
      dnp: r.do_not_produce,
    };

  const isDirty = (r: MappingRow) => {
    const d = draftFor(r);
    return (
      d.jim_product_id !== r.jim_product_id ||
      d.units !== r.units_per_shopify_unit ||
      d.dnp !== r.do_not_produce
    );
  };

  const setDraft = (r: MappingRow, patch: Partial<ReturnType<typeof draftFor>>) =>
    setDrafts((s) => ({ ...s, [r.id]: { ...draftFor(r), ...patch } }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shopify-mappings'] });

  const save = async (r: MappingRow) => {
    const d = draftFor(r);
    setBusyId(r.id);
    try {
      const { error } = await sb
        .from('shopify_product_mappings')
        .update({
          jim_product_id: d.jim_product_id,
          units_per_shopify_unit: Math.max(1, Math.trunc(d.units || 1)),
          do_not_produce: d.dnp,
          mapped_at: new Date().toISOString(),
        })
        .eq('id', r.id);
      if (error) throw error;
      toast.success('Mapping updated');
      setDrafts((s) => {
        const next = { ...s };
        delete next[r.id];
        return next;
      });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: MappingRow) => {
    setBusyId(r.id);
    try {
      const { error } = await sb.from('shopify_product_mappings').delete().eq('id', r.id);
      if (error) throw error;
      toast.success('Mapping deleted — the next pull will re-derive this variant');
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        [r.shopify_product_title, r.shopify_sku, r.shopify_variant_id, r.shopify_product_id]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : rows;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapped products</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every saved Shopify variant → JIM product mapping. Fix a wrong pick, correct units per
          Shopify unit, toggle do-not-produce, or delete a mapping so the next pull derives it
          again.
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search title, SKU or variant id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {rows.length}
          </span>
        </div>

        {mappingsQ.error && (
          <p className="text-sm text-red-600">Error: {errMsg(mappingsQ.error)}</p>
        )}
        {mappingsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!mappingsQ.isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No mappings saved yet.</p>
        )}

        <div className="space-y-2">
          {filtered.map((r) => {
            const src = sourcesQ.data?.get(r.source_id);
            const products = src
              ? (productsQ.data?.byAccount.get(src.linked_account_id) ?? [])
              : [];
            const d = draftFor(r);
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <Badge variant="secondary">{src?.store_name ?? 'Unknown store'}</Badge>
                  <span className="font-medium">{r.shopify_product_title ?? '—'}</span>
                  {r.shopify_sku && (
                    <span className="font-mono text-xs text-muted-foreground">{r.shopify_sku}</span>
                  )}
                  {r.do_not_produce && <Badge variant="outline">do not produce</Badge>}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  product {r.shopify_product_id}
                  {r.shopify_variant_id ? ` · variant ${r.shopify_variant_id}` : ''}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ProductPicker
                    products={products}
                    value={d.jim_product_id}
                    onChange={(id) => setDraft(r, { jim_product_id: id })}
                    disabled={busy}
                  />
                  <label htmlFor={`units-${r.id}`} className="text-xs text-muted-foreground">
                    Units per Shopify unit
                  </label>
                  <Input
                    id={`units-${r.id}`}
                    type="number"
                    min={1}
                    step={1}
                    className="h-9 w-20"
                    value={d.units}
                    disabled={busy}
                    onChange={(e) => {
                      const n = Math.trunc(Number(e.target.value));
                      setDraft(r, { units: Number.isFinite(n) && n >= 1 ? n : 1 });
                    }}
                  />
                  <Button
                    size="sm"
                    variant={d.dnp ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => setDraft(r, { dnp: !d.dnp })}
                  >
                    {d.dnp ? 'Do not produce: on' : 'Do not produce: off'}
                  </Button>
                  <Button size="sm" disabled={busy || !isDirty(r)} onClick={() => save(r)}>
                    <Check className="mr-1 h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => setConfirmDelete(r)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.shopify_product_title ?? 'This variant'} will no longer resolve
              automatically. The next pull re-derives it, and if it can't match it will show up as a
              stuck line to map again. Orders already created are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busyId}
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Delete mapping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
