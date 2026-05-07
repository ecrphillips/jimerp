/**
 * Offer Workspace Tab — persistent per-account pricing workspace.
 *
 * Mirrors the MixingConsole pattern (preset inheritance, live preview) but
 * persists every line in `offer_workspace_lines`. Auto-saves cell edits on
 * blur. Explicit "Save & copy offer" stamps `saved_green_cost_per_kg` /
 * session metadata and copies a clean text table to the clipboard.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, Plus, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  computeFinancingCostPerKg,
  computeDeriskedCostPerKg,
  computeMarkedUpCostPerKg,
  computeRoastedCostFromGreen,
  computeTotalRoastedCostPerKg,
  applyTierAdjustment,
} from '@/lib/pricing';
import { useAccountPricingPreset } from '@/components/pricing/MixingConsole';

// Friendly variant label → packaging_costs enum + bag_size_g.
// 500g intentionally omitted: no matching packaging_costs row in the system.
const VARIANT_OPTIONS = [
  { label: '250g',  enumValue: 'RETAIL_250G', bagSizeG: 250 },
  { label: '340g',  enumValue: 'RETAIL_340G', bagSizeG: 340 },
  { label: '454g',  enumValue: 'RETAIL_454G', bagSizeG: 454 },
  { label: '1kg',   enumValue: 'BULK_1KG',    bagSizeG: 1000 },
  { label: '2kg',   enumValue: 'BULK_2KG',    bagSizeG: 2000 },
  { label: '5lb',   enumValue: 'BULK_5LB',    bagSizeG: 2268 },
] as const;

type VariantLabel = typeof VARIANT_OPTIONS[number]['label'];

const variantByLabel = (label: string) =>
  VARIANT_OPTIONS.find(v => v.label === label) ?? VARIANT_OPTIONS[0];

interface WorkspaceLine {
  id: string;
  account_id: string;
  roast_group: string;
  packaging_variant: string;
  client_facing_name: string;
  sort_order: number;
  green_markup_multiplier_override: number | null;
  yield_loss_pct_override: number | null;
  process_rate_per_kg_override: number | null;
  overhead_per_kg_override: number | null;
  wiggle_room_per_bag: number | null;
  wiggle_room_note: string | null;
  saved_green_cost_per_kg: number | null;
  saved_at: string | null;
  saved_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

type DraftLine = WorkspaceLine & { _isNew?: boolean; _dirty?: boolean; _autoFilledName?: boolean };

const NEW_PREFIX = 'new-';

export default function OfferWorkspaceTab({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const presetQuery = useAccountPricingPreset(accountId);
  const preset = presetQuery.data;

  const linesQuery = useQuery({
    queryKey: ['offer-workspace-lines', accountId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('offer_workspace_lines')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as WorkspaceLine[];
    },
  });

  const sessionQuery = useQuery({
    queryKey: ['offer-workspace-session', accountId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('offer_workspace_sessions')
        .select('last_saved_at, last_saved_by')
        .eq('account_id', accountId)
        .maybeSingle();
      if (error) throw error;
      return data as { last_saved_at: string | null; last_saved_by: string | null } | null;
    },
  });

  const { data: lastEditor } = useQuery({
    queryKey: ['profile-name', sessionQuery.data?.last_saved_by],
    enabled: !!sessionQuery.data?.last_saved_by,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('user_id', sessionQuery.data!.last_saved_by!)
        .maybeSingle();
      return data;
    },
  });

  const { data: roastGroups = [] } = useQuery({
    queryKey: ['active-roast-groups-for-offer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, roast_group_code, display_name')
        .eq('is_active', true)
        .order('display_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: groupGreenData } = useQuery({
    queryKey: ['offer-workspace-roast-group-green'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`pct_of_lot, roast_group, green_lots!green_lot_roast_group_links_lot_id_fkey(kg_on_hand, book_value_per_kg, market_value_per_kg)`);
      if (error) throw error;
      const inventory: Record<string, number> = {};
      const links: Record<string, Array<{ pct: number; mv: number | null; bv: number | null; kg: number }>> = {};
      for (const row of (data ?? []) as any[]) {
        const rg = row.roast_group as string;
        const lot = row.green_lots;
        if (!lot) continue;
        const kg = Number(lot.kg_on_hand ?? 0);
        inventory[rg] = (inventory[rg] ?? 0) + kg;
        if (!links[rg]) links[rg] = [];
        links[rg].push({
          pct: Number(row.pct_of_lot ?? 0),
          mv: lot.market_value_per_kg != null ? Number(lot.market_value_per_kg) : null,
          bv: lot.book_value_per_kg != null ? Number(lot.book_value_per_kg) : null,
          kg,
        });
      }
      const greenValue: Record<string, number | null> = {};
      for (const [rg, list] of Object.entries(links)) {
        const usable = list.filter(l => (l.mv ?? l.bv) != null && (l.mv ?? l.bv)! > 0);
        if (usable.length === 0) { greenValue[rg] = null; continue; }
        const totalPct = usable.reduce((a, l) => a + l.pct, 0);
        const equal = totalPct <= 0;
        let v = 0;
        for (const l of usable) {
          const w = equal ? 1 / usable.length : l.pct / totalPct;
          v += w * (l.mv ?? l.bv!)!;
        }
        greenValue[rg] = v;
      }
      return { inventory, greenValue };
    },
  });

  const merged: DraftLine[] = useMemo(() => {
    const server = (linesQuery.data ?? []).map(l => drafts[l.id] ?? l);
    const newOnes = Object.values(drafts).filter(d => d._isNew && !linesQuery.data?.some(l => l.id === d.id));
    return [...server, ...newOnes].sort((a, b) => a.sort_order - b.sort_order);
  }, [linesQuery.data, drafts]);

  const upsertLine = useMutation({
    mutationFn: async (line: DraftLine) => {
      const cleaned = stripPresetOverrides(line, preset);
      const payload: any = {
        account_id: accountId,
        roast_group: line.roast_group,
        packaging_variant: line.packaging_variant,
        client_facing_name: line.client_facing_name,
        sort_order: line.sort_order,
        green_markup_multiplier_override: cleaned.green_markup_multiplier_override,
        yield_loss_pct_override: cleaned.yield_loss_pct_override,
        process_rate_per_kg_override: cleaned.process_rate_per_kg_override,
        overhead_per_kg_override: cleaned.overhead_per_kg_override,
        wiggle_room_per_bag: line.wiggle_room_per_bag,
        wiggle_room_note: line.wiggle_room_note,
      };
      if (line._isNew) {
        const { data, error } = await (supabase as any)
          .from('offer_workspace_lines')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { tempId: line.id, row: data as WorkspaceLine };
      } else {
        const { data, error } = await (supabase as any)
          .from('offer_workspace_lines')
          .update(payload)
          .eq('id', line.id)
          .select()
          .single();
        if (error) throw error;
        return { tempId: line.id, row: data as WorkspaceLine };
      }
    },
    onSuccess: ({ tempId }) => {
      setDrafts(prev => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['offer-workspace-lines', accountId] });
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const deleteLine = useMutation({
    mutationFn: async (id: string) => {
      if (id.startsWith(NEW_PREFIX)) return;
      const { error } = await (supabase as any).from('offer_workspace_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
      qc.invalidateQueries({ queryKey: ['offer-workspace-lines', accountId] });
      toast.success('Row removed');
    },
  });

  const updateDraft = useCallback((line: DraftLine, patch: Partial<DraftLine>) => {
    setDrafts(prev => ({ ...prev, [line.id]: { ...(prev[line.id] ?? line), ...patch, _dirty: true } }));
  }, []);

  const handleBlur = (line: DraftLine) => {
    const draft = drafts[line.id];
    if (!draft || !draft._dirty) return;
    if (!draft.client_facing_name?.trim()) return;
    if (!draft.roast_group) return;
    if (draft.wiggle_room_per_bag != null && draft.wiggle_room_per_bag !== 0 && !draft.wiggle_room_note?.trim()) return;
    upsertLine.mutate(draft);
  };

  const addRow = () => {
    if (!preset) return;
    const tempId = `${NEW_PREFIX}${Date.now()}`;
    const maxSort = merged.reduce((m, l) => Math.max(m, l.sort_order), -1);
    setDrafts(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        account_id: accountId,
        roast_group: '',
        packaging_variant: '5lb',
        client_facing_name: '',
        sort_order: maxSort + 1,
        green_markup_multiplier_override: preset.green_markup_multiplier,
        yield_loss_pct_override: preset.yield_loss_pct,
        process_rate_per_kg_override: preset.process_rate_per_kg,
        overhead_per_kg_override: preset.overhead_per_kg,
        wiggle_room_per_bag: null,
        wiggle_room_note: null,
        saved_green_cost_per_kg: null,
        saved_at: null,
        saved_by: null,
        updated_at: new Date().toISOString(),
        updated_by: null,
        _isNew: true,
        _dirty: false,
        _autoFilledName: true,
      },
    }));
  };

  const computePreview = (line: DraftLine) => {
    if (!preset) return null;
    const greenMv = groupGreenData?.greenValue?.[line.roast_group];
    if (greenMv == null) return null;
    try {
      const variant = variantByLabel(line.packaging_variant);
      const greenMarkup = line.green_markup_multiplier_override ?? preset.green_markup_multiplier;
      const yieldLoss = line.yield_loss_pct_override ?? preset.yield_loss_pct;
      const processRate = line.process_rate_per_kg_override ?? preset.process_rate_per_kg;
      const overhead = line.overhead_per_kg_override ?? preset.overhead_per_kg;
      const wiggle = line.wiggle_room_per_bag ?? 0;

      const financing = computeFinancingCostPerKg(greenMv, preset.financing_apr_pct, preset.financing_days);
      const market = greenMv + financing;
      const derisked = computeDeriskedCostPerKg(market, preset.carry_risk_premium_pct);
      const markedUp = computeMarkedUpCostPerKg(derisked, greenMarkup);
      const roastedFromGreen = computeRoastedCostFromGreen(markedUp, yieldLoss);
      const totalPerKg = computeTotalRoastedCostPerKg(roastedFromGreen, processRate, overhead);
      const bagKg = variant.bagSizeG / 1000;
      const roastedPerBag = totalPerKg * bagKg;
      const totalCostPerBag = roastedPerBag;
      const adj = applyTierAdjustment(totalCostPerBag, preset.tier, preset.target_margin_pct, bagKg);
      const finalPrice = adj.final + wiggle;
      const margin = finalPrice > 0 ? ((finalPrice - totalCostPerBag) / finalPrice) * 100 : 0;
      return { cost: totalCostPerBag, price: finalPrice, margin };
    } catch {
      return null;
    }
  };

  const handleSaveAndCopy = async () => {
    setSavingAll(true);
    try {
      const dirty = Object.values(drafts).filter(d => d._dirty || d._isNew);
      for (const d of dirty) {
        if (!d.client_facing_name?.trim() || !d.roast_group) continue;
        await upsertLine.mutateAsync(d);
      }
      const { data: refreshed, error } = await (supabase as any)
        .from('offer_workspace_lines')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order');
      if (error) throw error;
      const allLines = (refreshed ?? []) as WorkspaceLine[];

      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id ?? null;
      const nowIso = new Date().toISOString();
      for (const ln of allLines) {
        const mv = groupGreenData?.greenValue?.[ln.roast_group] ?? null;
        await (supabase as any)
          .from('offer_workspace_lines')
          .update({ saved_green_cost_per_kg: mv, saved_at: nowIso, saved_by: uid })
          .eq('id', ln.id);
      }
      await (supabase as any).from('offer_workspace_sessions').upsert(
        { account_id: accountId, last_saved_at: nowIso, last_saved_by: uid },
        { onConflict: 'account_id' },
      );
      qc.invalidateQueries({ queryKey: ['offer-workspace-lines', accountId] });
      qc.invalidateQueries({ queryKey: ['offer-workspace-session', accountId] });

      const rows = allLines.filter(l => l.client_facing_name?.trim()).map(l => ({
        name: l.client_facing_name.trim(),
        size: variantByLabel(l.packaging_variant).label,
        price: formatPrice(computePreviewForLine(l, preset, groupGreenData?.greenValue?.[l.roast_group] ?? null)?.price),
      }));
      const headers = ['Product', 'Size', 'Price'];
      const data = [headers, ...rows.map(r => [r.name, r.size, r.price])];
      const widths = headers.map((_, i) => Math.max(...data.map(r => r[i].length)));
      const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);
      const fmtRow = (r: string[]) => r.map((c, i) => pad(c, widths[i])).join('  |  ');
      const sep = widths.map(w => '-'.repeat(w)).join('--+--');
      const text = `${fmtRow(headers)}\n${sep}\n${rows.map(r => fmtRow([r.name, r.size, r.price])).join('\n')}\n\nAll prices in CAD.`;
      await navigator.clipboard.writeText(text);
      toast.success('Offer saved and copied to clipboard.');
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setSavingAll(false);
    }
  };

  if (linesQuery.isLoading || presetQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (presetQuery.error || !preset) {
    return <div className="text-sm text-destructive">Could not load pricing presets.</div>;
  }

  const session = sessionQuery.data;
  const lastSavedLine = session?.last_saved_at
    ? `Last saved ${formatDistanceToNow(new Date(session.last_saved_at), { addSuffix: true })}${
        lastEditor?.name ? ` by ${lastEditor.name}` : lastEditor?.email ? ` by ${lastEditor.email}` : ''
      }`
    : 'Not yet saved.';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Offer Workspace</h2>
          <p className="text-xs text-muted-foreground mt-1">{lastSavedLine}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Add row
          </Button>
          <Button size="sm" onClick={handleSaveAndCopy} disabled={savingAll}>
            <Save className="h-4 w-4 mr-1" />
            {savingAll ? 'Saving…' : 'Save & copy offer'}
          </Button>
        </div>
      </div>

      {merged.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-sm text-muted-foreground">
          No rows yet. Click <span className="font-medium">+ Add row</span> to start building the offer.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-2 py-2 font-medium min-w-[180px]">Client-Facing Name</th>
                <th className="px-2 py-2 font-medium min-w-[180px]">Roast Group</th>
                <th className="px-2 py-2 font-medium">Variant</th>
                <th className="px-2 py-2 font-medium">Green Markup</th>
                <th className="px-2 py-2 font-medium">Yield Loss %</th>
                <th className="px-2 py-2 font-medium">Process $/kg</th>
                <th className="px-2 py-2 font-medium">Overhead $/kg</th>
                <th className="px-2 py-2 font-medium">Wiggle $/bag</th>
                <th className="px-2 py-2 font-medium">Green $/kg</th>
                <th className="px-2 py-2 font-medium">Drift</th>
                <th className="px-2 py-2 font-medium">Live Preview</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {merged.map(line => {
                const inv = groupGreenData?.inventory?.[line.roast_group] ?? null;
                const greenMv = groupGreenData?.greenValue?.[line.roast_group] ?? null;
                const lowStock = inv != null && inv < 20;
                const preview = computePreview(line);
                const drift = computeDrift(greenMv, line.saved_green_cost_per_kg);
                const nameMissing = !line.client_facing_name?.trim();
                return (
                  <tr key={line.id} className="border-t align-top">
                    <td className="px-2 py-2">
                      <Input
                        className={cn('h-8 text-xs', nameMissing && 'border-destructive focus-visible:ring-destructive')}
                        value={line.client_facing_name}
                        onChange={e => updateDraft(line, { client_facing_name: e.target.value, _autoFilledName: false })}
                        onBlur={() => handleBlur(line)}
                        placeholder="Required"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={line.roast_group || undefined}
                        onValueChange={v => {
                          const rg = roastGroups.find(g => g.roast_group === v);
                          const shouldAutofill = !line.client_facing_name?.trim() || line._autoFilledName;
                          const patch: Partial<DraftLine> = { roast_group: v };
                          if (shouldAutofill && rg?.display_name) {
                            patch.client_facing_name = rg.display_name;
                            patch._autoFilledName = true;
                          }
                          updateDraft(line, patch);
                          setTimeout(() => handleBlur({ ...line, ...patch, _dirty: true } as DraftLine), 0);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {roastGroups.map(rg => (
                            <SelectItem key={rg.roast_group} value={rg.roast_group}>
                              {rg.display_name}{' '}
                              <span className="text-muted-foreground ml-1">({rg.roast_group_code})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {lowStock && (
                        <p className="text-[10px] text-amber-600 mt-1 flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          &lt; 20 kg on hand — confirm successor lot.
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={line.packaging_variant}
                        onValueChange={v => {
                          updateDraft(line, { packaging_variant: v });
                          setTimeout(() => handleBlur({ ...line, packaging_variant: v, _dirty: true } as DraftLine), 0);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VARIANT_OPTIONS.map(v => (
                            <SelectItem key={v.label} value={v.label}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <NumCell
                      value={line.green_markup_multiplier_override}
                      preset={preset.green_markup_multiplier}
                      decimals={3}
                      onChange={v => updateDraft(line, { green_markup_multiplier_override: v })}
                      onBlur={() => handleBlur(line)}
                    />
                    <NumCell
                      value={line.yield_loss_pct_override}
                      preset={preset.yield_loss_pct}
                      decimals={2}
                      onChange={v => updateDraft(line, { yield_loss_pct_override: v })}
                      onBlur={() => handleBlur(line)}
                    />
                    <NumCell
                      value={line.process_rate_per_kg_override}
                      preset={preset.process_rate_per_kg}
                      decimals={2}
                      onChange={v => updateDraft(line, { process_rate_per_kg_override: v })}
                      onBlur={() => handleBlur(line)}
                    />
                    <NumCell
                      value={line.overhead_per_kg_override}
                      preset={preset.overhead_per_kg}
                      decimals={2}
                      onChange={v => updateDraft(line, { overhead_per_kg_override: v })}
                      onBlur={() => handleBlur(line)}
                    />
                    <td className="px-2 py-2 min-w-[120px]">
                      <Input
                        type="number"
                        step="0.05"
                        className="h-8 text-xs"
                        value={line.wiggle_room_per_bag ?? ''}
                        onChange={e => updateDraft(line, {
                          wiggle_room_per_bag: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        onBlur={() => handleBlur(line)}
                      />
                      {line.wiggle_room_per_bag != null && line.wiggle_room_per_bag !== 0 && (
                        <Input
                          className="h-7 text-[11px] mt-1"
                          placeholder="Note (required)"
                          value={line.wiggle_room_note ?? ''}
                          onChange={e => updateDraft(line, { wiggle_room_note: e.target.value })}
                          onBlur={() => handleBlur(line)}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {greenMv != null ? (
                        <span>${greenMv.toFixed(2)}</span>
                      ) : (
                        <span className="text-muted-foreground">No data</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {drift.kind === 'none' && <span className="text-muted-foreground">—</span>}
                      {drift.kind === 'within' && <span className="text-muted-foreground">—</span>}
                      {drift.kind === 'change' && (
                        <span className={cn(
                          'font-medium',
                          drift.delta > 0 ? 'text-destructive' : 'text-green-600',
                        )}>
                          {drift.delta > 0 ? '+' : '−'}${Math.abs(drift.delta).toFixed(2)}/kg
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {preview ? (
                        <div className="text-[11px] leading-tight">
                          <div>Cost ${preview.cost.toFixed(2)}</div>
                          <div>Price ${preview.price.toFixed(2)}</div>
                          <div className={cn(
                            'font-medium',
                            preview.margin >= 30 && 'text-green-600',
                            preview.margin >= 15 && preview.margin < 30 && 'text-amber-600',
                            preview.margin < 15 && 'text-destructive',
                          )}>
                            {preview.margin.toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setConfirmDeleteId(line.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!confirmDeleteId} onOpenChange={o => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this row from the workspace?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmDeleteId) deleteLine.mutate(confirmDeleteId);
              setConfirmDeleteId(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumCell({
  value, preset, decimals, onChange, onBlur,
}: {
  value: number | null;
  preset: number;
  decimals: number;
  onChange: (v: number | null) => void;
  onBlur: () => void;
}) {
  const equalsPreset = value != null && Math.abs(value - preset) < 1e-9;
  const delta = value != null ? value - preset : 0;
  return (
    <td className="px-2 py-2 min-w-[90px]">
      <Input
        type="number"
        step="0.1"
        className="h-8 text-xs"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        onBlur={onBlur}
      />
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {value == null || equalsPreset
          ? `preset ${preset.toFixed(decimals)}`
          : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(decimals)}`}
      </div>
    </td>
  );
}

function stripPresetOverrides(line: DraftLine, preset: any) {
  if (!preset) return line;
  const eq = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;
  return {
    green_markup_multiplier_override: eq(line.green_markup_multiplier_override, preset.green_markup_multiplier)
      ? null : line.green_markup_multiplier_override,
    yield_loss_pct_override: eq(line.yield_loss_pct_override, preset.yield_loss_pct)
      ? null : line.yield_loss_pct_override,
    process_rate_per_kg_override: eq(line.process_rate_per_kg_override, preset.process_rate_per_kg)
      ? null : line.process_rate_per_kg_override,
    overhead_per_kg_override: eq(line.overhead_per_kg_override, preset.overhead_per_kg)
      ? null : line.overhead_per_kg_override,
  };
}

function computeDrift(current: number | null, saved: number | null) {
  if (saved == null || current == null) return { kind: 'none' as const, delta: 0 };
  const delta = current - saved;
  const pct = Math.abs(delta) / Math.max(saved, 1e-9);
  if (pct <= 0.05) return { kind: 'within' as const, delta };
  return { kind: 'change' as const, delta };
}

function computePreviewForLine(line: WorkspaceLine, preset: any, greenMv: number | null) {
  if (!preset || greenMv == null) return null;
  try {
    const variant = variantByLabel(line.packaging_variant);
    const greenMarkup = line.green_markup_multiplier_override ?? preset.green_markup_multiplier;
    const yieldLoss = line.yield_loss_pct_override ?? preset.yield_loss_pct;
    const processRate = line.process_rate_per_kg_override ?? preset.process_rate_per_kg;
    const overhead = line.overhead_per_kg_override ?? preset.overhead_per_kg;
    const wiggle = line.wiggle_room_per_bag ?? 0;
    const financing = computeFinancingCostPerKg(greenMv, preset.financing_apr_pct, preset.financing_days);
    const market = greenMv + financing;
    const derisked = computeDeriskedCostPerKg(market, preset.carry_risk_premium_pct);
    const markedUp = computeMarkedUpCostPerKg(derisked, greenMarkup);
    const roastedFromGreen = computeRoastedCostFromGreen(markedUp, yieldLoss);
    const totalPerKg = computeTotalRoastedCostPerKg(roastedFromGreen, processRate, overhead);
    const bagKg = variant.bagSizeG / 1000;
    const totalCostPerBag = totalPerKg * bagKg;
    const adj = applyTierAdjustment(totalCostPerBag, preset.tier, preset.target_margin_pct, bagKg);
    return { price: adj.final + wiggle };
  } catch {
    return null;
  }
}

function formatPrice(p: number | undefined) {
  if (p == null || !Number.isFinite(p)) return '—';
  return `$${p.toFixed(2)} CAD`;
}
