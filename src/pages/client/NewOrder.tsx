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
import { Plus, Minus, Trash2 } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { UnusualOrderModal } from '@/components/client/UnusualOrderModal';
import type { GrindOption, DeliveryMethod } from '@/types/database';

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
}

export default function NewOrder() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('PICKUP');
  const [clientPo, setClientPo] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Unusual order modal state
  const [showUnusualModal, setShowUnusualModal] = useState(false);
  const [flaggedItems, setFlaggedItems] = useState<
    { productName: string; lastQty: number; currentQty: number; multiplier: number }[]
  >([]);
  const [totalFlag, setTotalFlag] = useState<{
    lastTotal: number;
    currentTotal: number;
    multiplier: number;
  } | null>(null);

  // Fetch products for this client (RLS filters automatically)
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['client-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, format, grind_options, is_perennial, packaging_variant')
        .eq('is_active', true)
        .order('product_name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  // Fetch current prices for all products
  const { data: prices } = useQuery({
    queryKey: ['client-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });

      if (error) throw error;

      // Build map of product_id -> latest price
      const priceMap: Record<string, number> = {};
      for (const p of data ?? []) {
        if (!priceMap[p.product_id]) {
          priceMap[p.product_id] = p.unit_price;
        }
      }
      return priceMap;
    },
  });

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

  // Check for unusual order size against last order
  const checkUnusualOrderSize = async (): Promise<boolean> => {
    if (!authUser?.clientId) return false;

    try {
      // Fetch most recent prior order (not CANCELLED or DRAFT)
      const { data: lastOrder } = await supabase
        .from('orders')
        .select('id, order_line_items(product_id, quantity_units)')
        .eq('client_id', authUser.clientId)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastOrder || !lastOrder.order_line_items) {
        // No prior order, no warning needed
        return false;
      }

      // Build map of product_id -> last quantity
      const lastQtyMap: Record<string, number> = {};
      let lastTotalUnits = 0;
      for (const li of lastOrder.order_line_items) {
        lastQtyMap[li.product_id] = (lastQtyMap[li.product_id] || 0) + li.quantity_units;
        lastTotalUnits += li.quantity_units;
      }

      // Calculate current totals
      const currentTotalUnits = lineItems.reduce((sum, li) => sum + li.quantity, 0);

      // Check per-product threshold: draft_qty >= 10 × last_qty AND draft_qty >= 10 AND last_qty > 0
      const flagged: { productName: string; lastQty: number; currentQty: number; multiplier: number }[] = [];
      for (const li of lineItems) {
        const lastQty = lastQtyMap[li.productId] || 0;
        if (lastQty > 0 && li.quantity >= 10 && li.quantity >= lastQty * 10) {
          flagged.push({
            productName: li.productName,
            lastQty,
            currentQty: li.quantity,
            multiplier: li.quantity / lastQty,
          });
        }
      }

      // Check total threshold: total draft >= 5 × last total AND total draft >= 50 AND last total > 0
      let totalFlagData: { lastTotal: number; currentTotal: number; multiplier: number } | null = null;
      if (lastTotalUnits > 0 && currentTotalUnits >= 50 && currentTotalUnits >= lastTotalUnits * 5) {
        totalFlagData = {
          lastTotal: lastTotalUnits,
          currentTotal: currentTotalUnits,
          multiplier: currentTotalUnits / lastTotalUnits,
        };
      }

      if (flagged.length > 0 || totalFlagData) {
        setFlaggedItems(flagged);
        setTotalFlag(totalFlagData);
        return true;
      }

      return false;
    } catch (err) {
      console.error('Error checking order size:', err);
      return false;
    }
  };

  const handleSubmitClick = async () => {
    if (!authUser?.clientId) {
      toast.error('No client linked to your account');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('Add at least one product');
      return;
    }

    // Check all items have prices (null means no price_list row; 0 is valid)
    const missingPrice = lineItems.find((li) => li.price === null);
    if (missingPrice) {
      toast.error(`"${missingPrice.productName}" has no price set. Ask ops to set a price.`);
      return;
    }

    // Check for unusual order size
    const isUnusual = await checkUnusualOrderSize();
    if (isUnusual) {
      setShowUnusualModal(true);
      return;
    }

    await submitOrder();
  };

  const submitOrder = async () => {
    if (!authUser?.clientId) return;

    setSubmitting(true);
    try {
      // Create order (order_number is auto-generated by DB trigger)
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          client_id: authUser.clientId,
          order_number: '', // Trigger will replace with auto-generated value
          status: 'SUBMITTED',
          requested_ship_date: requestedShipDate || null,
          delivery_method: deliveryMethod,
          client_po: clientPo || null,
          client_notes: clientNotes || null,
          created_by_user_id: authUser.id,
        })
        .select('id, order_number')
        .single();

      if (orderError) throw orderError;

      // Create line items
      const lineItemsData = lineItems.map((li) => ({
        order_id: order.id,
        product_id: li.productId,
        quantity_units: li.quantity,
        grind: li.grind,
        unit_price_locked: li.price!,
      }));

      const { error: lineError } = await supabase.from('order_line_items').insert(lineItemsData);
      if (lineError) throw lineError;

      toast.success(`Order ${order.order_number} submitted!`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate('/portal/orders');
    } catch (err) {
      console.error('Submit error:', err);
      toast.error('Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnusualConfirm = async () => {
    setShowUnusualModal(false);
    await submitOrder();
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
        <div className="flex items-center gap-2 shrink-0">
          {lineItem ? (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => updateQuantity(p.id, lineItem.quantity - 1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-sm font-medium">{lineItem.quantity}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => updateQuantity(p.id, lineItem.quantity + 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => addOrIncrementProduct(p.id)}>
              Add
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New Order</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        {/* Left: Product List */}
        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : !products || products.length === 0 ? (
              <p className="text-muted-foreground">No products available.</p>
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

        {/* Right: Order Summary (sticky) */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary ({lineItems.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {lineItems.length === 0 ? (
                <p className="text-muted-foreground text-sm">No products added yet.</p>
              ) : (
                <ul className="space-y-3">
                  {lineItems.map((li) => (
                    <li key={li.productId} className="flex items-start justify-between gap-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{li.productName}</span>
                          <PackagingBadge variant={li.packagingVariant} />
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                          <span>Qty: {li.quantity}</span>
                          {li.grindOptions.length > 0 && (
                            <Select
                              value={li.grind ?? ''}
                              onValueChange={(v) => updateGrind(li.productId, v as GrindOption)}
                            >
                              <SelectTrigger className="h-6 w-24 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {li.grindOptions.map((g) => (
                                  <SelectItem key={g} value={g}>
                                    {g}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <span>
                            {li.price !== null
                              ? `$${(li.price * li.quantity).toFixed(2)}`
                              : 'No price'}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeLine(li.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {lineItems.length > 0 && (
                <div className="mt-4 pt-4 border-t flex justify-between font-medium">
                  <span>Total</span>
                  <span>${orderTotal.toFixed(2)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order Details</CardTitle>
            </CardHeader>
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
                <Label htmlFor="po">PO Number (optional)</Label>
                <Input id="po" value={clientPo} onChange={(e) => setClientPo(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea id="notes" value={clientNotes} onChange={(e) => setClientNotes(e.target.value)} rows={2} />
              </div>
              <Button
                className="w-full"
                onClick={handleSubmitClick}
                disabled={submitting || lineItems.length === 0}
              >
                {submitting ? 'Submitting…' : 'Submit Order'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <UnusualOrderModal
        open={showUnusualModal}
        onClose={() => setShowUnusualModal(false)}
        onConfirm={handleUnusualConfirm}
        flaggedItems={flaggedItems}
        totalFlag={totalFlag}
      />
    </div>
  );
}
