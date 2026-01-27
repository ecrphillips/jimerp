import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type DefaultRoaster = Database['public']['Enums']['default_roaster'];

interface RoastGroup {
  roast_group: string;
  roast_group_code: string;
  standard_batch_kg: number;
  expected_yield_loss_pct: number;
  default_roaster: DefaultRoaster;
  is_active: boolean;
  is_blend: boolean;
  origin: string | null;
  blend_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const ROASTERS: DefaultRoaster[] = ['SAMIAC', 'LORING', 'EITHER'];

export function RoastGroupsTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RoastGroup | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Form state
  const [roastGroupName, setRoastGroupName] = useState('');
  const [roastGroupCode, setRoastGroupCode] = useState('');
  const [standardBatchKg, setStandardBatchKg] = useState(20);
  const [yieldLossPct, setYieldLossPct] = useState(16);
  const [defaultRoaster, setDefaultRoaster] = useState<DefaultRoaster>('EITHER');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  const { data: roastGroups, isLoading } = useQuery({
    queryKey: ['all-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('*')
        .order('roast_group');

      if (error) throw error;
      return (data ?? []) as RoastGroup[];
    },
  });

  const displayedGroups = React.useMemo(() => {
    if (!roastGroups) return [];
    return showInactive ? roastGroups : roastGroups.filter((g) => g.is_active);
  }, [roastGroups, showInactive]);

  const inactiveCount = React.useMemo(() => {
    return roastGroups?.filter((g) => !g.is_active).length ?? 0;
  }, [roastGroups]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const groupName = roastGroupName.trim().toUpperCase().replace(/\s+/g, '_');
      const code = roastGroupCode.trim().toUpperCase() || groupName.replace(/[^A-Z]/g, '').substring(0, 3);
      
      if (editingGroup) {
        const { error } = await supabase
          .from('roast_groups')
          .update({
            standard_batch_kg: standardBatchKg,
            expected_yield_loss_pct: yieldLossPct,
            default_roaster: defaultRoaster,
            is_active: isActive,
            notes: notes || null,
          })
          .eq('roast_group', editingGroup.roast_group);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('roast_groups').insert({
          roast_group: groupName,
          roast_group_code: code,
          standard_batch_kg: standardBatchKg,
          expected_yield_loss_pct: yieldLossPct,
          default_roaster: defaultRoaster,
          is_active: isActive,
          notes: notes || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingGroup ? 'Roast group updated' : 'Roast group created');
      queryClient.invalidateQueries({ queryKey: ['all-roast-groups'] });
      closeDialog();
    },
    onError: (err: any) => {
      console.error(err);
      if (err?.code === '23505') {
        toast.error('A roast group with this name already exists');
      } else {
        toast.error('Failed to save roast group');
      }
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ name, active }: { name: string; active: boolean }) => {
      const { error } = await supabase
        .from('roast_groups')
        .update({ is_active: active })
        .eq('roast_group', name);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-roast-groups'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update status');
    },
  });

  const openNew = () => {
    setEditingGroup(null);
    setRoastGroupName('');
    setStandardBatchKg(20);
    setYieldLossPct(16);
    setDefaultRoaster('EITHER');
    setIsActive(true);
    setNotes('');
    setDialogOpen(true);
  };

  const openEdit = (g: RoastGroup) => {
    setEditingGroup(g);
    setRoastGroupName(g.roast_group);
    setStandardBatchKg(g.standard_batch_kg);
    setYieldLossPct(g.expected_yield_loss_pct);
    setDefaultRoaster(g.default_roaster);
    setIsActive(g.is_active);
    setNotes(g.notes ?? '');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingGroup(null);
  };

  const getRoasterBadgeColor = (roaster: DefaultRoaster) => {
    switch (roaster) {
      case 'SAMIAC':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'LORING':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Roast Group
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Roast Groups</CardTitle>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(!!checked)}
              />
              Show inactive ({inactiveCount})
            </label>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : displayedGroups.length === 0 ? (
            <p className="text-muted-foreground">No roast groups configured.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Roast Group</th>
                  <th className="pb-2 text-right">Batch Size (kg)</th>
                  <th className="pb-2 text-right">Yield Loss %</th>
                  <th className="pb-2">Default Roaster</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayedGroups.map((g) => (
                  <tr
                    key={g.roast_group}
                    className={`border-b last:border-0 ${!g.is_active ? 'opacity-60' : ''}`}
                  >
                    <td className="py-2 font-medium font-mono">{g.roast_group}</td>
                    <td className="py-2 text-right">{g.standard_batch_kg}</td>
                    <td className="py-2 text-right">{g.expected_yield_loss_pct}%</td>
                    <td className="py-2">
                      <Badge variant="secondary" className={getRoasterBadgeColor(g.default_roaster)}>
                        {g.default_roaster}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => toggleActiveMutation.mutate({ name: g.roast_group, active: !g.is_active })}
                        className={`text-xs px-2 py-1 rounded transition-colors ${
                          g.is_active
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {g.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="py-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(g)} className="gap-1">
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit Roast Group' : 'New Roast Group'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="groupName">Roast Group Name</Label>
              <Input
                id="groupName"
                value={roastGroupName}
                onChange={(e) => setRoastGroupName(e.target.value)}
                placeholder="e.g. MEDIUM_ESPRESSO"
                disabled={!!editingGroup}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {editingGroup
                  ? 'Name cannot be changed after creation.'
                  : 'Will be converted to UPPERCASE_SNAKE_CASE.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="batchKg">Standard Batch (kg)</Label>
                <Input
                  id="batchKg"
                  type="number"
                  min={1}
                  max={100}
                  value={standardBatchKg}
                  onChange={(e) => setStandardBatchKg(parseInt(e.target.value) || 20)}
                />
              </div>
              <div>
                <Label htmlFor="yieldLoss">Expected Yield Loss (%)</Label>
                <Input
                  id="yieldLoss"
                  type="number"
                  min={0}
                  max={50}
                  step={0.1}
                  value={yieldLossPct}
                  onChange={(e) => setYieldLossPct(parseFloat(e.target.value) || 16)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="roaster">Default Roaster</Label>
              <Select value={defaultRoaster} onValueChange={(v) => setDefaultRoaster(v as DefaultRoaster)}>
                <SelectTrigger id="roaster">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROASTERS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions..."
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="active"
                checked={isActive}
                onCheckedChange={(c) => setIsActive(!!c)}
              />
              <Label htmlFor="active">Active</Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !roastGroupName.trim()}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
