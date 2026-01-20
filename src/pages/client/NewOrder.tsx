import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

export default function NewOrder() {
  const { data: products, isLoading, error } = useQuery({
    queryKey: ['client-products'],
    queryFn: async () => {
      // RLS restricts to logged-in client's active products automatically
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, format')
        .eq('is_active', true)
        .order('product_name', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New Order</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Your Products</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : products.length === 0 ? (
            <p className="text-muted-foreground">No products available.</p>
          ) : (
            <ul className="mb-4 space-y-2">
              {products.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <span className="font-medium">{p.product_name}</span>
                    {p.sku && <span className="ml-2 text-xs text-muted-foreground">({p.sku})</span>}
                  </div>
                  <span className="text-sm text-muted-foreground">{p.bag_size_g}g • {p.format}</span>
                </li>
              ))}
            </ul>
          )}
          <Button disabled>Submit Order</Button>
        </CardContent>
      </Card>
    </div>
  );
}
