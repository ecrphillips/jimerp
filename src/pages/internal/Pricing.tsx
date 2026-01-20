import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Product {
  id: string;
  product_name: string;
  client: { name: string } | null;
}

interface PriceEntry {
  id: string;
  product_id: string;
  unit_price: number;
  currency: string;
  effective_date: string;
  created_at: string;
}

export default function Pricing() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: products } = useQuery({
    queryKey: ['products-for-pricing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const { data: prices, isLoading } = useQuery({
    queryKey: ['all-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('id, product_id, unit_price, currency, effective_date, created_at')
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return (data ?? []) as PriceEntry[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('price_list').insert({
        product_id: selectedProductId!,
        unit_price: parseFloat(newPrice),
        effective_date: effectiveDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Price added');
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      setDialogOpen(false);
      setNewPrice('');
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to add price');
    },
  });

  // Group prices by product with latest first
  const pricesByProduct = React.useMemo(() => {
    const map: Record<string, PriceEntry[]> = {};
    for (const p of prices ?? []) {
      if (!map[p.product_id]) map[p.product_id] = [];
      map[p.product_id].push(p);
    }
    return map;
  }, [prices]);

  // Get current price for each product (most recent by effective_date)
  const currentPrices = React.useMemo(() => {
    const map: Record<string, PriceEntry> = {};
    for (const [productId, entries] of Object.entries(pricesByProduct)) {
      if (entries.length > 0) {
        map[productId] = entries[0]; // Already sorted desc by effective_date
      }
    }
    return map;
  }, [pricesByProduct]);

  const openAddPrice = (productId: string) => {
    setSelectedProductId(productId);
    setNewPrice(currentPrices[productId]?.unit_price?.toString() ?? '');
    setEffectiveDate(format(new Date(), 'yyyy-MM-dd'));
    setDialogOpen(true);
  };

  const selectedProduct = products?.find((p) => p.id === selectedProductId);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Pricing</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Current Prices</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !products || products.length === 0 ? (
            <p className="text-muted-foreground">No active products.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">Current Price</th>
                  <th className="pb-2">Effective Date</th>
                  <th className="pb-2">History</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const current = currentPrices[p.id];
                  const history = pricesByProduct[p.id] ?? [];
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{p.product_name}</td>
                      <td className="py-2">{p.client?.name ?? '—'}</td>
                      <td className="py-2">
                        {current ? `$${current.unit_price.toFixed(2)}` : <span className="text-destructive">No price</span>}
                      </td>
                      <td className="py-2">
                        {current ? format(new Date(current.effective_date), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {history.length} {history.length === 1 ? 'entry' : 'entries'}
                      </td>
                      <td className="py-2">
                        <Button size="sm" variant="outline" onClick={() => openAddPrice(p.id)}>
                          Set Price
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>Price History</CardTitle></CardHeader>
        <CardContent>
          {!prices || prices.length === 0 ? (
            <p className="text-muted-foreground">No price history.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Effective Date</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {prices.slice(0, 50).map((entry) => {
                  const product = products?.find((p) => p.id === entry.product_id);
                  return (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2">{product?.product_name ?? 'Unknown'}</td>
                      <td className="py-2">${entry.unit_price.toFixed(2)} {entry.currency}</td>
                      <td className="py-2">{format(new Date(entry.effective_date), 'MMM d, yyyy')}</td>
                      <td className="py-2 text-muted-foreground">{format(new Date(entry.created_at), 'MMM d, yyyy h:mm a')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Price for {selectedProduct?.product_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="price">Unit Price (CAD)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="effectiveDate">Effective Date</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !newPrice || parseFloat(newPrice) <= 0}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
