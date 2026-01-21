import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Minus, Trash2, ArrowLeft } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import type { GrindOption } from '@/types/database';
import type { Database } from '@/integrations/supabase/types';

type DeliveryMethod = Database['public']['Enums']['delivery_method'];
import { Link } from 'react-router-dom';

interface LineItem {
  productId: string;
  productName: string;
  quantity: number;
  grind: GrindOption | null;
  grindOptions: GrindOption[];
  price: number | null;
  packagingVariant: PackagingVariant | null;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  format: string;
  grind_options: GrindOption[];
  is_perennial: boolean;
  packaging_variant: PackagingVariant | null;
  client_id: string;
}

interface Client {
  id: string;
  name: string;
}

export default function CreateOrderForClient() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('PICKUP');
  const [clientPo, setClientPo] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch all clients
  const { data: clients } = useQuery({
    queryKey: ['all-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });

  // Fetch products for selected client
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['client-products-admin', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, format, grind_options, is_perennial, packaging_variant, client_id')
        .eq('client_id', selectedClientId)
        .eq('is_active', true)
        .order('product_name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Product[];
    },
    enabled: !!selectedClientId,
  });

  // Fetch current prices for products
  const { data: prices } = useQuery({
    queryKey: ['client-prices-admin', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return {};
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });

      if (error) throw error;

      const priceMap: Record<string, number> = {};
      for (const p of data ?? []) {
        if (!priceMap[p.product_id]) {
          priceMap[p.product_id] = p.unit_price;
        }
      }
      return priceMap;
    },
    enabled: !!selectedClientId,
  });

  // Reset line items when client changes
  React.useEffect(() => {
    setLineItems([]);
  }, [selectedClientId]);

  // Group products by perennial status
  const { perennialProducts, seasonalProducts } = useMemo(() => {
    const perennial: Product[] = [];
    const seasonal: Product[] = [];
    for (const p of products ?? []) {
      if (p.is_perennial) {
        perennial.push(p);
      } else {
        seasonal.push(p);
      }
    }
    return { perennialProducts: perennial, seasonalProducts: seasonal };
  }, [products]);

  const getLineItem = (productId: string) => lineItems.find((li) => li.productId === productId);

  const addOrIncrementProduct = (productId: string) => {
    const existing = getLineItem(productId);
    if (existing) {
      updateQuantity(productId, existing.quantity + 1);
      return;
    }

    const product = products?.find((p) => p.id === productId);
    if (!product) return;

    const grindOpts = (product.grind_options ?? []) as GrindOption[];
    setLineItems([
      ...lineItems,
      {
        productId: product.id,
        productName: product.product_name,
        quantity: 1,
        grind: grindOpts.length > 0 ? grindOpts[0] : null,
        grindOptions: grindOpts,
        price: prices?.[product.id] ?? null,
        packagingVariant: product.packaging_variant,
      },
    ]);
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeLine(productId);
      return;
    }
    setLineItems((prev) =>
      prev.map((li) => (li.productId === productId ? { ...li, quantity: qty } : li))
    );
  };

  const updateGrind = (productId: string, grind: GrindOption) => {
    setLineItems((prev) =>
      prev.map((li) => (li.productId === productId ? { ...li, grind } : li))
    );
  };

  const removeLine = (productId: string) => {
    setLineItems((prev) => prev.filter((li) => li.productId !== productId));
  };

  const orderTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + (li.price ?? 0) * li.quantity, 0);
  }, [lineItems]);

  const handleQuantityInputChange = (productId: string, value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    const qty = numericValue === '' ? 0 : parseInt(numericValue, 10);

    if (qty <= 0) {
      removeLine(productId);
    } else {
      const existing = getLineItem(productId);
      if (!existing) {
        const product = products?.find((p) => p.id === productId);
        if (!product) return;
        const grindOpts = (product.grind_options ?? []) as GrindOption[];
        setLineItems([
          ...lineItems,
          {
            productId: product.id,
            productName: product.product_name,
            quantity: qty,
            grind: grindOpts.length > 0 ? grindOpts[0] : null,
            grindOptions: grindOpts,
            price: prices?.[product.id] ?? null,
            packagingVariant: product.packaging_variant,
          },
        ]);
      } else {
        updateQuantity(productId, qty);
      }
    }
  };

  const submitOrder = async () => {
    if (!selectedClientId) {
      toast.error('Select a client');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('Add at least one product');
      return;
    }

    const missingPrice = lineItems.find((li) => li.price === null);
    if (missingPrice) {
      toast.error(`"${missingPrice.productName}" has no price set.`);
      return;
    }

    setSubmitting(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          client_id: selectedClientId,
          order_number: '',
          status: 'SUBMITTED',
          requested_ship_date: requestedShipDate || null,
          delivery_method: deliveryMethod,
          client_po: clientPo || null,
          client_notes: clientNotes || null,
          internal_ops_notes: internalNotes || null,
          created_by_user_id: authUser?.id,
          created_by_admin: true,
        })
        .select('id, order_number')
        .single();

      if (orderError) throw orderError;
      if (!order) {
        throw new Error('Order insert returned null — possible RLS policy or trigger issue');
      }

      const lineItemsData = lineItems.map((li) => ({
        order_id: order.id,
        product_id: li.productId,
        quantity_units: li.quantity,
        grind: li.grind,
        unit_price_locked: li.price!,
      }));

      const { error: lineError } = await supabase.from('order_line_items').insert(lineItemsData);
      if (lineError) throw lineError;

      toast.success(`Order ${order.order_number} created!`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate('/orders');
    } catch (err: unknown) {
      console.error('Submit error (full object):', err);
      const supaError = err as { code?: string; message?: string; details?: string };
      const errorMsg = supaError?.message || 'Unknown error';
      const errorCode = supaError?.code || '';
      toast.error(`Failed to create order: ${errorCode ? `[${errorCode}] ` : ''}${errorMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderProductRow = (p: Product) => {
    const lineItem = getLineItem(p.id);
    const hasPrice = prices && p.id in prices;
    const price = prices?.[p.id];

    return (
      <li key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium truncate">{p.product_name}</span>
          <PackagingBadge variant={p.packaging_variant} />
          {hasPrice ? (
            <span className="text-sm text-muted-foreground">${price!.toFixed(2)}</span>
          ) : (
            <span className="text-xs text-destructive">No price</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => updateQuantity(p.id, (lineItem?.quantity ?? 0) - 1)}
            disabled={!lineItem}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            className="w-14 h-7 text-center text-sm px-1"
            value={lineItem?.quantity ?? ''}
            placeholder="0"
            onChange={(e) => handleQuantityInputChange(p.id, e.target.value)}
          />
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => addOrIncrementProduct(p.id)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header flex items-center gap-4">
        <Link to="/orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="page-title">Create Order for Client</h1>
      </div>

      {/* Client Selection */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Select Client</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Choose a client..." />
            </SelectTrigger>
            <SelectContent>
              {clients?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedClientId && (
        <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
          {/* Left: Product List */}
          <Card>
            <CardHeader><CardTitle>Products</CardTitle></CardHeader>
            <CardContent>
              {productsLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : !products || products.length === 0 ? (
                <p className="text-muted-foreground">No products available for this client.</p>
              ) : (
                <div className="space-y-4">
                  {perennialProducts.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Perennial
                      </p>
                      <ul>{perennialProducts.map(renderProductRow)}</ul>
                    </div>
                  )}
                  {perennialProducts.length > 0 && seasonalProducts.length > 0 && (
                    <Separator />
                  )}
                  {seasonalProducts.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Seasonal
                      </p>
                      <ul>{seasonalProducts.map(renderProductRow)}</ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Order Summary */}
          <div className="lg:sticky lg:top-4 space-y-4 self-start">
            <Card>
              <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
              <CardContent>
                {lineItems.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No items added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {lineItems.map((li) => (
                      <li key={li.productId} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="truncate">{li.productName}</span>
                          <PackagingBadge variant={li.packagingVariant} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {li.grindOptions.length > 0 && (
                            <Select value={li.grind ?? ''} onValueChange={(v) => updateGrind(li.productId, v as GrindOption)}>
                              <SelectTrigger className="h-7 w-24 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {li.grindOptions.map((g) => (
                                  <SelectItem key={g} value={g}>{g}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <span className="w-8 text-center">{li.quantity}</span>
                          <span className="w-16 text-right">${((li.price ?? 0) * li.quantity).toFixed(2)}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => removeLine(li.productId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Separator className="my-3" />
                <div className="flex justify-between font-medium">
                  <span>Total:</span>
                  <span>${orderTotal.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Order Details</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="shipDate">Requested Ship Date</Label>
                  <Input
                    id="shipDate"
                    type="date"
                    value={requestedShipDate}
                    onChange={(e) => setRequestedShipDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="delivery">Delivery Method</Label>
                  <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as DeliveryMethod)}>
                    <SelectTrigger id="delivery">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PICKUP">Pickup</SelectItem>
                      <SelectItem value="DELIVERY">Delivery</SelectItem>
                      <SelectItem value="COURIER">Courier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="clientPo">Client PO (optional)</Label>
                  <Input
                    id="clientPo"
                    value={clientPo}
                    onChange={(e) => setClientPo(e.target.value)}
                    placeholder="Purchase order number"
                  />
                </div>
                <div>
                  <Label htmlFor="clientNotes">Client Notes (optional)</Label>
                  <Textarea
                    id="clientNotes"
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <div>
                  <Label htmlFor="internalNotes">Internal Ops Notes (optional)</Label>
                  <Textarea
                    id="internalNotes"
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={2}
                    placeholder="Notes visible only to Admin/Ops"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={submitOrder}
                  disabled={submitting || lineItems.length === 0}
                >
                  {submitting ? 'Creating…' : 'Create Order'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}