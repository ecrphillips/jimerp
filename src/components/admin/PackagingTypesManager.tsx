import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, GripVertical, Loader2, Package } from 'lucide-react';

interface PackagingType {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export function PackagingTypesManager() {
  const queryClient = useQueryClient();
  const [newTypeName, setNewTypeName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const { data: packagingTypes, isLoading } = useQuery({
    queryKey: ['packaging-types-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_types')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as PackagingType[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = packagingTypes?.reduce((max, t) => Math.max(max, t.display_order), 0) ?? 0;
      const { error } = await supabase
        .from('packaging_types')
        .insert({ name, display_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Packaging type added');
      queryClient.invalidateQueries({ queryKey: ['packaging-types-admin'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-types'] });
      setNewTypeName('');
    },
    onError: (err: any) => {
      if (err?.code === '23505') {
        toast.error('A packaging type with this name already exists');
      } else {
        toast.error('Failed to add packaging type');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PackagingType> }) => {
      const { error } = await supabase
        .from('packaging_types')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Packaging type updated');
      queryClient.invalidateQueries({ queryKey: ['packaging-types-admin'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-types'] });
      setEditingId(null);
      setEditingName('');
    },
    onError: (err: any) => {
      if (err?.code === '23505') {
        toast.error('A packaging type with this name already exists');
      } else {
        toast.error('Failed to update packaging type');
      }
    },
  });

  const handleAdd = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
  };

  const handleToggleActive = (type: PackagingType) => {
    updateMutation.mutate({
      id: type.id,
      updates: { is_active: !type.is_active },
    });
  };

  const handleStartRename = (type: PackagingType) => {
    setEditingId(type.id);
    setEditingName(type.name);
  };

  const handleSaveRename = () => {
    if (!editingId || !editingName.trim()) return;
    updateMutation.mutate({
      id: editingId,
      updates: { name: editingName.trim() },
    });
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Packaging Types
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Manage the list of packaging types available when creating products. 
          Inactive types won't be available for new products but remain visible on existing ones.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-2">
            {packagingTypes?.map((type) => (
              <div
                key={type.id}
                className={`flex items-center gap-3 p-3 border rounded-lg ${
                  !type.is_active ? 'bg-muted/50 opacity-60' : ''
                }`}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                
                {editingId === type.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename();
                        if (e.key === 'Escape') handleCancelRename();
                      }}
                    />
                    <Button size="sm" onClick={handleSaveRename} disabled={updateMutation.isPending}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancelRename}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <span 
                      className="flex-1 cursor-pointer hover:underline"
                      onClick={() => handleStartRename(type)}
                    >
                      {type.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`active-${type.id}`} className="text-xs text-muted-foreground">
                        Active
                      </Label>
                      <Switch
                        id={`active-${type.id}`}
                        checked={type.is_active}
                        onCheckedChange={() => handleToggleActive(type)}
                        disabled={updateMutation.isPending}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add new type */}
        <div className="flex items-center gap-2 pt-4 border-t">
          <Input
            placeholder="New packaging type name"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <Button 
            onClick={handleAdd} 
            disabled={!newTypeName.trim() || addMutation.isPending}
          >
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
