import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Pencil, Printer, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { machineName, roasterFirstName } from '@/lib/batchLabel';
import { printBatchLabel, printBlendLabel, fetchLotLabels, parseLotSplits, type StoredLotSplit } from '@/lib/batchLabelData';

type Machine = 'LORING' | 'SAMIAC';

interface BatchRow {
  id: string;
  roast_group: string;
  batch_number: string | null;
  batch_date: string | null;
  roasted_at: string | null;
  roasted_by: string | null;
  assigned_roaster: Machine | null;
  planned_output_kg: number | null;
  actual_output_kg: number;
  green_lot_splits: unknown;
  green_deducted: boolean;
  consumed_by_blend_at: string | null;
  notes: string | null;
  cropster_batch_id: string | null;
}

interface BlendRunRow {
  id: string;
  batch_number: string;
  batch_date: string;
  blend_roast_group: string;
  total_kg: number;
  made_by: string | null;
  made_at: string;
  notes: string | null;
  blend_run_components: { roasted_batch_id: string; kg_used: number }[];
}

/** One row of the history list: a roasted batch or a blend. */
interface HistoryItem {
  kind: 'batch' | 'blend';
  id: string;
  batchNumber: string;
  batchDate: string;
  at: string;
  roastGroup: string;
  machine: 'LORING' | 'SAMIAC' | 'BLEND' | null;
  roastedBy: string | null;
  greenKg: number | null;
  roastedKg: number;
  lotIds: string[];
  batch?: BatchRow;
  blend?: BlendRunRow;
}

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
const kg = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)} kg`);

/** ISO → value for <input type="datetime-local"> in this browser's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BatchHistory() {
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [machine, setMachine] = useState<'ALL' | 'LORING' | 'SAMIAC' | 'BLEND'>('ALL');
  const [roastGroup, setRoastGroup] = useState('ALL');
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [editing, setEditing] = useState<HistoryItem | null>(null);

  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['batch-history', 'batches'],
    queryFn: async () =>
      (await fetchAllRows((f, t) =>
        supabase
          .from('roasted_batches')
          .select('id, roast_group, batch_number, batch_date, roasted_at, roasted_by, assigned_roaster, planned_output_kg, actual_output_kg, green_lot_splits, green_deducted, consumed_by_blend_at, notes, cropster_batch_id')
          .eq('status', 'ROASTED')
          .not('batch_number', 'is', null)
          .order('id', { ascending: true })
          .range(f, t),
      )) as BatchRow[],
  });

  const { data: blends = [], isLoading: loadingBlends } = useQuery({
    queryKey: ['batch-history', 'blends'],
    queryFn: async () =>
      (await fetchAllRows((f, t) =>
        supabase
          .from('blend_runs')
          .select('id, batch_number, batch_date, blend_roast_group, total_kg, made_by, made_at, notes, blend_run_components(roasted_batch_id, kg_used)')
          .order('id', { ascending: true })
          .range(f, t),
      )) as unknown as BlendRunRow[],
  });

  const { data: roastGroups = [] } = useQuery({
    queryKey: ['batch-history', 'roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roast_groups').select('roast_group, display_name').order('roast_group');
      if (error) throw error;
      return data ?? [];
    },
  });
  const rgName = useMemo(() => {
    const m = new Map(roastGroups.map(r => [r.roast_group, (r.display_name as string | null)?.trim() || r.roast_group.replace(/_/g, ' ')]));
    return (key: string) => m.get(key) ?? key.replace(/_/g, ' ');
  }, [roastGroups]);

  const { data: profiles = [] } = useQuery({
    queryKey: ['batch-history', 'profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, name, label_name, is_active');
      if (error) throw error;
      return data ?? [];
    },
  });
  const personName = useMemo(() => {
    const m = new Map(profiles.map(p => [p.user_id, roasterFirstName(p)]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [profiles]);

  const allLotIds = useMemo(
    () => [...new Set(batches.flatMap(b => parseLotSplits(b.green_lot_splits).map(s => s.lot_id)))],
    [batches],
  );
  const { data: lotNames = {} } = useQuery({
    queryKey: ['batch-history', 'lot-names', allLotIds.join(',')],
    queryFn: () => fetchLotLabels(allLotIds),
    enabled: allLotIds.length > 0,
  });

  const batchById = useMemo(() => new Map(batches.map(b => [b.id, b])), [batches]);
  const blendByComponent = useMemo(() => {
    const m = new Map<string, BlendRunRow>();
    for (const r of blends) for (const c of r.blend_run_components ?? []) m.set(c.roasted_batch_id, r);
    return m;
  }, [blends]);

  const items: HistoryItem[] = useMemo(() => {
    const list: HistoryItem[] = batches.map(b => ({
      kind: 'batch',
      id: b.id,
      batchNumber: b.batch_number!,
      batchDate: b.batch_date ?? (b.roasted_at ?? '').slice(0, 10),
      at: b.roasted_at ?? '',
      roastGroup: b.roast_group,
      machine: b.assigned_roaster,
      roastedBy: b.roasted_by,
      greenKg: b.planned_output_kg,
      roastedKg: Number(b.actual_output_kg),
      lotIds: parseLotSplits(b.green_lot_splits).map(s => s.lot_id),
      batch: b,
    }));
    for (const r of blends) {
      list.push({
        kind: 'blend',
        id: r.id,
        batchNumber: r.batch_number,
        batchDate: r.batch_date,
        at: r.made_at,
        roastGroup: r.blend_roast_group,
        machine: 'BLEND',
        roastedBy: r.made_by,
        greenKg: null,
        roastedKg: Number(r.total_kg),
        lotIds: [],
        blend: r,
      });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [batches, blends]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return items.filter(i =>
      (!q || i.batchNumber.toUpperCase().includes(q)) &&
      (!from || i.batchDate >= from) &&
      (!to || i.batchDate <= to) &&
      (machine === 'ALL' || i.machine === machine) &&
      (roastGroup === 'ALL' || i.roastGroup === roastGroup),
    );
  }, [items, search, from, to, machine, roastGroup]);

  const roastGroupChoices = useMemo(
    () => [...new Set(items.map(i => i.roastGroup))].sort((a, b) => rgName(a).localeCompare(rgName(b))),
    [items, rgName],
  );

  const reprint = async (item: HistoryItem) => {
    try {
      if (item.kind === 'blend') await printBlendLabel(item.id);
      else await printBatchLabel(item.id);
    } catch (e) {
      toast.error((e as Error).message || 'Could not print label');
    }
  };

  const lotsText = (ids: string[]) => ids.map(id => lotNames[id] ?? '…').join(' + ') || '—';
  const isLoading = loadingBatches || loadingBlends;
  const hasFilters = !!(search || from || to || machine !== 'ALL' || roastGroup !== 'ALL');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Batch History</h1>
        <p className="text-sm text-muted-foreground">Every roasted batch and blend, newest first.</p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Batch number</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 w-44" placeholder="e.g. L15-1028" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" className="w-40" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" className="w-40" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Machine</Label>
            <Select value={machine} onValueChange={v => setMachine(v as typeof machine)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="LORING">Loring</SelectItem>
                <SelectItem value="SAMIAC">Samiac</SelectItem>
                <SelectItem value="BLEND">Blends</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Roast group</Label>
            <Select value={roastGroup} onValueChange={setRoastGroup}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All roast groups</SelectItem>
                {roastGroupChoices.map(rg => <SelectItem key={rg} value={rg}>{rgName(rg)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFrom(''); setTo(''); setMachine('ALL'); setRoastGroup('ALL'); }}>
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {items.length}</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Roast group</TableHead>
                  <TableHead>Roasted</TableHead>
                  <TableHead>Roaster</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead className="text-right">Green in</TableHead>
                  <TableHead className="text-right">Roasted out</TableHead>
                  <TableHead>Green lot(s)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No batches match.</TableCell></TableRow>
                ) : filtered.map(i => (
                  <TableRow key={`${i.kind}-${i.id}`} className="cursor-pointer" onClick={() => setSelected(i)}>
                    <TableCell className="font-mono font-semibold whitespace-nowrap">{i.batchNumber}</TableCell>
                    <TableCell>{rgName(i.roastGroup)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(i.at)}</TableCell>
                    <TableCell>{personName(i.roastedBy)}</TableCell>
                    <TableCell>{machineName(i.machine)}</TableCell>
                    <TableCell className="text-right tabular-nums">{kg(i.greenKg)}</TableCell>
                    <TableCell className="text-right tabular-nums">{kg(i.roastedKg)}</TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {i.kind === 'blend' ? <span className="text-muted-foreground">—</span>
                        : i.lotIds.length === 0 ? <Badge variant="outline" className="text-amber-700 border-amber-300">No green lot</Badge>
                        : lotsText(i.lotIds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail */}
      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{selected.batchNumber}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <span className="text-muted-foreground">Roast group</span><span>{rgName(selected.roastGroup)}</span>
                <span className="text-muted-foreground">Batch date</span><span>{selected.batchDate}</span>
                <span className="text-muted-foreground">{selected.kind === 'blend' ? 'Made' : 'Roasted'}</span><span>{fmtDateTime(selected.at)}</span>
                <span className="text-muted-foreground">{selected.kind === 'blend' ? 'Made by' : 'Roaster'}</span><span>{personName(selected.roastedBy)}</span>
                <span className="text-muted-foreground">Machine</span><span>{machineName(selected.machine)}</span>
                {selected.kind === 'batch' && <><span className="text-muted-foreground">Green in</span><span>{kg(selected.greenKg)}</span></>}
                <span className="text-muted-foreground">{selected.kind === 'blend' ? 'Blend total' : 'Roasted out'}</span><span>{kg(selected.roastedKg)}</span>
                {selected.kind === 'batch' && selected.batch && (
                  <>
                    <span className="text-muted-foreground">Green lot(s)</span>
                    <span>
                      {parseLotSplits(selected.batch.green_lot_splits).map(s => (
                        <span key={s.lot_id} className="block">{lotNames[s.lot_id] ?? s.lot_id.slice(0, 8)} · {Math.round(s.pct)}%</span>
                      ))}
                      {selected.lotIds.length === 0 && 'None recorded'}
                    </span>
                    <span className="text-muted-foreground">Green taken off</span>
                    <span>{selected.batch.green_deducted ? 'Yes' : 'No (deduction was off or no lot)'}</span>
                    <span className="text-muted-foreground">Went into blend</span>
                    <span>
                      {blendByComponent.get(selected.id)
                        ? <button className="font-mono underline" onClick={() => {
                            const r = blendByComponent.get(selected.id)!;
                            setSelected(items.find(x => x.kind === 'blend' && x.id === r.id) ?? null);
                          }}>{blendByComponent.get(selected.id)!.batch_number}</button>
                        : selected.batch.consumed_by_blend_at ? 'Yes (before blend numbers)' : '—'}
                    </span>
                    {selected.batch.cropster_batch_id && <><span className="text-muted-foreground">Cropster</span><span>{selected.batch.cropster_batch_id}</span></>}
                    {selected.batch.notes && <><span className="text-muted-foreground">Notes</span><span>{selected.batch.notes}</span></>}
                  </>
                )}
                {selected.kind === 'blend' && selected.blend && (
                  <>
                    <span className="text-muted-foreground">Components</span>
                    <span>
                      {selected.blend.blend_run_components.map(c => {
                        const b = batchById.get(c.roasted_batch_id);
                        return (
                          <button
                            key={c.roasted_batch_id}
                            className="block text-left"
                            onClick={() => setSelected(items.find(x => x.kind === 'batch' && x.id === c.roasted_batch_id) ?? selected)}
                          >
                            <span className="font-mono underline">{b?.batch_number ?? c.roasted_batch_id.slice(0, 8)}</span>
                            {' '}{b ? rgName(b.roast_group) : ''} · {Number(c.kg_used).toFixed(1)} kg
                          </button>
                        );
                      })}
                    </span>
                    {selected.blend.notes && <><span className="text-muted-foreground">Notes</span><span>{selected.blend.notes}</span></>}
                  </>
                )}
              </div>
              <DialogFooter className="gap-2">
                {isAdmin && (
                  <Button variant="outline" onClick={() => { setEditing(selected); setSelected(null); }}>
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                )}
                <Button onClick={() => reprint(selected)}>
                  <Printer className="h-4 w-4 mr-1" /> Reprint label
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {editing?.kind === 'batch' && editing.batch && (
        <EditBatchDialog
          batch={editing.batch}
          profiles={profiles}
          lotNames={lotNames}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'blend' && editing.blend && (
        <EditBlendDialog blend={editing.blend} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function EditBatchDialog({
  batch,
  profiles,
  lotNames,
  onClose,
}: {
  batch: BatchRow;
  profiles: { user_id: string; name: string; label_name: string | null; is_active: boolean }[];
  lotNames: Record<string, string>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [number, setNumber] = useState(batch.batch_number ?? '');
  const [date, setDate] = useState(batch.batch_date ?? '');
  const [machine, setMachine] = useState<Machine | 'NONE'>(batch.assigned_roaster ?? 'NONE');
  const [roastedAt, setRoastedAt] = useState(toLocalInput(batch.roasted_at));
  const [roastedBy, setRoastedBy] = useState(batch.roasted_by ?? 'NONE');
  const [green, setGreen] = useState(String(batch.planned_output_kg ?? ''));
  const [roasted, setRoasted] = useState(String(batch.actual_output_kg ?? ''));
  const [splits, setSplits] = useState<StoredLotSplit[]>(parseLotSplits(batch.green_lot_splits));
  const [notes, setNotes] = useState(batch.notes ?? '');
  const [cropster, setCropster] = useState(batch.cropster_batch_id ?? '');

  const { data: lots = [] } = useQuery({
    queryKey: ['batch-history', 'lot-choices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_lots').select('id, lot_number').order('lot_number');
      if (error) throw error;
      return data ?? [];
    },
  });
  const lotNumber = (id: string) => lots.find(l => l.id === id)?.lot_number ?? lotNames[id] ?? id.slice(0, 8);

  const save = useMutation({
    mutationFn: async () => {
      const g = parseFloat(green);
      const r = parseFloat(roasted);
      if (!Number.isFinite(g) || g < 0) throw new Error('Green kg must be a number');
      if (!Number.isFinite(r) || r < 0) throw new Error('Roasted kg must be a number');
      const { error } = await supabase.rpc('edit_roasted_batch', {
        p_batch_id: batch.id,
        p_batch_number: number,
        p_batch_date: date || null,
        p_machine: machine === 'NONE' ? null : machine,
        p_roasted_at: roastedAt ? new Date(roastedAt).toISOString() : null,
        p_roasted_by: roastedBy === 'NONE' ? null : roastedBy,
        p_green_kg: g,
        p_actual_output_kg: r,
        p_lot_splits: splits.filter(s => s.pct > 0).map(s => ({ lot_id: s.lot_id, pct: s.pct })),
        p_notes: notes.trim() || null,
        p_cropster_batch_id: cropster.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch updated');
      queryClient.invalidateQueries({ queryKey: ['batch-history'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-wip-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit batch {batch.batch_number}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1"><Label>Batch number</Label><Input className="font-mono" value={number} onChange={e => setNumber(e.target.value)} /></div>
          <div className="space-y-1"><Label>Batch date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Machine</Label>
            <Select value={machine} onValueChange={v => setMachine(v as Machine | 'NONE')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LORING">Loring</SelectItem>
                <SelectItem value="SAMIAC">Samiac</SelectItem>
                <SelectItem value="NONE">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Roaster</Label>
            <Select value={roastedBy} onValueChange={setRoastedBy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Unknown</SelectItem>
                {profiles.filter(p => p.is_active || p.user_id === batch.roasted_by).map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2"><Label>Roasted at</Label><Input type="datetime-local" value={roastedAt} onChange={e => setRoastedAt(e.target.value)} /></div>
          <div className="space-y-1"><Label>Green kg in</Label><Input inputMode="decimal" value={green} onChange={e => setGreen(e.target.value)} /></div>
          <div className="space-y-1"><Label>Roasted kg out</Label><Input inputMode="decimal" value={roasted} onChange={e => setRoasted(e.target.value)} /></div>
          <div className="space-y-1 col-span-2">
            <Label>Green lots (%)</Label>
            {splits.map(s => (
              <div key={s.lot_id} className="flex items-center gap-2">
                <span className="flex-1 truncate">{lotNumber(s.lot_id)}</span>
                <Input
                  className="w-20"
                  inputMode="decimal"
                  value={String(s.pct)}
                  onChange={e => setSplits(prev => prev.map(x => x.lot_id === s.lot_id ? { ...x, pct: Math.max(0, parseFloat(e.target.value) || 0) } : x))}
                />
                <Button variant="ghost" size="sm" onClick={() => setSplits(prev => prev.filter(x => x.lot_id !== s.lot_id))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Select value="" onValueChange={id => setSplits(prev => [...prev, { lot_id: id, pct: prev.length === 0 ? 100 : 0 }])}>
              <SelectTrigger><SelectValue placeholder="Add a green lot…" /></SelectTrigger>
              <SelectContent>
                {lots.filter(l => !splits.some(s => s.lot_id === l.id)).map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.lot_number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {batch.green_deducted && (
              <p className="text-xs text-muted-foreground">This batch took green off stock; saving puts it back and takes the new amounts.</p>
            )}
          </div>
          <div className="space-y-1"><Label>Cropster</Label><Input value={cropster} onChange={e => setCropster(e.target.value)} /></div>
          <div className="space-y-1 col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBlendDialog({ blend, onClose }: { blend: BlendRunRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [number, setNumber] = useState(blend.batch_number);
  const [date, setDate] = useState(blend.batch_date);
  const [notes, setNotes] = useState(blend.notes ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const n = number.trim().toUpperCase();
      if (!n) throw new Error('Batch number is required');
      const { data, error } = await supabase
        .from('blend_runs')
        .update({ batch_number: n, batch_date: date, notes: notes.trim() || null })
        .eq('id', blend.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Not saved — admins only');
    },
    onSuccess: () => {
      toast.success('Blend updated');
      queryClient.invalidateQueries({ queryKey: ['batch-history'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message.includes('duplicate') ? 'That batch number is already used' : e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit blend {blend.batch_number}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1"><Label>Batch number</Label><Input className="font-mono" value={number} onChange={e => setNumber(e.target.value)} /></div>
          <div className="space-y-1"><Label>Batch date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Component batches and kg can't be changed after blending.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
