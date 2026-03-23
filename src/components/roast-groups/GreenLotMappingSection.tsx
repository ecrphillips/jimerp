import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Unlink, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  roastGroupKey: string;
}

export function GreenLotMappingSection({ roastGroupKey }: Props) {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const [selectedLot, setSelectedLot] = useState('');
  const [linkPct, setLinkPct] = useState<string>('');

  // Fetch linked lots
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['roast-group-lot-links', roastGroupKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          id,
          lot_id,
          pct_of_lot,
          green_lots (
            id, lot_number, status, kg_on_hand,
            green_contracts ( origin )
          )
        `)
        .eq('roast_group', roastGroupKey);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch available lots for linking
  const { data: availableLots = [] } = useQuery({
    queryKey: ['green-lots-for-linking', roastGroupKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('green_lots')
        .select('id, lot_number, status, kg_on_hand')
        .not('status', 'eq', 'EXHAUSTED')
        .order('lot_number');
      return data ?? [];
    },
    enabled: linking,
  });

  const linkedLotIds = new Set(links.map((l: any) => l.lot_id));
  const filteredAvailable = availableLots.filter(l => !linkedLotIds.has(l.id));

  const linkMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .insert({
          roast_group: roastGroupKey,
          lot_id: selectedLot,
          pct_of_lot: linkPct ? Number(linkPct) : null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lot linked');
      setLinking(false);
      setSelectedLot('');
      setLinkPct('');
      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to link lot'),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .delete()
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lot unlinked');
      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to unlink'),
  });

  const updatePctMutation = useMutation({
    mutationFn: async ({ linkId, pct }: { linkId: string; pct: number | null }) => {
      const { error } = await supabase
        .from('green_lot_roast_group_links')
        .update({ pct_of_lot: pct })
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
    },
  });

  const statusColor = (status: string) => {
    if (status === 'EN_ROUTE') return 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300';
    if (status === 'RECEIVED') return 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300';
    return 'border-border text-muted-foreground';
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Green Lot Mapping</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : links.length === 0 && !linking ? (
          <p className="text-sm text-muted-foreground">No green lots linked.</p>
        ) : (
          <div className="space-y-2">
            {links.map((link: any) => {
              const lot = link.green_lots;
              if (!lot) return null;
              const origin = lot.green_contracts?.origin;
              return (
                <div key={link.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{lot.lot_number}</span>
                      {origin && <span className="text-xs text-muted-foreground">{origin}</span>}
                      <Badge variant="outline" className={cn('text-[10px]', statusColor(lot.status))}>
                        {lot.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{Number(lot.kg_on_hand).toFixed(1)} kg on hand</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      className="w-20 h-8 text-xs"
                      placeholder="% lot"
                      defaultValue={link.pct_of_lot ?? ''}
                      onBlur={e => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        if (val !== link.pct_of_lot) {
                          updatePctMutation.mutate({ linkId: link.id, pct: val });
                        }
                      }}
                      min={0}
                      max={100}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => unlinkMutation.mutate(link.id)}>
                    <Unlink className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {linking ? (
          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex-1">
              <Select value={selectedLot} onValueChange={setSelectedLot}>
                <SelectTrigger><SelectValue placeholder="Select lot" /></SelectTrigger>
                <SelectContent>
                  {filteredAvailable.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.lot_number} ({l.status}, {Number(l.kg_on_hand).toFixed(0)} kg)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input type="number" className="w-20" value={linkPct} onChange={e => setLinkPct(e.target.value)} placeholder="%" min={0} max={100} />
            <Button size="sm" onClick={() => linkMutation.mutate()} disabled={!selectedLot || linkMutation.isPending}>
              {linkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setLinking(true)}>
            <Plus className="h-4 w-4 mr-1" /> Link Lot
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
