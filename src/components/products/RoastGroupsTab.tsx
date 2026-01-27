import React, { useState, useCallback } from 'react';
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
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { SafeDeleteModal } from '@/components/SafeDeleteModal';

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
  display_name: string | null;
  cropster_profile_ref: string | null;
  created_at: string;
  updated_at: string;
}

const ROASTERS: DefaultRoaster[] = ['SAMIAC', 'LORING', 'EITHER'];

export function RoastGroupsTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RoastGroup | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<RoastGroup | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{
    products: number;
    batches: number;
    open_orders: number;
  } | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [standardBatchKg, setStandardBatchKg] = useState(20);
  const [yieldLossPct, setYieldLossPct] = useState(16);
  const [defaultRoaster, setDefaultRoaster] = useState<DefaultRoaster>('EITHER');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [cropsterProfileRef, setCropsterProfileRef] = useState('');
  const [displayNameError, setDisplayNameError] = useState('');

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

  // Generate a unique system key from display name
  const generateSystemKey = async (name: string): Promise<string> => {
    const baseKey = name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    
    // Check if base key exists
    const { data: existing } = await supabase
      .from('roast_groups')
      .select('roast_group')
      .like('roast_group', `${baseKey}%`);
    
    if (!existing || existing.length === 0) {
      return baseKey;
    }
    
    // Check if exact base key is taken
    const exactMatch = existing.find(e => e.roast_group === baseKey);
    if (!exactMatch) {
      return baseKey;
    }
    
    // Find next available suffix
    let suffix = 2;
    while (existing.some(e => e.roast_group === `${baseKey}${suffix}`)) {
      suffix++;
    }
    return `${baseKey}${suffix}`;
  };

  // Validate display name uniqueness
  const validateDisplayName = async (name: string, excludeKey?: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setDisplayNameError('Display name is required');
      return false;
    }
    
    let query = supabase
      .from('roast_groups')
      .select('roast_group, display_name')
      .ilike('display_name', trimmed);
    
    if (excludeKey) {
      query = query.neq('roast_group', excludeKey);
    }
    
    const { data } = await query;
    
    if (data && data.length > 0) {
      setDisplayNameError('A roast group with this display name already exists. Reactivate or choose a different name.');
      return false;
    }
    
    setDisplayNameError('');
    return true;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedDisplayName = displayName.trim();
      
      // Validate display name uniqueness
      const isValid = await validateDisplayName(
        trimmedDisplayName, 
        editingGroup?.roast_group
      );
      if (!isValid) {
        throw new Error('Display name validation failed');
      }
      
      if (editingGroup) {
        const { error } = await supabase
          .from('roast_groups')
          .update({
            display_name: trimmedDisplayName,
            standard_batch_kg: standardBatchKg,
            expected_yield_loss_pct: yieldLossPct,
            default_roaster: defaultRoaster,
            is_active: isActive,
            notes: notes || null,
            cropster_profile_ref: cropsterProfileRef.trim() || null,
          })
          .eq('roast_group', editingGroup.roast_group);
        if (error) throw error;
      } else {
        // Generate unique system key
        const systemKey = await generateSystemKey(trimmedDisplayName);
        const code = systemKey.replace(/[^A-Z0-9]/g, '').substring(0, 3);
        
        const { error } = await supabase.from('roast_groups').insert({
          roast_group: systemKey,
          roast_group_code: code,
          display_name: trimmedDisplayName,
          standard_batch_kg: standardBatchKg,
          expected_yield_loss_pct: yieldLossPct,
          default_roaster: defaultRoaster,
          is_active: isActive,
          notes: notes || null,
          cropster_profile_ref: cropsterProfileRef.trim() || null,
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
      if (err?.message === 'Display name validation failed') {
        // Error already shown via displayNameError state
        return;
      }
      if (err?.code === '23505') {
        if (err?.message?.includes('display_name')) {
          setDisplayNameError('A roast group with this display name already exists. Reactivate or choose a different name.');
        } else {
          toast.error('A roast group with this name already exists');
        }
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

  // Delete preflight mutation
  const deletePreflightMutation = useMutation({
    mutationFn: async (roastGroup: string) => {
      const { data, error } = await supabase.rpc('get_roast_group_delete_preflight', {
        p_roast_group: roastGroup,
      });
      if (error) throw error;
      return data as {
        products: number;
        batches: number;
        open_orders: number;
      };
    },
    onSuccess: (data, roastGroup) => {
      const group = roastGroups?.find(g => g.roast_group === roastGroup);
      if (group) {
        setDeletingGroup(group);
        setDeleteCounts(data);
        // Block if products exist
        if (data.products > 0) {
          setIsBlocked(true);
          setBlockedMessage('This roast group still has products. Move products to another roast group or delete the products first.');
        } else {
          setIsBlocked(false);
          setBlockedMessage('');
        }
        setShowDeleteModal(true);
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to check roast group references');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!deletingGroup) throw new Error('No roast group selected');
      const { data, error } = await supabase.rpc('delete_roast_group_safe', {
        p_roast_group: deletingGroup.roast_group,
        p_force: force,
      });
      if (error) throw error;
      return data as { deleted: boolean; blocked?: boolean; message: string };
    },
    onSuccess: (data) => {
      if (data.deleted) {
        toast.success('Roast group deleted');
        queryClient.invalidateQueries({ queryKey: ['all-roast-groups'] });
      } else if (data.blocked) {
        toast.error(data.message);
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to delete roast group');
    },
  });

  // Set inactive mutation
  const setInactiveMutation = useMutation({
    mutationFn: async () => {
      if (!deletingGroup) throw new Error('No roast group selected');
      const { error } = await supabase
        .from('roast_groups')
        .update({ is_active: false })
        .eq('roast_group', deletingGroup.roast_group);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Roast group set to inactive');
      queryClient.invalidateQueries({ queryKey: ['all-roast-groups'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to set roast group inactive');
    },
  });

  const openDeleteDialog = useCallback((g: RoastGroup) => {
    deletePreflightMutation.mutate(g.roast_group);
  }, [deletePreflightMutation]);

  const openNew = () => {
    setEditingGroup(null);
    setDisplayName('');
    setDisplayNameError('');
    setStandardBatchKg(20);
    setYieldLossPct(16);
    setDefaultRoaster('EITHER');
    setIsActive(true);
    setNotes('');
    setCropsterProfileRef('');
    setDialogOpen(true);
  };

  const openEdit = (g: RoastGroup) => {
    setEditingGroup(g);
    setDisplayName(g.display_name);
    setDisplayNameError('');
    setStandardBatchKg(g.standard_batch_kg);
    setYieldLossPct(g.expected_yield_loss_pct);
    setDefaultRoaster(g.default_roaster);
    setIsActive(g.is_active);
    setNotes(g.notes ?? '');
    setCropsterProfileRef(g.cropster_profile_ref ?? '');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingGroup(null);
    setDisplayNameError('');
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
                    <td className="py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{g.display_name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{g.roast_group}</span>
                      </div>
                    </td>
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
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(g)} className="gap-1">
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => openDeleteDialog(g)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDisplayNameError('');
                }}
                placeholder="e.g. Catalogue Espresso"
                className={displayNameError ? 'border-destructive' : ''}
              />
              {displayNameError ? (
                <p className="text-xs text-destructive mt-1">{displayNameError}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  {editingGroup 
                    ? 'The friendly name shown everywhere. Must be unique.'
                    : 'A unique name for this roast group. The system key will be auto-generated.'}
                </p>
              )}
            </div>

            {editingGroup && (
              <div>
                <Label className="text-muted-foreground">System Key (read-only)</Label>
                <p className="font-mono text-sm py-2 px-3 bg-muted rounded-md">{editingGroup.roast_group}</p>
              </div>
            )}


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
              <Label htmlFor="cropsterRef">Cropster Profile Ref (optional)</Label>
              <Input
                id="cropsterRef"
                value={cropsterProfileRef}
                onChange={(e) => setCropsterProfileRef(e.target.value)}
                placeholder="e.g. R-1234 or profile name"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Reference to a Cropster roast profile for traceability.
              </p>
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
                disabled={saveMutation.isPending || !displayName.trim()}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Safe Delete Modal */}
      <SafeDeleteModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        entityType="roast_group"
        entityName={deletingGroup?.display_name ?? ''}
        counts={deleteCounts}
        isBlocked={isBlocked}
        blockedMessage={blockedMessage}
        isLoading={deleteMutation.isPending || setInactiveMutation.isPending}
        onSetInactive={() => setInactiveMutation.mutate()}
        onConfirmDelete={() => deleteMutation.mutate(true)}
      />
    </div>
  );
}
