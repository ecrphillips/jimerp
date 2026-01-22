import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';

interface BoardProduct {
  id: string;
  source: string;
  product_id: string;
  display_order: number;
  is_active: boolean;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    client: { name: string } | null;
  } | null;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  client: { name: string } | null;
}

const SOURCES = ['MATCHSTICK', 'FUNK', 'NOSMOKE'] as const;

export default function BoardManagement() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>('MATCHSTICK');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');

  // Fetch board products for active tab
  const { data: boardProducts, isLoading } = useQuery({
    queryKey: ['board-products-admin', activeTab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('source_board_products')
        .select('id, source, product_id, display_order, is_active, product:products(id, product_name, sku, client:clients(name))')
        .eq('source', activeTab as 'MATCHSTICK' | 'FUNK')
        .order('display_order');

      if (error) throw error;
      return (data ?? []) as BoardProduct[];
    },
  });

  // Fetch all products (for adding)
  const { data: allProducts } = useQuery({
    queryKey: ['all-products-for-boards'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  // Products not already on this board
  const availableProducts = React.useMemo(() => {
    const existingIds = new Set(boardProducts?.map((bp) => bp.product_id) ?? []);
    return allProducts?.filter((p) => !existingIds.has(p.id)) ?? [];
  }, [allProducts, boardProducts]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const maxOrder = Math.max(0, ...(boardProducts?.map((bp) => bp.display_order) ?? [0]));
      const { error } = await supabase.from('source_board_products').insert({
        source: activeTab as 'MATCHSTICK' | 'FUNK',
        product_id: selectedProductId,
        display_order: maxOrder + 1,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Product added to board');
      queryClient.invalidateQueries({ queryKey: ['board-products-admin'] });
      setAddDialogOpen(false);
      setSelectedProductId('');
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to add product');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('source_board_products')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-products-admin'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update');
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ id, newOrder }: { id: string; newOrder: number }) => {
      const { error } = await supabase
        .from('source_board_products')
        .update({ display_order: newOrder })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-products-admin'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('source_board_products')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Product removed from board');
      queryClient.invalidateQueries({ queryKey: ['board-products-admin'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to remove product');
    },
  });

  const moveUp = (bp: BoardProduct, index: number) => {
    if (index === 0 || !boardProducts) return;
    const prev = boardProducts[index - 1];
    reorderMutation.mutate({ id: bp.id, newOrder: prev.display_order });
    reorderMutation.mutate({ id: prev.id, newOrder: bp.display_order });
  };

  const moveDown = (bp: BoardProduct, index: number) => {
    if (!boardProducts || index === boardProducts.length - 1) return;
    const next = boardProducts[index + 1];
    reorderMutation.mutate({ id: bp.id, newOrder: next.display_order });
    reorderMutation.mutate({ id: next.id, newOrder: bp.display_order });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Board Management</h1>
          <p className="text-sm text-muted-foreground">
            Configure which products appear on Matchstick and Funk boards
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="MATCHSTICK">Matchstick</TabsTrigger>
          <TabsTrigger value="FUNK">Funk</TabsTrigger>
          <TabsTrigger value="NOSMOKE">No Smoke</TabsTrigger>
        </TabsList>

        {SOURCES.map((source) => (
          <TabsContent key={source} value={source}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{source} Products</CardTitle>
                <Button onClick={() => setAddDialogOpen(true)} disabled={availableProducts.length === 0}>
                  Add Product
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-muted-foreground">Loading…</p>
                ) : !boardProducts || boardProducts.length === 0 ? (
                  <p className="text-muted-foreground">No products on this board yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 w-20">Order</th>
                        <th className="pb-2">Product</th>
                        <th className="pb-2">SKU</th>
                        <th className="pb-2">Client</th>
                        <th className="pb-2 text-center">Active</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {boardProducts.map((bp, index) => (
                        <tr key={bp.id} className="border-b last:border-0">
                          <td className="py-2">
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => moveUp(bp, index)}
                                disabled={index === 0}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => moveDown(bp, index)}
                                disabled={index === boardProducts.length - 1}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                          <td className="py-2 font-medium">{bp.product?.product_name ?? 'Unknown'}</td>
                          <td className="py-2">{bp.product?.sku || '—'}</td>
                          <td className="py-2">{bp.product?.client?.name ?? '—'}</td>
                          <td className="py-2 text-center">
                            <Checkbox
                              checked={bp.is_active}
                              onCheckedChange={(checked) =>
                                toggleActiveMutation.mutate({ id: bp.id, isActive: !!checked })
                              }
                            />
                          </td>
                          <td className="py-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => deleteMutation.mutate(bp.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product to {activeTab}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="product">Product</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger id="product">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {availableProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.product_name} {p.client?.name ? `(${p.client.name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !selectedProductId}
              >
                {addMutation.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
