import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Ban, Check, ChevronsUpDown, PackageX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const sb = supabase as any;

// Bundle statuses that mean the order may already be on the production floor.
const PRODUCTION_STATUSES = new Set(['IN_PRODUCTION', 'READY', 'SHIPPED']);

const errMsg = (e: unknown): string => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const anyE = e as any;
    return anyE.message ?? anyE.error_description ?? JSON.stringify(anyE);
  }
  return String(e);
};

interface QuarantineLine {
  id: string;
  source_id: string;
  bundle_order_id: string | null;
  shopify_order_number: string | null;
  customer_name: string | null;
  shopify_product_title: string | null;
  shopify_variant_title: string | null;
  shopify_sku: string | null;
  quantity: number | null;
  first_seen_at: string | null;
}

interface SourceInfo {
  id: string;
  store_name: string | null;
  linked_account_id: string;
}

interface ProductOption {
  id: string;
  account_id: string;
  label: string;
}

const QK = ['shopify-quarantine', 'open'];

function useOpenQuarantine(enabled: boolean) {
  return useQuery({
    queryKey: QK,
    enabled,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_quarantined_lines')
        .select(
          'id, source_id, bundle_order_id, shopify_order_number, customer_name, shopify_product_title, shopify_variant_title, shopify_sku, quantity, first_seen_at',
        )
        .eq('status', 'open')
        .order('first_seen_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as QuarantineLine[];
    },
  });
}

/** Product picker scoped to a single client's active JIM products. */
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
          className="w-[260px] justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.label : 'Map to JIM product…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products…" />
          <CommandList>
            <CommandEmpty>No active products for this client.</CommandEmpty>
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

function ResolverBody({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const queryClient = useQueryClient();
  const linesQ = useOpenQuarantine(true);
  const lines = linesQ.data ?? [];

  React.useEffect(() => {
    if (linesQ.isSuccess) onCountChange?.(lines.length);
  }, [linesQ.isSuccess, lines.length, onCountChange]);

  const sourceIds = [...new Set(lines.map((l) => l.source_id))];
  const bundleIds = [...new Set(lines.map((l) => l.bundle_order_id).filter(Boolean))] as string[];

  const sourcesQ = useQuery({
    queryKey: ['shopify-quarantine', 'sources', sourceIds.sort().join(',')],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, linked_account_id')
        .in('id', sourceIds);
      if (error) throw error;
      const map = new Map<string, SourceInfo>();
      for (const s of (data ?? []) as SourceInfo[]) map.set(s.id, s);
      return map;
    },
  });

  const accountIds = [
    ...new Set([...(sourcesQ.data?.values() ?? [])].map((s) => s.linked_account_id)),
  ];

  const productsQ = useQuery({
    queryKey: ['shopify-quarantine', 'products', accountIds.sort().join(',')],
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
      }
      return byAccount;
    },
  });

  const bundleStatusQ = useQuery({
    queryKey: ['shopify-quarantine', 'bundles', bundleIds.sort().join(',')],
    enabled: bundleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb.from('orders').select('id, status').in('id', bundleIds);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const o of data ?? []) map.set(o.id, o.status);
      return map;
    },
  });

  const [selected, setSelected] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmLine, setConfirmLine] = React.useState<QuarantineLine | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QK });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const productsForLine = (l: QuarantineLine): ProductOption[] => {
    const src = sourcesQ.data?.get(l.source_id);
    if (!src) return [];
    return productsQ.data?.get(src.linked_account_id) ?? [];
  };

  const doResolve = async (l: QuarantineLine) => {
    const productId = selected[l.id];
    if (!productId) {
      toast.error('Pick a JIM product first');
      return;
    }
    setBusyId(l.id);
    try {
      const { error } = await sb.rpc('resolve_shopify_quarantined_line', {
        p_line_id: l.id,
        p_jim_product_id: productId,
      });
      if (error) throw error;
      toast.success(`Resolved ${l.shopify_order_number ?? 'line'} into its bundle`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
      setConfirmLine(null);
    }
  };

  const onMapClick = (l: QuarantineLine) => {
    if (!selected[l.id]) {
      toast.error('Pick a JIM product first');
      return;
    }
    const status = l.bundle_order_id ? bundleStatusQ.data?.get(l.bundle_order_id) : undefined;
    if (status && PRODUCTION_STATUSES.has(status)) {
      setConfirmLine(l); // warn before folding into an in-production bundle
      return;
    }
    void doResolve(l);
  };

  const doNotProduce = async (l: QuarantineLine) => {
    setBusyId(l.id);
    try {
      const { error } = await sb.rpc('set_shopify_quarantined_line_do_not_produce', {
        p_line_id: l.id,
      });
      if (error) throw error;
      toast.success('Marked do-not-produce; variant will be skipped on future pulls');
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  if (linesQ.isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading stuck lines…</p>;
  }
  if (linesQ.error) {
    return <p className="py-8 text-center text-sm text-red-600">{errMsg(linesQ.error)}</p>;
  }
  if (lines.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No stuck lines. Everything from the latest pull matched a JIM product.
      </p>
    );
  }

  // Group by source.
  const grouped = new Map<string, QuarantineLine[]>();
  for (const l of lines) {
    const arr = grouped.get(l.source_id) ?? [];
    arr.push(l);
    grouped.set(l.source_id, arr);
  }

  return (
    <>
      <ScrollArea className="max-h-[60vh] pr-3">
        <div className="space-y-6">
          {[...grouped.entries()].map(([sourceId, group]) => {
            const src = sourcesQ.data?.get(sourceId);
            return (
              <div key={sourceId} className="space-y-2">
                <div className="text-sm font-semibold text-foreground">
                  {src?.store_name ?? 'Unknown source'}{' '}
                  <Badge variant="secondary">{group.length}</Badge>
                </div>
                <div className="space-y-2">
                  {group.map((l) => {
                    const bundleStatus = l.bundle_order_id
                      ? bundleStatusQ.data?.get(l.bundle_order_id)
                      : undefined;
                    const inProd = bundleStatus && PRODUCTION_STATUSES.has(bundleStatus);
                    return (
                      <div
                        key={l.id}
                        className="rounded-lg border border-border bg-card px-4 py-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium">{l.shopify_order_number ?? '—'}</span>
                          {l.customer_name && (
                            <span className="text-muted-foreground">· {l.customer_name}</span>
                          )}
                          <span className="font-medium">{l.shopify_product_title ?? '—'}</span>
                          {l.shopify_variant_title && (
                            <span className="text-muted-foreground">
                              {l.shopify_variant_title}
                            </span>
                          )}
                          <Badge variant="outline">×{l.quantity ?? 0}</Badge>
                          {l.shopify_sku && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {l.shopify_sku}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          First seen{' '}
                          {l.first_seen_at
                            ? formatDistanceToNow(new Date(l.first_seen_at), { addSuffix: true })
                            : '—'}
                          {inProd && (
                            <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              bundle in {bundleStatus}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <ProductPicker
                            products={productsForLine(l)}
                            value={selected[l.id] ?? null}
                            onChange={(id) =>
                              setSelected((s) => ({ ...s, [l.id]: id }))
                            }
                            disabled={busyId === l.id}
                          />
                          <Button
                            size="sm"
                            disabled={busyId === l.id || !selected[l.id]}
                            onClick={() => onMapClick(l)}
                          >
                            <Check className="mr-1 h-4 w-4" />
                            Map
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === l.id}
                            onClick={() => doNotProduce(l)}
                          >
                            <Ban className="mr-1 h-4 w-4" />
                            Do not produce
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <AlertDialog open={!!confirmLine} onOpenChange={(o) => !o && setConfirmLine(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bundle may already be in production</AlertDialogTitle>
            <AlertDialogDescription>
              The bundle order for {confirmLine?.shopify_order_number ?? 'this line'} is past
              confirmation. Adding this line will change an order that may already be on the
              production floor. Continue anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busyId}
              onClick={() => confirmLine && doResolve(confirmLine)}
            >
              Add to bundle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Dashboard tile + dialog for resolving line-level Shopify quarantine. Visible to
 * ADMIN and OPS. The tile shows the open stuck-line count; opening it lists every
 * open line grouped by source with "Map to JIM product" / "Do not produce" actions.
 */
export function ShopifyQuarantineTile() {
  const { isInternal } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState<number | null>(null);

  // Lightweight count for the tile, independent of the dialog being open.
  const countQ = useQuery({
    queryKey: ['shopify-quarantine', 'count'],
    enabled: isInternal,
    queryFn: async () => {
      const { count, error } = await sb
        .from('shopify_quarantined_lines')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open');
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (!isInternal) return null;
  const shown = count ?? countQ.data ?? 0;
  if (shown === 0 && !countQ.isLoading) return null; // nothing stuck — stay quiet

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60">
          <PackageX className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Shopify lines need mapping
            </div>
            <div className="text-xs text-muted-foreground">
              {shown} stuck line{shown === 1 ? '' : 's'} — click to resolve
            </div>
          </div>
          <Badge variant="secondary" className="ml-auto">
            {shown}
          </Badge>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Resolve stuck Shopify lines</DialogTitle>
          <DialogDescription>
            Map each unmatched variant to a JIM product (it folds into the original bundle and
            auto-resolves on future pulls) or mark it do-not-produce.
          </DialogDescription>
        </DialogHeader>
        <ResolverBody onCountChange={setCount} />
      </DialogContent>
    </Dialog>
  );
}
