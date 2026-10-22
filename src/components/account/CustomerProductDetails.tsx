import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAccountProductAccess } from '@/hooks/useAccountProductAccess';
import { useAccountProductNotes } from '@/hooks/useAccountProductNotes';
import { ProductNotes } from '@/components/client/ProductNotes';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { productAccessState } from '@/lib/customerProductAccess';
import { formatGramsLabel } from '@/components/GramPackagingBadge';

export function CustomerProductDetails({ accountId }: { accountId: string }) {
  const access = useAccountProductAccess(accountId);
  const { data: notes = [] } = useAccountProductNotes(accountId);
  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ['customer-product-details', accountId],
    queryFn: async () => {
      const { data: allowed, error: allowedError } = await supabase.from('client_allowed_products').select('product_id').eq('account_id', accountId);
      if (allowedError) throw allowedError;
      let query = supabase.from('products').select('id, product_name, roast_group, grams_per_unit, bag_size_g, case_lot_product_id, case_lot_units, is_active, packaging_types(name)').order('product_name');
      if (allowed?.length) query = query.or(`account_id.eq.${accountId},id.in.(${allowed.map(p => p.product_id).join(',')})`);
      else query = query.eq('account_id', accountId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
  const groups = useMemo(() => {
    const map = new Map<string, typeof products>();
    for (const p of products) {
      const key = `${p.product_name}|${p.roast_group ?? p.id}`;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()].map(([key, variants]) => ({ key, variants: variants.sort((a, b) => (a.grams_per_unit ?? a.bag_size_g) - (b.grams_per_unit ?? b.bag_size_g)) }));
  }, [products]);

  if (isLoading || access.isLoading) return <p className="text-muted-foreground">Loading products…</p>;
  if (error || access.error) return <p className="text-destructive">Could not load customer product settings.</p>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Customer Product Details</h2>
      <Button asChild size="sm" variant="outline"><Link to={`/products?account=${accountId}`}><ExternalLink className="mr-2 h-4 w-4" />Edit products</Link></Button>
    </div>
    {!products.length && <p className="text-muted-foreground">No products linked to this account.</p>}
    {groups.map(({ key, variants }) => {
      const first = variants[0];
      if (!first) return null;
      const groupNotes = notes.filter(n => n.roast_group === first.roast_group);
      return <section key={key} className="border-b pb-5">
        <h3 className="mb-2 font-semibold">{first.product_name}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Variant</th><th className="py-2 font-medium">Visible to customer</th><th className="py-2 font-medium">Orderable</th><th className="py-2 font-medium">Case lot only</th></tr></thead>
            <tbody>{variants.map(p => {
              const state = productAccessState(p.id, access.data ?? [], products);
              const saved = access.data?.find(s => s.product_id === p.id);
              const setting = { product_id: p.id, visible: saved?.visible ?? true, orderable: saved?.orderable ?? true, case_only: saved?.case_only ?? false };
              const linkedByAllowList = !products.length; // Eligibility is validated again when ordering.
              void linkedByAllowList;
              return <tr key={p.id} className={`border-b last:border-0 ${p.is_active ? '' : 'opacity-60'}`}>
                <td className="py-3 pr-4"><span>{formatGramsLabel(p.grams_per_unit ?? p.bag_size_g)} {p.packaging_types?.name}</span>
                  {p.case_lot_product_id && <span className="block text-xs text-muted-foreground">{p.case_lot_units} × {formatGramsLabel(products.find(c => c.id === p.case_lot_product_id)?.grams_per_unit ?? products.find(c => c.id === p.case_lot_product_id)?.bag_size_g ?? 0)}</span>}
                  {!p.is_active && <Badge variant="secondary" className="ml-2">Inactive</Badge>}
                  {state.heldForCase && <span className="block text-xs text-muted-foreground">Case only · individual units require staff confirmation</span>}
                </td>
                <td><Switch aria-label={`${p.product_name} ${p.bag_size_g}g visible to customer`} checked={state.visible} disabled={access.save.isPending} onCheckedChange={visible => access.save.mutate({ ...setting, visible, orderable: visible && setting.orderable })} /></td>
                <td><Switch aria-label={`${p.product_name} ${p.bag_size_g}g orderable`} checked={state.orderable} disabled={!state.visible || state.heldForCase || access.save.isPending} onCheckedChange={orderable => access.save.mutate({ ...setting, orderable })} /></td>
                <td>{p.case_lot_product_id ? <Switch aria-label={`${p.product_name} ${p.bag_size_g}g case lot only`} checked={state.caseOnly} disabled={access.save.isPending} onCheckedChange={case_only => access.save.mutate({ ...setting, case_only })} /> : <span className="text-muted-foreground">—</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {first.roast_group && <div className="mt-4 border-l-2 pl-4"><h4 className="mb-2 text-xs font-medium text-muted-foreground">Customer product notes</h4><ProductNotes accountId={accountId} roastGroup={first.roast_group} notes={groupNotes} /></div>}
      </section>;
    })}
  </div>;
}