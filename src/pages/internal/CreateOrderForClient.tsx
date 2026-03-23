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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Minus, Trash2, ArrowLeft, ShieldAlert, AlertCircle } from 'lucide-react';
import { GramPackagingBadge, formatGramsLabel } from '@/components/GramPackagingBadge';
import { useClientOrderingConstraints } from '@/hooks/useClientOrderingConstraints';
import { WorkDeadlinePicker } from '@/components/orders/WorkDeadlinePicker';
import type { GrindOption } from '@/types/database';
import type { Database } from '@/integrations/supabase/types';
import { LocationSelect } from '@/components/orders/LocationSelect';

type DeliveryMethod = Database['public']['Enums']['delivery_method'];
import { Link } from 'react-router-dom';
interface LineItem {
  productId: string;
  productName: string;
  displayName: string;
  quantity: number;
  grind: GrindOption | null;
  grindOptions: GrindOption[];
  price: number | null;
  packagingTypeName: string | null;
  gramsPerUnit: number | null;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  grams_per_unit: number | null;
  format: string;
  grind_options: GrindOption[];
  is_perennial: boolean;
  packaging_type_id: string | null;
  packaging_types: { name: string } | null;
  client_id: string;
}

interface Client {
  id: string;
  account_name: string;
}

// Helper to build display name with packaging info
function buildDisplayName(productName: string, packagingTypeName: string | null, gramsPerUnit: number | null): string {
  if (!packagingTypeName || !gramsPerUnit) {
    return productName;
  }
  const sizeLabel = formatGramsLabel(gramsPerUnit);
  return `${productName} — ${packagingTypeName} (${sizeLabel})`;
}

// Info banner showing client constraints (for admin awareness)
function ClientConstraintsInfo({ clientId }: { clientId: string }) {
  const { constraints, hasConstraints } = useClientOrderingConstraints(clientId);
  
  if (!hasConstraints) return null;
  
  return (
    <Alert className="mb-6">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription>
        <strong>Client ordering constraints:</strong>{' '}
        {constraints.caseOnly && constraints.caseSize && (
          <span>Case-only ordering (case of {constraints.caseSize}). </span>
        )}
        {constraints.allowedProductIds && (
          <span>Restricted to {constraints.allowedProductIds.length} allowed products. </span>
        )}
        <span className="text-muted-foreground">
          Admin orders bypass these restrictions.
        </span>
      </AlertDescription>
    </Alert>
  );
}

export default function CreateOrderForClient() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [workDeadlineAt, setWorkDeadlineAt] = useState<string | null>(null);
  const [confirmOnCreate, setConfirmOnCreate] = useState(false);
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

  // Fetch products for selected client with packaging type join
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['client-products-admin', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, grams_per_unit, format, grind_options, is_perennial, packaging_type_id, packaging_types(name), client_id')
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

  // Reset line items, location, deadline, and confirm flag when client changes
  React.useEffect(() => {
    setLineItems([]);
    setSelectedLocationId('');
    setWorkDeadlineAt(null);
    setConfirmOnCreate(false);
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

  const createLineItem = (product: Product, qty: number): LineItem => {
    const grindOpts = (product.grind_options ?? []) as GrindOption[];
    const packagingTypeName = product.packaging_types?.name ?? null;
    const gramsPerUnit = product.grams_per_unit;
    
    return {
      productId: product.id,
      productName: product.product_name,
      displayName: buildDisplayName(product.product_name, packagingTypeName, gramsPerUnit),
      quantity: qty,
      grind: grindOpts.length > 0 ? grindOpts[0] : null,
      grindOptions: grindOpts,
      price: prices?.[product.id] ?? null,
      packagingTypeName,
      gramsPerUnit,
    };
  };

  const addOrIncrementProduct = (productId: string) => {
    const existing = getLineItem(productId);
    if (existing) {
      updateQuantity(productId, existing.quantity + 1);
      return;
    }

    const product = products?.find((p) => p.id === productId);
    if (!product) return;

    setLineItems([...lineItems, createLineItem(product, 1)]);
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
        setLineItems([...lineItems, createLineItem(product, qty)]);
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
      toast.error(`"${missingPrice.displayName}" has no price set.`);
      return;
    }

    setSubmitting(true);
    try {
      // Determine initial status: CONFIRMED if user checked "Confirm order", else SUBMITTED
      const initialStatus = confirmOnCreate ? 'CONFIRMED' : 'SUBMITTED';
      
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          client_id: selectedClientId,
          location_id: selectedLocationId || null,
          order_number: '',
          status: initialStatus,
          requested_ship_date: requestedShipDate || null,
          work_deadline_at: workDeadlineAt || null,
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

      // Trigger notification email (fire-and-forget for admin-created orders too)
      supabase.functions.invoke('notify-new-order', {
        body: { order_id: order.id },
      }).then(({ data, error }) => {
        if (error) {
          console.warn('[notify-new-order] Failed to send notification:', error);
        } else {
          console.log('[notify-new-order] Notification result:', data);
        }
      }).catch((err) => {
        console.warn('[notify-new-order] Notification error:', err);
      });

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

  // Render a single product SKU row
  const renderProductRow = (p: Product) => {
    const lineItem = getLineItem(p.id);
    const hasPrice = prices && p.id in prices;
    const price = prices?.[p.id];
    const packagingTypeName = p.packaging_types?.name ?? null;
    const gramsPerUnit = p.grams_per_unit;

    return (
      <li key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium truncate">{p.product_name}</span>
          <GramPackagingBadge packagingTypeName={packagingTypeName} gramsPerUnit={gramsPerUnit} />
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

  // Render product group (base product name as header, variants underneath)
  const renderProductGroup = (baseName: string, variants: Product[]) => {
    // Sort variants by grams per unit (smallest to largest)
    const sortedVariants = [...variants].sort((a, b) => {
      const gramsA = a.grams_per_unit ?? a.bag_size_g ?? 0;
      const gramsB = b.grams_per_unit ?? b.bag_size_g ?? 0;
      return gramsA - gramsB;
    });

    if (sortedVariants.length === 1) {
      return renderProductRow(sortedVariants[0]);
    }

    return (
      <div key={baseName} className="mb-3">
        <p className="text-sm font-semibold text-foreground mb-1 pl-1">{baseName}</p>
        <ul className="pl-2 border-l-2 border-muted">
          {sortedVariants.map((variant) => {
            const lineItem = getLineItem(variant.id);
            const hasPrice = prices && variant.id in prices;
            const price = prices?.[variant.id];
            const packagingTypeName = variant.packaging_types?.name ?? null;
            const gramsPerUnit = variant.grams_per_unit;

            return (
              <li key={variant.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <GramPackagingBadge packagingTypeName={packagingTypeName} gramsPerUnit={gramsPerUnit} />
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
                    onClick={() => updateQuantity(variant.id, (lineItem?.quantity ?? 0) - 1)}
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
                    onChange={(e) => handleQuantityInputChange(variant.id, e.target.value)}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => addOrIncrementProduct(variant.id)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  // Render products grouped by base name
  const renderProductsGrouped = (productsList: Product[]) => {
    const grouped: Map<string, Product[]> = new Map();
    for (const p of productsList) {
      if (!grouped.has(p.product_name)) {
        grouped.set(p.product_name, []);
      }
      grouped.get(p.product_name)!.push(p);
    }

    const sortedGroups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sortedGroups.map(([baseName, variants]) => renderProductGroup(baseName, variants));
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
        <CardContent className="space-y-4">
          {/* Quick-select buttons for common clients */}
          {(() => {
            const commonClients = clients?.filter(c => 
              ['Matchstick', 'Funk', 'No Smoke'].some(name => 
                c.name.toLowerCase().includes(name.toLowerCase())
              )
            ) ?? [];
            if (commonClients.length > 0) {
              return (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Common Clients</p>
                  <div className="flex flex-wrap gap-2">
                    {commonClients.map((c) => (
                      <Button
                        key={c.id}
                        variant={selectedClientId === c.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedClientId(c.id)}
                      >
                        {c.name}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}
          
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">All Clients</p>
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
          </div>

          {/* Location selection for clients with locations */}
          {selectedClientId && (
            <LocationSelect
              clientId={selectedClientId}
              value={selectedLocationId}
              onChange={setSelectedLocationId}
            />
          )}
        </CardContent>
      </Card>

      {selectedClientId && (
        <ClientConstraintsInfo clientId={selectedClientId} />
      )}

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
                      <div>{renderProductsGrouped(perennialProducts)}</div>
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
                      <div>{renderProductsGrouped(seasonalProducts)}</div>
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
                        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                          <span className="truncate">{li.productName}</span>
                          <GramPackagingBadge 
                            packagingTypeName={li.packagingTypeName} 
                            gramsPerUnit={li.gramsPerUnit} 
                          />
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
                  <Label>Work Deadline</Label>
                  <WorkDeadlinePicker
                    value={workDeadlineAt}
                    onChange={setWorkDeadlineAt}
                    showSaveButton={false}
                    compact
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
                
                <Separator />
                
                {/* Confirm on creation option */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="confirmOnCreate"
                      checked={confirmOnCreate}
                      onCheckedChange={(checked) => setConfirmOnCreate(checked === true)}
                    />
                    <Label htmlFor="confirmOnCreate" className="text-sm font-normal cursor-pointer">
                      Confirm order immediately
                    </Label>
                  </div>
                  {confirmOnCreate && !workDeadlineAt && (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      <span>No deadline set — order will still be confirmed</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {confirmOnCreate 
                      ? 'Order will be created as CONFIRMED and generate production demand.' 
                      : 'Order will be created as SUBMITTED (requires separate confirmation).'}
                  </p>
                </div>
                
                <Button
                  className="w-full"
                  onClick={submitOrder}
                  disabled={submitting || lineItems.length === 0}
                >
                  {submitting ? 'Creating…' : confirmOnCreate ? 'Create & Confirm Order' : 'Create Order'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
