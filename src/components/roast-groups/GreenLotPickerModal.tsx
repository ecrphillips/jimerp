import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getCountryName } from '@/lib/coffeeOrigins';
import { Loader2 } from 'lucide-react';

type Mode =
  | { kind: 'LINK'; roastGroupKey: string; alreadyLinkedLotIds: Set<string> }
  | {
      kind: 'SUCCESSOR';
      linkId: string;
      currentLotId: string;
      currentLotNumber: string;
      currentContractId: string | null;
      currentOriginCountry: string | null;
      currentOriginText: string | null;
      currentSuccessorLotId: string | null;
      excludeLotIds: Set<string>;
      roastGroupKey: string;
    };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roastGroupDisplayName: string;
  mode: Mode;
}

type Category = 'BLENDER' | 'MICRO_LOT' | 'HYPER_PREMIUM';

interface CandidateLot {
  id: string;
  lot_number: string;
  status: string;
  kg_on_hand: number;
  received_date: string | null;
  expected_delivery_date: string | null;
  costing_status: string | null;
  contract_id: string | null;
  purchase_id: string | null;
  release_id: string | null;
  lot_identifier: string | null;
  notes_internal: string | null;
  origin: string;
  origin_country: string | null;
  contract_origin: string | null;
  producer: string | null;
  variety: string | null;
  category: Category | null;
  vendor_label: string | null;
  pl_lot_identifier: string | null;
  contract_name: string | null;
  internal_contract_number: string | null;
  vendor_contract_number: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  BLENDER: 'Blender',
  MICRO_LOT: 'Micro Lot',
  HYPER_PREMIUM: 'Hyper Premium',
};

function normalizeCategory(c: string | null | undefined): Category | null {
  if (!c) return null;
  if (c === 'SINGLE_ORIGIN') return 'BLENDER';
  if (c === 'BLENDER' || c === 'MICRO_LOT' || c === 'HYPER_PREMIUM') return c;
  return null;
}

interface SelState {
  selected: boolean;
  pct: string;
}

export function GreenLotPickerModal({
  open,
  onOpenChange,
  roastGroupDisplayName,
  mode,
}: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | Category>('ALL');
  // LINK mode
  const [selection, setSelection] = useState<Record<string, SelState>>({});
  // SUCCESSOR mode
  const [successorChoice, setSuccessorChoice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setCategoryFilter('ALL');
      setSelection({});
      setSuccessorChoice(null);
    } else if (mode.kind === 'SUCCESSOR') {
      setSuccessorChoice(mode.currentSuccessorLotId ?? null);
    }
  }, [open, mode]);

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['green-lots-picker', mode.kind, mode.kind === 'LINK' ? mode.roastGroupKey : mode.linkId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select(`
          id, lot_number, status, kg_on_hand, received_date, expected_delivery_date,
          costing_status, contract_id, purchase_id, release_id, lot_identifier, notes_internal,
          green_contracts ( name, origin, origin_country, internal_contract_number, vendor_contract_number ),
          green_purchases ( vendor_id, green_vendors ( abbreviation ) ),
          green_releases ( vendor_id, green_vendors ( abbreviation ) )
        `)
        .neq('status', 'EXHAUSTED')
        .order('lot_number');
      if (error) throw error;

      const lotIds = (data ?? []).map((l: any) => l.id);
      const plByLot: Record<string, any> = {};
      if (lotIds.length > 0) {
        const { data: pls, error: plErr } = await supabase
          .from('green_purchase_lines')
          .select('lot_id, producer, variety, origin_country, category, crop_year, region, lot_identifier')
          .in('lot_id', lotIds);
        if (plErr) throw plErr;
        (pls ?? []).forEach((pl: any) => { if (pl.lot_id) plByLot[pl.lot_id] = pl; });
      }

      return (data ?? []).map((row: any): CandidateLot => {
        const pl = plByLot[row.id];
        const originCode = pl?.origin_country || row.green_contracts?.origin_country || null;
        const origin = originCode ? (getCountryName(originCode) || originCode) : (row.green_contracts?.origin || '');
        const vendor =
          row.green_purchases?.green_vendors?.abbreviation ||
          row.green_releases?.green_vendors?.abbreviation ||
          null;
        return {
          id: row.id,
          lot_number: row.lot_number,
          status: row.status,
          kg_on_hand: Number(row.kg_on_hand) || 0,
          received_date: row.received_date,
          expected_delivery_date: row.expected_delivery_date,
          costing_status: row.costing_status,
          contract_id: row.contract_id,
          purchase_id: row.purchase_id,
          release_id: row.release_id,
          lot_identifier: row.lot_identifier || null,
          notes_internal: row.notes_internal || null,
          origin,
          origin_country: originCode,
          contract_origin: row.green_contracts?.origin || null,
          producer: pl?.producer || null,
          variety: pl?.variety || null,
          category: normalizeCategory(pl?.category),
          vendor_label: vendor,
          pl_lot_identifier: pl?.lot_identifier || null,
          contract_name: row.green_contracts?.name || null,
          internal_contract_number: row.green_contracts?.internal_contract_number || null,
          vendor_contract_number: row.green_contracts?.vendor_contract_number || null,
        };
      });
    },
  });

  const candidates = useMemo(() => {
    if (mode.kind === 'LINK') {
      return lots.filter(l => !mode.alreadyLinkedLotIds.has(l.id));
    }
    // SUCCESSOR mode
    return lots.filter(l => l.id !== mode.currentLotId && !mode.excludeLotIds.has(l.id));
  }, [lots, mode]);

  // Successor sorting / grouping
  const successorGroups = useMemo(() => {
    if (mode.kind !== 'SUCCESSOR') return new Map<string, 'CONTRACT' | 'ORIGIN' | null>();
    const map = new Map<string, 'CONTRACT' | 'ORIGIN' | null>();
    candidates.forEach(l => {
      if (mode.currentContractId && l.contract_id === mode.currentContractId) {
        map.set(l.id, 'CONTRACT');
      } else if (
        (mode.currentOriginCountry && l.origin_country && l.origin_country === mode.currentOriginCountry) ||
        (mode.currentOriginText && l.contract_origin && l.contract_origin === mode.currentOriginText)
      ) {
        map.set(l.id, 'ORIGIN');
      } else {
        map.set(l.id, null);
      }
    });
    return map;
  }, [candidates, mode]);

  const sortedCandidates = useMemo(() => {
    if (mode.kind !== 'SUCCESSOR') return candidates;
    const rank = (id: string) => {
      const g = successorGroups.get(id);
      if (g === 'CONTRACT') return 0;
      if (g === 'ORIGIN') return 1;
      return 2;
    };
    return [...candidates].sort((a, b) => {
      const r = rank(a.id) - rank(b.id);
      if (r !== 0) return r;
      return a.lot_number.localeCompare(b.lot_number);
    });
  }, [candidates, successorGroups, mode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = mode.kind === 'SUCCESSOR' ? sortedCandidates : candidates;
    return base.filter(l => {
      if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        l.lot_number, l.origin, l.producer || '', l.variety || '',
        l.pl_lot_identifier || '', l.lot_identifier || '', l.contract_name || '',
        l.vendor_contract_number || '', l.internal_contract_number || '', l.notes_internal || '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, sortedCandidates, search, categoryFilter, mode]);

  // ---- LINK mode helpers ----
  const selectedEntries = Object.entries(selection).filter(([, s]) => s.selected);
  const selectedCount = selectedEntries.length;
  const filledPcts = selectedEntries.map(([, s]) => s.pct.trim()).filter(v => v !== '');
  const allFilled = filledPcts.length === selectedCount && selectedCount > 0;
  const noneFilled = filledPcts.length === 0;
  const mixed = !allFilled && !noneFilled;
  const pctSum = filledPcts.reduce((sum, v) => sum + (Number(v) || 0), 0);

  let totalLabel = '';
  let totalClass = 'text-muted-foreground';
  if (mode.kind === 'LINK') {
    if (selectedCount === 0) totalLabel = 'No lots selected';
    else if (noneFilled) totalLabel = `${selectedCount} lot${selectedCount === 1 ? '' : 's'} selected — Percentages optional`;
    else {
      totalLabel = `${selectedCount} lot${selectedCount === 1 ? '' : 's'} selected — total ${pctSum.toFixed(1)}%`;
      totalClass = allFilled && Math.abs(pctSum - 100) < 0.01 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400';
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelection(prev => {
      const next = { ...prev };
      if (checked) next[id] = { selected: true, pct: prev[id]?.pct ?? '' };
      else if (next[id]) next[id] = { ...next[id], selected: false };
      return next;
    });
  }

  function setPct(id: string, pct: string) {
    setSelection(prev => ({ ...prev, [id]: { selected: prev[id]?.selected ?? false, pct } }));
  }

  // ---- LINK mutation ----
  const linkMutation = useMutation({
    mutationFn: async () => {
      if (mode.kind !== 'LINK') throw new Error('Wrong mode');
      const rows = selectedEntries.map(([lot_id, s]) => ({
        roast_group: mode.roastGroupKey,
        lot_id,
        pct_of_lot: s.pct.trim() ? Number(s.pct) : null,
      }));
      const { error } = await supabase.from('green_lot_roast_group_links').insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`Linked ${n} lot${n === 1 ? '' : 's'}`);
      if (mode.kind === 'LINK') {
        queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', mode.roastGroupKey] });
      }
      setSelection({});
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to link lots'),
  });

  // ---- SUCCESSOR mutations ----
  const successorMutation = useMutation({
    mutationFn: async (newSuccessorId: string | null) => {
      if (mode.kind !== 'SUCCESSOR') throw new Error('Wrong mode');
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? null;
      const payload = newSuccessorId
        ? { successor_lot_id: newSuccessorId, successor_nominated_at: new Date().toISOString(), successor_nominated_by: uid }
        : { successor_lot_id: null, successor_nominated_at: null, successor_nominated_by: null };
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .update(payload)
        .eq('id', mode.linkId);
      if (error) throw error;
      return newSuccessorId;
    },
    onSuccess: (newSuccessorId) => {
      if (mode.kind === 'SUCCESSOR') {
        queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', mode.roastGroupKey] });
        if (newSuccessorId) {
          const lot = lots.find(l => l.id === newSuccessorId);
          toast.success(`Successor nominated: ${lot?.lot_number ?? ''}`);
        } else {
          toast.success('Successor cleared');
        }
      }
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update successor'),
  });

  const isLink = mode.kind === 'LINK';
  const isSuccessor = mode.kind === 'SUCCESSOR';
  const hasExistingSuccessor = isSuccessor && !!mode.currentSuccessorLotId;

  const linkSaveDisabled = !isLink || selectedCount === 0 || mixed || linkMutation.isPending;
  const successorSaveDisabled = !isSuccessor || !successorChoice || successorChoice === mode.currentSuccessorLotId || successorMutation.isPending;

  const categoryChips: Array<{ key: 'ALL' | Category; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'BLENDER', label: 'Blender' },
    { key: 'MICRO_LOT', label: 'Micro Lot' },
    { key: 'HYPER_PREMIUM', label: 'Hyper Premium' },
  ];

  const title = isLink
    ? `Link Green Lots to ${roastGroupDisplayName}`
    : `Nominate Successor for ${(mode as any).currentLotNumber}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search by lot number, name, origin, producer, variety, or contract ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {categoryChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setCategoryFilter(chip.key)}
                className={cn(
                  'text-xs px-3 py-1 rounded-full border transition-colors',
                  categoryFilter === chip.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto border rounded-md mt-2">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading lots…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No matching lots.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Lot Number</TableHead>
                  <TableHead>Name / Label</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Producer / Variety</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Kg on hand</TableHead>
                  <TableHead>Received / ETA</TableHead>
                  {isLink && <TableHead className="w-24">% of lot</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(lot => {
                  const sel = selection[lot.id];
                  const isSelected = isLink ? !!sel?.selected : successorChoice === lot.id;
                  const incomplete = lot.costing_status === 'COSTING_INCOMPLETE';
                  const producerVariety =
                    lot.producer && lot.variety
                      ? `${lot.producer} — ${lot.variety}`
                      : lot.producer || lot.variety || '—';
                  const nameLabel = lot.pl_lot_identifier || lot.lot_identifier || lot.contract_name || '—';
                  const dateCell =
                    lot.status === 'RECEIVED'
                      ? (lot.received_date || '')
                      : lot.status === 'EN_ROUTE'
                        ? (lot.expected_delivery_date ? `ETA ${lot.expected_delivery_date}` : 'ETA —')
                        : '';
                  const successorGroup = isSuccessor ? successorGroups.get(lot.id) : null;
                  return (
                    <TableRow key={lot.id} className={cn(incomplete && 'text-muted-foreground')}>
                      <TableCell>
                        {isLink ? (
                          <Checkbox checked={isSelected} onCheckedChange={(v) => toggleRow(lot.id, !!v)} />
                        ) : (
                          <input
                            type="radio"
                            name="successor-pick"
                            checked={isSelected}
                            onChange={() => setSuccessorChoice(lot.id)}
                            className="h-4 w-4 accent-primary cursor-pointer"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{lot.lot_number}</span>
                          {lot.vendor_label && (
                            <Badge variant="outline" className="text-[10px]">{lot.vendor_label}</Badge>
                          )}
                          {successorGroup === 'CONTRACT' && (
                            <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 dark:border-green-700 dark:text-green-300">
                              Same contract
                            </Badge>
                          )}
                          {successorGroup === 'ORIGIN' && (
                            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                              Same origin
                            </Badge>
                          )}
                          {incomplete && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                            >
                              Costing incomplete
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{nameLabel}</TableCell>
                      <TableCell className="text-sm">{lot.origin || '—'}</TableCell>
                      <TableCell className="text-sm">{producerVariety}</TableCell>
                      <TableCell className="text-sm">
                        {lot.category ? CATEGORY_LABEL[lot.category] : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {lot.kg_on_hand.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-sm">{dateCell || '—'}</TableCell>
                      {isLink && (
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="h-8 text-xs"
                            placeholder="—"
                            disabled={!isSelected}
                            value={sel?.pct ?? ''}
                            onChange={e => setPct(lot.id, e.target.value)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t">
          {isLink ? (
            <>
              <div className="flex flex-col gap-1 text-sm">
                <span className={totalClass}>{totalLabel}</span>
                {mixed && (
                  <span className="text-xs text-destructive">
                    Fill all percentages or leave them all blank
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={linkMutation.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => linkMutation.mutate()} disabled={linkSaveDisabled}>
                  {linkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Link {selectedCount} lot{selectedCount === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                {successorChoice
                  ? `Successor: ${lots.find(l => l.id === successorChoice)?.lot_number ?? ''}`
                  : 'Select a successor lot'}
              </div>
              <div className="flex items-center gap-2">
                {hasExistingSuccessor && (
                  <Button
                    variant="outline"
                    onClick={() => successorMutation.mutate(null)}
                    disabled={successorMutation.isPending}
                  >
                    Clear successor
                  </Button>
                )}
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={successorMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => successorChoice && successorMutation.mutate(successorChoice)}
                  disabled={successorSaveDisabled}
                >
                  {successorMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {hasExistingSuccessor ? 'Update Successor' : 'Nominate Successor'}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
