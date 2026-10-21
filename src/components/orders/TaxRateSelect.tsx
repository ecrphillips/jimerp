import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { TAX_CODES, TAX_CODE_OPTIONS, TAX_GUIDANCE, provinceFromAddress, suggestTaxCode, type TaxCode, type TaxSuggestion } from '@/lib/salesTax';

export function TaxGuidance() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Tax guidance">
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <p className="mb-2 font-medium">Shipping to</p>
        <ul className="space-y-1 text-muted-foreground">
          {TAX_GUIDANCE.map((g) => <li key={g}>{g}</li>)}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function TaxRateSelect({ value, onChange, id, disabled }: { value: TaxCode; onChange: (v: TaxCode) => void; id?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={(v) => onChange(v as TaxCode)} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TAX_CODE_OPTIONS.map((c) => <SelectItem key={c} value={c}>{TAX_CODES[c].label}</SelectItem>)}
        </SelectContent>
      </Select>
      <TaxGuidance />
    </div>
  );
}

export function TaxSuggestionChip({ suggestion, current, onApply }: { suggestion: TaxSuggestion; current: TaxCode; onApply: (c: TaxCode) => void }) {
  const matches = current === suggestion.code;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Lightbulb className="h-3.5 w-3.5 shrink-0" />
      <span>{suggestion.message}</span>
      {!matches && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onApply(suggestion.code)}>
          Apply
        </Button>
      )}
    </div>
  );
}

/** Ship-to province suggestion for an order: shipment region → location address → account billing address. */
export function useOrderTaxSuggestion(orderId: string | undefined) {
  return useQuery({
    queryKey: ['order-tax-suggestion', orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<TaxSuggestion> => {
      const { data: order } = await supabase
        .from('orders')
        .select('location:account_locations!orders_location_id_fkey(address), account:accounts(billing_address)')
        .eq('id', orderId!)
        .maybeSingle();
      const { data: ships } = await supabase
        .from('order_shipments')
        .select('ship_to_region, ship_to_country, ship_to_address_line1, ship_to_city')
        .eq('order_id', orderId!)
        .order('shipment_number', { ascending: true })
        .limit(1);
      const s = ships?.[0];
      const o = order as { location?: { address: string | null } | null; account?: { billing_address: string | null } | null } | null;
      const province =
        provinceFromAddress(s?.ship_to_region) ??
        provinceFromAddress([s?.ship_to_address_line1, s?.ship_to_city].filter(Boolean).join(', ')) ??
        provinceFromAddress(o?.location?.address) ??
        provinceFromAddress(o?.account?.billing_address);
      return suggestTaxCode(province, s?.ship_to_country);
    },
  });
}
