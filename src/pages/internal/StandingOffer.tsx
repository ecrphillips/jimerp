import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Copy, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Line {
  id: string;
  account_id: string;
  roast_group: string | null;
  client_facing_name: string;
  price_per_bag: number;
  sort_order: number;
  notes: string | null;
}

interface DraftLine extends Line {
  _isNew?: boolean;
  _dirty?: boolean;
}

export default function StandingOffer() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: account, isLoading: accountLoading, error: accountError } = useQuery({
    queryKey: ['amplified-account'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .ilike('account_name', '%amplified%')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const accountId = account?.id;

  const { data: roastGroups = [] } = useQuery({
    queryKey: ['active-roast-groups'],
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

  const { data: lines = [], refetch: refetchLines } = useQuery({
    queryKey: ['standing-offer-lines', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('standing_offer_lines')
        .select('*')
        .eq('account_id', accountId!)
        .order('sort_order');
      if (error) throw error;
      return data as Line[];
    },
  });

  const { data: session, refetch: refetchSession } = useQuery({
    queryKey: ['standing-offer-session', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('standing_offer_sessions')
        .select('last_updated_at, last_updated_by')
        .eq('account_id', accountId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lastEditor } = useQuery({
    queryKey: ['profile', session?.last_updated_by],
    enabled: !!session?.last_updated_by,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('id', session!.last_updated_by!)
        .maybeSingle();
      return data;
    },
  });

  // Inventory totals per roast group
  const { data: inventoryByGroup = {} } = useQuery({
    queryKey: ['roast-group-green-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select('roast_group, green_lots(kg_on_hand)');
      if (error) throw error;
      const totals: Record<string, number> = {};
      for (const row of data as any[]) {
        const kg = Number(row.green_lots?.kg_on_hand ?? 0) || 0;
        totals[row.roast_group] = (totals[row.roast_group] ?? 0) + kg;
      }
      return totals;
    },
  });

  // Merge server lines with drafts
  const merged: DraftLine[] = useMemo(() => {
    const draftIds = new Set(Object.keys(drafts));
    const fromServer = lines.map(l => drafts[l.id] ?? l);
    const newOnes = Object.values(drafts).filter(d => d._isNew && !lines.some(l => l.id === d.id));
    return [...fromServer, ...newOnes].sort((a, b) => a.sort_order - b.sort_order);
  }, [lines, drafts]);

  const upsertMutation = useMutation({
    mutationFn: async (line: DraftLine) => {
      if (!accountId) throw new Error('No account');
      const payload: any = {
        account_id: accountId,
        roast_group: line.roast_group,
        client_facing_name: line.client_facing_name,
        price_per_bag: line.price_per_bag,
        sort_order: line.sort_order,
        notes: line.notes,
      };
      if (line._isNew) {
        const { data, error } = await supabase
          .from('standing_offer_lines')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { newId: data.id, oldId: line.id };
      } else {
        const { error } = await supabase
          .from('standing_offer_lines')
          .update(payload)
          .eq('id', line.id);
        if (error) throw error;
        return { newId: line.id, oldId: line.id };
      }
    },
    onSuccess: async ({ newId, oldId }) => {
      // Update session
      await supabase.from('standing_offer_sessions').upsert({
        account_id: accountId!,
        last_updated_at: new Date().toISOString(),
        last_updated_by: (await supabase.auth.getUser()).data.user?.id,
      }, { onConflict: 'account_id' });
      setDrafts(prev => {
        const next = { ...prev };
        delete next[oldId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['standing-offer-lines', accountId] });
      qc.invalidateQueries({ queryKey: ['standing-offer-session', accountId] });
      setSavingState('saved');
      setTimeout(() => setSavingState('idle'), 1500);
    },
    onError: (e: any) => {
      setSavingState('idle');
      toast.error(`Save failed: ${e.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const draft = drafts[id];
      if (draft?._isNew) {
        return; // not yet saved
      }
      const { error } = await supabase.from('standing_offer_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async (_, id) => {
      setDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await supabase.from('standing_offer_sessions').upsert({
        account_id: accountId!,
        last_updated_at: new Date().toISOString(),
        last_updated_by: (await supabase.auth.getUser()).data.user?.id,
      }, { onConflict: 'account_id' });
      qc.invalidateQueries({ queryKey: ['standing-offer-lines', accountId] });
      qc.invalidateQueries({ queryKey: ['standing-offer-session', accountId] });
      toast.success('Row removed');
    },
  });

  const updateDraft = (line: DraftLine, patch: Partial<DraftLine>) => {
    setDrafts(prev => ({
      ...prev,
      [line.id]: { ...line, ...patch, _dirty: true },
    }));
  };

  const handleBlur = (line: DraftLine) => {
    const draft = drafts[line.id];
    if (!draft || !draft._dirty) return;
    if (!draft.client_facing_name?.trim()) return;
    if (draft.price_per_bag == null || isNaN(Number(draft.price_per_bag))) return;
    setSavingState('saving');
    upsertMutation.mutate(draft);
  };

  const addRow = () => {
    if (!accountId) return;
    const tempId = `new-${Date.now()}`;
    const maxOrder = merged.reduce((m, l) => Math.max(m, l.sort_order), -1);
    setDrafts(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        account_id: accountId,
        roast_group: null,
        client_facing_name: '',
        price_per_bag: 0,
        sort_order: maxOrder + 1,
        notes: null,
        _isNew: true,
        _dirty: false,
      },
    }));
  };

  const copyAsText = async () => {
    const rows = merged.filter(l => l.client_facing_name?.trim());
    const headers = ['Product', 'Price (5lb bag)'];
    const data = rows.map(r => [r.client_facing_name, `$${Number(r.price_per_bag).toFixed(2)} CAD`]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...data.map(r => r[i].length))
    );
    const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);
    const headerLine = headers.map((h, i) => pad(h, widths[i])).join('  |  ');
    const sep = widths.map(w => '-'.repeat(w)).join('--+--');
    const body = data.map(r => r.map((c, i) => pad(c, widths[i])).join('  |  ')).join('\n');
    const text = `${headerLine}\n${sep}\n${body}\n\nAll prices in CAD. 5lb bags only.`;
    await navigator.clipboard.writeText(text);
    toast.success('Offer copied to clipboard.');
  };

  if (accountLoading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }
  if (accountError || !account) {
    return (
      <div className="p-8">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-destructive">
          Amplified account not found. Check the account name in the system.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Amplified — Standing Offer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly offer sheet for Amplified Coffee. Changes are saved automatically.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {session?.last_updated_at ? (
              <>
                Last updated {formatDistanceToNow(new Date(session.last_updated_at), { addSuffix: true })}
                {lastEditor?.name ? ` by ${lastEditor.name}` : lastEditor?.email ? ` by ${lastEditor.email}` : ''}
              </>
            ) : (
              'No offer saved yet.'
            )}
            {savingState !== 'idle' && (
              <span className="ml-3 text-primary">
                {savingState === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
          </p>
        </div>
        <Button onClick={copyAsText} className="gap-2">
          <Copy className="h-4 w-4" />
          Copy offer as text
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3 font-medium">Product name</th>
              <th className="p-3 font-medium w-56">Roast group <span className="text-xs font-normal text-muted-foreground">(internal)</span></th>
              <th className="p-3 font-medium w-40">Price (5lb bag)</th>
              <th className="p-3 font-medium w-56">Internal note</th>
              <th className="p-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {merged.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No rows yet. Click "+ Add row" to start.</td></tr>
            )}
            {merged.map(line => {
              const nameMissing = !line.client_facing_name?.trim();
              const priceMissing = line.price_per_bag == null || Number(line.price_per_bag) <= 0;
              const totalKg = line.roast_group ? (inventoryByGroup[line.roast_group] ?? 0) : null;
              const lowStock = totalKg !== null && totalKg < 20;
              return (
                <tr key={line.id} className="border-t align-top">
                  <td className="p-3">
                    <Input
                      value={line.client_facing_name}
                      onChange={e => updateDraft(line, { client_facing_name: e.target.value })}
                      onBlur={() => handleBlur(line)}
                      placeholder="e.g. House Espresso"
                      className={nameMissing ? 'border-destructive focus-visible:ring-destructive' : ''}
                    />
                  </td>
                  <td className="p-3">
                    <Select
                      value={line.roast_group ?? ''}
                      onValueChange={v => {
                        updateDraft(line, { roast_group: v });
                        // trigger save shortly
                        setTimeout(() => handleBlur({ ...line, roast_group: v, _dirty: true } as any), 0);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {roastGroups.map(rg => (
                          <SelectItem key={rg.roast_group} value={rg.roast_group}>
                            {rg.display_name} <span className="text-muted-foreground ml-1">({rg.roast_group_code})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lowStock && (
                      <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        Less than 20 kg on hand — confirm successor lot is lined up.
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.price_per_bag ?? ''}
                      onChange={e => updateDraft(line, { price_per_bag: parseFloat(e.target.value) || 0 })}
                      onBlur={() => handleBlur(line)}
                      className={priceMissing ? 'border-destructive focus-visible:ring-destructive' : ''}
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      value={line.notes ?? ''}
                      onChange={e => updateDraft(line, { notes: e.target.value })}
                      onBlur={() => handleBlur(line)}
                      placeholder="Optional"
                    />
                  </td>
                  <td className="p-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDeleteId(line.id)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button variant="outline" onClick={addRow} className="gap-2">
        <Plus className="h-4 w-4" />
        Add row
      </Button>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this row from the offer?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmDeleteId) deleteMutation.mutate(confirmDeleteId);
              setConfirmDeleteId(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
