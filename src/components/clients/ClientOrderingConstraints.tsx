import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Package, ShoppingBag } from 'lucide-react';

interface ClientOrderingConstraintsProps {
  clientId: string;
  clientName: string;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  is_active: boolean;
}

export function ClientOrderingConstraints({ clientId, clientName }: ClientOrderingConstraintsProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  
  // Form state
  const [caseOnly, setCaseOnly] = useState(false);
  const [caseSize, setCaseSize] = useState<string>('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);

  // Fetch client constraints
  const { data: clientData, isLoading: clientLoading } = useQuery({
    queryKey: ['client-constraints', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('case_only, case_size')
        .eq('id', clientId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch allowed products
  const { data: allowedProducts, isLoading: allowedLoading } = useQuery({
    queryKey: ['client-allowed-products-admin', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_allowed_products')
        .select('product_id')
        .eq('client_id', clientId);
      if (error) throw error;
      return data?.map(r => r.product_id) ?? [];
    },
  });

  // Fetch all products for this client
  const { data: products } = useQuery({
    queryKey: ['products-for-constraints', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, is_active')
        .eq('client_id', clientId)
        .order('product_name');
      if (error) throw error;
      return (data ?? []) as Product[];
    },
    enabled: isOpen,
  });

  // Sync state when data loads
  useEffect(() => {
    if (clientData) {
      setCaseOnly(clientData.case_only ?? false);
      setCaseSize(clientData.case_size?.toString() ?? '');
    }
  }, [clientData]);

  useEffect(() => {
    if (allowedProducts) {
      setSelectedProductIds(new Set(allowedProducts));
    }
  }, [allowedProducts]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Update client case constraints
      const { error: clientError } = await supabase
        .from('clients')
        .update({
          case_only: caseOnly,
          case_size: caseSize ? parseInt(caseSize, 10) : null,
        })
        .eq('id', clientId);
      
      if (clientError) throw clientError;

      // Update allowed products
      // First delete all existing
      const { error: deleteError } = await supabase
        .from('client_allowed_products')
        .delete()
        .eq('client_id', clientId);
      
      if (deleteError) throw deleteError;

      // Insert new selections (if any)
      if (selectedProductIds.size > 0 && products && selectedProductIds.size < products.length) {
        const inserts = Array.from(selectedProductIds).map(productId => ({
          client_id: clientId,
          product_id: productId,
        }));
        
        const { error: insertError } = await supabase
          .from('client_allowed_products')
          .insert(inserts);
        
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      toast.success('Ordering constraints updated');
      queryClient.invalidateQueries({ queryKey: ['client-constraints', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-allowed-products-admin', clientId] });
      setIsDirty(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update constraints');
    },
  });

  const handleCaseSizeChange = (value: string) => {
    const num = value.replace(/[^0-9]/g, '');
    setCaseSize(num);
    setIsDirty(true);
  };

  const toggleProduct = (productId: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
    setIsDirty(true);
  };

  const selectAll = () => {
    setSelectedProductIds(new Set(products?.map(p => p.id) ?? []));
    setIsDirty(true);
  };

  const selectNone = () => {
    setSelectedProductIds(new Set());
    setIsDirty(true);
  };

  const isRestricted = selectedProductIds.size > 0 && products && selectedProductIds.size < products.length;

  if (clientLoading || allowedLoading) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 px-2 h-8">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Package className="h-4 w-4" />
          <span className="text-sm">Ordering Constraints</span>
          {(caseOnly || isRestricted) && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {caseOnly && `Case of ${caseSize || '?'}`}
              {caseOnly && isRestricted && ' + '}
              {isRestricted && 'Restricted'}
            </Badge>
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 ml-6 space-y-4 p-4 border rounded-md bg-muted/30">
        {/* Case-only ordering */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`caseOnly-${clientId}`} className="text-sm font-medium">
                Case-only ordering
              </Label>
              <p className="text-xs text-muted-foreground">
                Require ordering in multiples of case size
              </p>
            </div>
            <Switch
              id={`caseOnly-${clientId}`}
              checked={caseOnly}
              onCheckedChange={(checked) => {
                setCaseOnly(checked);
                setIsDirty(true);
              }}
            />
          </div>
          
          {caseOnly && (
            <div className="flex items-center gap-2">
              <Label htmlFor={`caseSize-${clientId}`} className="text-sm shrink-0">
                Case size:
              </Label>
              <Input
                id={`caseSize-${clientId}`}
                type="text"
                inputMode="numeric"
                value={caseSize}
                onChange={(e) => handleCaseSizeChange(e.target.value)}
                placeholder="12"
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">units</span>
            </div>
          )}
        </div>

        {/* Allowed products */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Allowed Products
              </Label>
              <p className="text-xs text-muted-foreground">
                {isRestricted 
                  ? `Client can only order ${selectedProductIds.size} of ${products?.length} products`
                  : 'No restrictions — client can order all products'}
              </p>
            </div>
          </div>
          
          {products && products.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-2 text-xs">
                <Button variant="link" size="sm" className="h-auto p-0" onClick={selectAll}>
                  Select all
                </Button>
                <span className="text-muted-foreground">|</span>
                <Button variant="link" size="sm" className="h-auto p-0" onClick={selectNone}>
                  Clear (allow all)
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                {products.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 py-1 px-2 rounded hover:bg-accent cursor-pointer ${
                      !p.is_active ? 'opacity-50' : ''
                    }`}
                  >
                    <Checkbox
                      checked={selectedProductIds.has(p.id)}
                      onCheckedChange={() => toggleProduct(p.id)}
                    />
                    <span className="text-sm truncate">{p.product_name}</span>
                    {!p.is_active && (
                      <Badge variant="outline" className="text-xs ml-auto">
                        Inactive
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Save button */}
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={!isDirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Constraints'}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
