import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  compareLinedUp,
  lotExpectedKg,
  lotSupplyGroup,
  SUPPLY_GROUP_ORDER,
  type LotSupplyGroup,
} from '@/lib/baskets';
import type { BasketGreenLot } from '@/hooks/useBaskets';
import { formatKg, SharedWith } from './BasketParts';

const PICKER_GROUP_LABEL: Record<LotSupplyGroup, string> = {
  IN_STORE: 'In store',
  CONTRACTED: 'Contracted — not received',
  PLANNED: 'Placeholders',
};

export interface SampleOption {
  id: string;
  name: string;
  origin: string | null;
  vendor_id: string | null;
  warehouse_location: string | null;
  num_bags: number | null;
  bag_size_kg: number | null;
  status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  basketName: string;
  /** All green lots. */
  lots: BasketGreenLot[];
  /** Lot ids already in this basket (hidden from the picker). */
  excludeLotIds: Set<string>;
  /** lot_id → names of baskets it is in (for the "shared" hint). */
  basketNamesByLot: Map<string, string[]>;
  lotLabel: (lot: BasketGreenLot) => string | null;
  onAddLots: (lotIds: string[]) => void;
  onAddFromSample: (input: { sample: SampleOption; bags: number; bagSizeKg: number }) => void;
  busy?: boolean;
}

export function AddLotsDialog({
  open, onOpenChange, basketName, lots, excludeLotIds, basketNamesByLot, lotLabel, onAddLots, onAddFromSample, busy,
}: Props) {
  const [tab, setTab] = useState<'lots' | 'sample'>('lots');
  const [search, setSearch] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sample tab state
  const [sampleSearch, setSampleSearch] = useState('');
  const [showRejected, setShowRejected] = useState(false);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [bags, setBags] = useState('');
  const [bagSize, setBagSize] = useState('');

  useEffect(() => {
    if (open) {
      setTab('lots'); setSearch(''); setSelected(new Set()); setShowEmpty(false);
      setSampleSearch(''); setSampleId(null); setBags(''); setBagSize(''); setShowRejected(false);
    }
  }, [open]);

  const { data: samples = [] } = useQuery({
    queryKey: ['basket-sample-options'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_samples')
        .select('id, name, origin, vendor_id, warehouse_location, num_bags, bag_size_kg, status')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SampleOption[];
    },
  });

  const { data: vendorNames = {} } = useQuery({
    queryKey: ['basket-sample-vendors'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_vendors').select('id, name');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map(v => [v.id, v.name])) as Record<string, string>;
    },
    staleTime: 300_000,
  });

  const placeholderBySample = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of lots) {
      if (!l.source_sample_id) continue;
      m.set(l.source_sample_id, [...(m.get(l.source_sample_id) ?? []), l.lot_number]);
    }
    return m;
  }, [lots]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const candidates = lots
      .filter(l => !excludeLotIds.has(l.id))
      .filter(l => {
        if (showEmpty) return true;
        // Hide used-up stock unless asked: exhausted, or in store with nothing left.
        if (l.status === 'EXHAUSTED') return false;
        if (lotSupplyGroup(l) === 'IN_STORE' && Number(l.kg_on_hand) <= 0) return false;
        return true;
      })
      .filter(l => {
        if (!q) return true;
        return [l.lot_number, lotLabel(l), l.lot_identifier].filter(Boolean).join(' ').toLowerCase().includes(q);
      })
      .sort(compareLinedUp);
    return SUPPLY_GROUP_ORDER
      .map(group => ({ group, items: candidates.filter(l => lotSupplyGroup(l) === group) }))
      .filter(g => g.items.length > 0);
  }, [lots, excludeLotIds, showEmpty, search, lotLabel]);

  const filteredSamples = useMemo(() => {
    const q = sampleSearch.trim().toLowerCase();
    return samples
      .filter(s => showRejected || s.status !== 'REJECTED')
      .filter(s => !q || [s.name, s.origin, s.vendor_id ? vendorNames[s.vendor_id] : null].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [samples, sampleSearch, showRejected, vendorNames]);

  const chosenSample = samples.find(s => s.id === sampleId) ?? null;

  const pickSample = (s: SampleOption) => {
    setSampleId(s.id);
    setBags(s.num_bags != null ? String(s.num_bags) : '');
    setBagSize(s.bag_size_kg != null ? String(s.bag_size_kg) : '');
  };

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add to {basketName}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'lots' | 'sample')} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="lots">Existing lots</TabsTrigger>
            <TabsTrigger value="sample">From a sample</TabsTrigger>
          </TabsList>

          <TabsContent value="lots" className="flex-1 min-h-0 flex flex-col gap-3 mt-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lots…" className="pl-8 h-9" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showEmpty} onCheckedChange={(c) => setShowEmpty(c === true)} />
                Show used-up lots
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Added lots start as lined up. Promote one to active from the basket.</p>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {grouped.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No lots to add.</p>
              ) : grouped.map(g => (
                <div key={g.group} className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{PICKER_GROUP_LABEL[g.group]} ({g.items.length})</p>
                  {g.items.map(l => {
                    const label = lotLabel(l);
                    const inBaskets = basketNamesByLot.get(l.id) ?? [];
                    const kg = g.group === 'IN_STORE' ? Number(l.kg_on_hand) || 0 : lotExpectedKg(l);
                    return (
                      <label
                        key={l.id}
                        className={cn('flex items-start gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/40', selected.has(l.id) && 'border-primary bg-primary/5')}
                      >
                        <Checkbox className="mt-0.5" checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{l.lot_number}</span>
                            <span className="text-xs text-muted-foreground">{formatKg(kg)}</span>
                            {l.status === 'EXHAUSTED' && <Badge variant="outline" className="text-[10px]">Exhausted</Badge>}
                          </div>
                          {label && <p className="text-xs text-muted-foreground truncate">{label}</p>}
                          {inBaskets.length > 0 && <SharedWith names={inBaskets} />}
                        </div>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={selected.size === 0 || busy} onClick={() => onAddLots([...selected])}>
                Add {selected.size > 0 ? selected.size : ''} lot{selected.size === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="sample" className="flex-1 min-h-0 flex flex-col gap-3 mt-3">
            <p className="text-xs text-muted-foreground">
              Creates a placeholder green lot from the sample and lines it up in this basket. The lot shows as "Planned" until it is bought and received.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={sampleSearch} onChange={(e) => setSampleSearch(e.target.value)} placeholder="Search samples…" className="pl-8 h-9" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showRejected} onCheckedChange={(c) => setShowRejected(c === true)} />
                Show rejected
              </label>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 max-h-72">
              {filteredSamples.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No samples found.</p>
              ) : filteredSamples.map(s => {
                const existing = placeholderBySample.get(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickSample(s)}
                    className={cn('w-full text-left rounded-md border p-2 hover:bg-muted/40', sampleId === s.id && 'border-primary bg-primary/5')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[s.origin, s.vendor_id ? vendorNames[s.vendor_id] : null].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {existing && <p className="text-xs text-amber-700 dark:text-amber-400">Already has placeholder lot {existing.join(', ')}</p>}
                  </button>
                );
              })}
            </div>
            {chosenSample && (
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="ph-bags" className="text-xs">Bags</Label>
                  <Input id="ph-bags" type="number" min={0} value={bags} onChange={(e) => setBags(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ph-bagsize" className="text-xs">Bag size (kg)</Label>
                  <Input id="ph-bagsize" type="number" min={0} step="0.1" value={bagSize} onChange={(e) => setBagSize(e.target.value)} className="h-8" />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">You can change these later on the lot.</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                disabled={!chosenSample || busy}
                onClick={() => chosenSample && onAddFromSample({
                  sample: chosenSample,
                  bags: Math.max(0, parseInt(bags, 10) || 0),
                  bagSizeKg: Math.max(0, parseFloat(bagSize) || 0),
                })}
              >
                Create placeholder lot
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
