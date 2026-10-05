import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface InvoiceLineItem {
  id: string;
  quantity_units: number;
  grind_label: string | null;
  product: {
    product_name: string;
    bag_size_g: number;
    packaging_variant: PackagingVariant | null;
  } | null;
}

interface AwaitingInvoiceOrder {
  id: string;
  order_number: string;
  client: { name: string } | null;
  account: { account_name: string } | null;
  line_items: InvoiceLineItem[] | null;
}

function InvoiceOrderRow({ order, onMarkInvoiced, isUpdating }: {
  order: AwaitingInvoiceOrder;
  onMarkInvoiced: (orderId: string) => void;
  isUpdating: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const lineItems = order.line_items ?? [];
  const totalUnits = lineItems.reduce((sum, line) => sum + line.quantity_units, 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="rounded-md border bg-background">
      <div className="flex items-center gap-3 p-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={isOpen ? 'Hide order contents' : 'Show order contents'}>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="font-semibold">{order.order_number}</span>
          <span className="text-muted-foreground">•</span>
          <span className="truncate">{order.account?.account_name ?? order.client?.name ?? 'Unknown'}</span>
          <span className="text-xs text-muted-foreground">
            {lineItems.length} item{lineItems.length !== 1 ? 's' : ''} · {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
          </span>
        </CollapsibleTrigger>
        <Button size="sm" onClick={() => onMarkInvoiced(order.id)} disabled={isUpdating}>
          Mark Invoiced
        </Button>
      </div>

      <CollapsibleContent className="border-t bg-muted/20 px-4 py-3">
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-4 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Product</span>
            <span className="text-right">Quantity</span>
          </div>
          {lineItems.map((line) => (
            <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">{line.product?.product_name ?? 'Unknown product'}</span>
                <PackagingBadge variant={line.product?.packaging_variant ?? null} />
                {line.product?.bag_size_g != null && <span className="text-xs text-muted-foreground">{line.product.bag_size_g}g</span>}
                {line.grind_label && (
                  <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
                    Grind: {line.grind_label}
                  </Badge>
                )}
              </div>
              <span className="text-right font-semibold">{line.quantity_units}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function InvoicingTab() {
  const queryClient = useQueryClient();
  const { data: shippedAwaitingInvoice = [], isLoading } = useQuery({
    queryKey: ['shipped-awaiting-invoice'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          client:clients(name),
          account:accounts(account_name),
          line_items:order_line_items(
            id,
            quantity_units,
            grind_label,
            product:products(product_name, bag_size_g, packaging_variant)
          )
        `)
        .eq('status', 'SHIPPED')
        .eq('invoiced', false)
        .order('order_number', { ascending: true });

      if (error) throw error;
      return (data ?? []) as AwaitingInvoiceOrder[];
    },
  });

  const markOrderInvoicedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.from('orders').update({ invoiced: true }).eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as invoiced');
      queryClient.invalidateQueries({ queryKey: ['shipped-awaiting-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark order as invoiced');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Shipped, Awaiting Invoice
          <Badge variant="outline" className="ml-2">
            {shippedAwaitingInvoice.length} order{shippedAwaitingInvoice.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Orders that have been shipped but not yet invoiced.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading orders…</div>
        ) : shippedAwaitingInvoice.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <CheckCircle2 className="mb-3 h-9 w-9 text-success" />
            <p className="font-medium">No orders awaiting invoice</p>
            <p className="mt-1 text-sm text-muted-foreground">Everything shipped has been marked invoiced.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shippedAwaitingInvoice.map((order) => (
              <InvoiceOrderRow
                key={order.id}
                order={order}
                onMarkInvoiced={(orderId) => markOrderInvoicedMutation.mutate(orderId)}
                isUpdating={markOrderInvoicedMutation.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}