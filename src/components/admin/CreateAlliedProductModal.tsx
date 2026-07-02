import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type AlliedType = 'MERCH' | 'EQUIPMENT' | 'INSTANT' | 'OTHER';

const ALLIED_TYPES: { value: AlliedType; label: string }[] = [
  { value: 'MERCH', label: 'Merch' },
  { value: 'EQUIPMENT', label: 'Equipment' },
  { value: 'INSTANT', label: 'Instant' },
  { value: 'OTHER', label: 'Other' },
];

// A selectable order-pull source. `accountId` is what products.account_id is set to.
type SourceOption = { key: string; label: string; accountId: string };

interface CreateAlliedProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAlliedProductModal({ open, onOpenChange }: CreateAlliedProductModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [sourceKey, setSourceKey] = useState<string>('');
  const [alliedType, setAlliedType] = useState<AlliedType | ''>('');
  const [isSaving, setIsSaving] = useState(false);

  // Order-pull sources are not a single table: Shopify stores (e.g. No Smoke) live in
  // shopify_sources with a linked_account_id; Funk is a plain account (CSV import).
  // Both resolve to an account_id, which is how products attach to a source.
  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['allied-source-options'],
    enabled: open,
    queryFn: async (): Promise<SourceOption[]> => {
      const opts: SourceOption[] = [];

      const { data: shopifySources, error: shopifyErr } = await supabase
        .from('shopify_sources')
        .select('id, store_name, linked_account_id, is_active')
        .eq('is_active', true);
      if (shopifyErr) throw shopifyErr;
      for (const s of shopifySources ?? []) {
        if (!s.linked_account_id) continue;
        opts.push({
          key: `shopify:${s.id}`,
          label: s.store_name,
          accountId: s.linked_account_id,
        });
      }

      // Funk: CSV-import source, represented as an account matched by name.
      const { data: funkAccounts, error: funkErr } = await supabase
        .from('accounts')
        .select('id, account_name')
        .ilike('account_name', '%funk%')
        .eq('is_active', true);
      if (funkErr) throw funkErr;
      for (const a of funkAccounts ?? []) {
        // Avoid a duplicate if a Shopify source already points at this account.
        if (opts.some((o) => o.accountId === a.id)) continue;
        opts.push({ key: `account:${a.id}`, label: a.account_name, accountId: a.id });
      }

      return opts;
    },
  });

  const selectedSource = useMemo(
    () => sources.find((s) => s.key === sourceKey) ?? null,
    [sources, sourceKey],
  );

  const reset = () => {
    setName('');
    setSourceKey('');
    setAlliedType('');
  };

  const canSubmit = name.trim().length > 0 && !!selectedSource && !!alliedType && !isSaving;

  const handleSubmit = async () => {
    if (!selectedSource || !alliedType || !name.trim()) return;
    setIsSaving(true);
    try {
      // Allied products are non-produced: roast_group is intentionally omitted (NULL)
      // and requires_production is false, which guarantees zero roast/pack demand.
      // No packaging variants and no price-list rows are created.
      const payload = {
        account_id: selectedSource.accountId,
        product_name: name.trim(),
        allied_type: alliedType,
        format: 'OTHER' as const,
        bag_size_g: 0, // placeholder; allied items are not weighed coffee
        is_active: true,
        requires_production: false,
      };

      const { error } = await supabase.from('products').insert(payload as never);
      if (error) throw error;

      toast.success(`Allied product "${name.trim()}" created`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-needing-sku'] });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create allied product');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Allied Product</DialogTitle>
          <DialogDescription>
            Non-produced items (merch, equipment, instant, other) that ship but are never roasted or
            packed as coffee. No roast group, no packaging variants.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="allied-name">Name</Label>
            <Input
              id="allied-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. No Smoke Tote Bag"
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="allied-source">Source</Label>
            <Select value={sourceKey} onValueChange={setSourceKey} disabled={isSaving || sourcesLoading}>
              <SelectTrigger id="allied-source">
                <SelectValue placeholder={sourcesLoading ? 'Loading sources…' : 'Select a source'} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!sourcesLoading && sources.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active sources found (Shopify source or Funk account).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="allied-type">Allied type</Label>
            <Select
              value={alliedType}
              onValueChange={(v) => setAlliedType(v as AlliedType)}
              disabled={isSaving}
            >
              <SelectTrigger id="allied-type">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {ALLIED_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSaving ? 'Creating…' : 'Create Allied Product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
