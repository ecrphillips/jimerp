import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  roastGroupKey: string;
  displayName: string;
}

export function ProductsFamilyTreeSection({ roastGroupKey, displayName }: Props) {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['roast-group-products', roastGroupKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g, grind_options, is_perennial, is_active, client_id, clients(id, name)')
        .eq('roast_group', roastGroupKey)
        .order('product_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group by client
  const clientMap = new Map<string, { name: string; products: any[] }>();
  products.forEach((p: any) => {
    const clientId = p.client_id;
    const clientName = p.clients?.name || 'Unknown';
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, { name: clientName, products: [] });
    }
    clientMap.get(clientId)!.products.push(p);
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Products</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products linked to this roast group yet. Assign products from the Products page.</p>
        ) : (
          <div className="flex flex-col items-center">
            {/* Root node */}
            <div className="rounded-lg border-2 border-border bg-muted/30 px-6 py-3 text-center">
              <p className="text-sm font-semibold">{displayName}</p>
            </div>

            {/* Vertical connector */}
            <div className="w-px h-6 bg-border" />

            {/* Client branches */}
            <div className="flex flex-wrap justify-center gap-8 w-full">
              {Array.from(clientMap.entries()).map(([clientId, { name, products: prods }]) => (
                <div key={clientId} className="flex flex-col items-center min-w-[180px]">
                  {/* Vertical connector */}
                  <div className="w-px h-4 bg-border" />

                  {/* Client node */}
                  <div className="rounded-md border border-border bg-card px-4 py-2 text-center shadow-sm">
                    <p className="text-xs font-medium">{name}</p>
                  </div>

                  {/* Product nodes */}
                  {prods.map(p => (
                    <React.Fragment key={p.id}>
                      <div className="w-px h-3 bg-border" />
                      <div className={cn(
                        'rounded-md border border-border px-4 py-2 w-full text-left shadow-sm',
                        !p.is_active && 'opacity-50'
                      )}>
                        <p className="text-xs font-medium">{p.product_name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{p.bag_size_g}g</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(p.grind_options ?? []).map((g: string) => (
                            <Badge key={g} variant="secondary" className="text-[9px] px-1.5 py-0">
                              {g.replace('_', ' ')}
                            </Badge>
                          ))}
                          {p.is_perennial && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border text-muted-foreground">
                              Perennial
                            </Badge>
                          )}
                          {!p.is_active && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Inactive</Badge>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
