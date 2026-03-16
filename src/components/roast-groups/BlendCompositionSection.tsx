import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  roastGroupKey: string;
}

interface ComponentRow {
  id: string | null; // null = newly added
  component_roast_group: string;
  pct: number;
  display_order: number;
}

export function BlendCompositionSection({ roastGroupKey }: Props) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ComponentRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newComponent, setNewComponent] = useState('');
  const [newPct, setNewPct] = useState(0);

  // Fetch current components
  const { data: components, isLoading } = useQuery({
    queryKey: ['roast-group-components', roastGroupKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_group_components')
        .select('*')
        .eq('parent_roast_group', roastGroupKey)
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
    meta: {
      onSuccess: (data: any[]) => {
        setRows(data.map(c => ({
          id: c.id,
          component_roast_group: c.component_roast_group,
          pct: c.pct,
          display_order: c.display_order,
        })));
        setDirty(false);
      },
    },
  });

  // Sync rows when components load
  React.useEffect(() => {
    if (components && !dirty) {
      setRows(components.map(c => ({
        id: c.id,
        component_roast_group: c.component_roast_group,
        pct: c.pct,
        display_order: c.display_order,
      })));
    }
  }, [components, dirty]);

  // Fetch all active roast groups for dropdown
  const { data: allGroups = [] } = useQuery({
    queryKey: ['roast-groups-active-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name')
        .eq('is_active', true)
        .order('display_name');
      return data ?? [];
    },
  });

  const usedKeys = new Set(rows.map(r => r.component_roast_group));
  const availableGroups = allGroups.filter(
    g => g.roast_group !== roastGroupKey && !usedKeys.has(g.roast_group)
  );

  const total = rows.reduce((s, r) => s + (r.pct || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;

  const updatePct = (idx: number, pct: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, pct } : r));
    setDirty(true);
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const addComponent = () => {
    if (!newComponent) return;
    setRows(prev => [...prev, {
      id: null,
      component_roast_group: newComponent,
      pct: newPct,
      display_order: prev.length,
    }]);
    setNewComponent('');
    setNewPct(0);
    setAdding(false);
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Delete all existing, then insert current rows
      await supabase
        .from('roast_group_components')
        .delete()
        .eq('parent_roast_group', roastGroupKey);

      if (rows.length > 0) {
        const { error } = await supabase
          .from('roast_group_components')
          .insert(rows.map((r, i) => ({
            parent_roast_group: roastGroupKey,
            component_roast_group: r.component_roast_group,
            pct: r.pct,
            display_order: i,
          })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Blend composition saved');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['roast-group-components', roastGroupKey] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save'),
  });

  const getName = (key: string) => {
    const g = allGroups.find(g => g.roast_group === key);
    return g?.display_name ?? key;
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Blend Composition</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {rows.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground">No components defined yet.</p>
            )}

            {rows.map((row, idx) => (
              <div key={row.component_roast_group} className="flex items-center gap-3">
                <span className="text-sm flex-1 truncate">{getName(row.component_roast_group)}</span>
                <Input
                  type="number"
                  className="w-20"
                  value={row.pct}
                  onChange={e => updatePct(idx, Number(e.target.value))}
                  min={0}
                  max={100}
                  step={0.5}
                />
                <span className="text-xs text-muted-foreground">%</span>
                <Button variant="ghost" size="icon" onClick={() => removeRow(idx)} className="h-8 w-8">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}

            {/* Running total */}
            {rows.length > 0 && (
              <div className={cn(
                'flex items-center gap-2 text-sm font-medium pt-1',
                totalOk ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
              )}>
                {totalOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                Total: {total.toFixed(1)}%
              </div>
            )}

            {/* Add component inline */}
            {adding ? (
              <div className="flex items-end gap-2 pt-2 border-t">
                <div className="flex-1">
                  <Select value={newComponent} onValueChange={setNewComponent}>
                    <SelectTrigger><SelectValue placeholder="Select component" /></SelectTrigger>
                    <SelectContent>
                      {availableGroups.map(g => (
                        <SelectItem key={g.roast_group} value={g.roast_group}>
                          {getDisplayName(g.display_name, g.roast_group)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" className="w-20" value={newPct} onChange={e => setNewPct(Number(e.target.value))} min={0} max={100} placeholder="%" />
                <Button size="sm" onClick={addComponent} disabled={!newComponent}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Component
              </Button>
            )}

            {dirty && (
              <div className="flex justify-end pt-2 border-t">
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Composition
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
