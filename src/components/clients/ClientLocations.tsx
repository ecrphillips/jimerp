import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, ChevronDown, MapPin } from 'lucide-react';

interface ClientLocation {
  id: string;
  client_id: string;
  name: string;
  location_code: string;
  is_active: boolean;
}

interface ClientLocationsProps {
  clientId: string;
  clientName: string;
}

// Generate a location code suggestion from name
function generateLocationCode(name: string): string {
  // Take first two consonants or letters
  const consonants = name.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  if (consonants.length >= 2) {
    return consonants.substring(0, 2);
  }
  // Fallback to first 2 letters
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters + 'XX').substring(0, 2);
}

export function ClientLocations({ clientId, clientName }: ClientLocationsProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ClientLocation | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [codeError, setCodeError] = useState('');

  const { data: locations, isLoading } = useQuery({
    queryKey: ['client-locations', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_locations')
        .select('id, client_id, name, location_code, is_active')
        .eq('client_id', clientId)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as ClientLocation[];
    },
  });

  const displayedLocations = useMemo(() => {
    if (!locations) return [];
    return showInactive ? locations : locations.filter(l => l.is_active);
  }, [locations, showInactive]);

  const inactiveCount = useMemo(() => {
    return locations?.filter(l => !l.is_active).length ?? 0;
  }, [locations]);

  const existingCodes = useMemo(() => {
    return (locations ?? [])
      .filter(l => editingLocation ? l.id !== editingLocation.id : true)
      .map(l => l.location_code);
  }, [locations, editingLocation]);

  const isCodeUnique = useMemo(() => {
    if (!formCode) return true;
    return !existingCodes.includes(formCode.toUpperCase());
  }, [formCode, existingCodes]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormCode('');
    setFormIsActive(true);
    setCodeError('');
    setEditingLocation(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((location: ClientLocation) => {
    setEditingLocation(location);
    setFormName(location.name);
    setFormCode(location.location_code);
    setFormIsActive(location.is_active);
    setCodeError('');
    setShowDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowDialog(false);
    resetForm();
  }, [resetForm]);

  const handleNameChange = useCallback((newName: string) => {
    setFormName(newName);
    if (!editingLocation && newName.length >= 2) {
      const suggested = generateLocationCode(newName);
      if (!formCode || formCode === generateLocationCode(formName)) {
        if (!existingCodes.includes(suggested)) {
          setFormCode(suggested);
        }
      }
    }
  }, [editingLocation, formCode, formName, existingCodes]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const code = formCode.toUpperCase().trim();
      
      const { error } = await supabase
        .from('client_locations')
        .insert({
          client_id: clientId,
          name: formName.trim(),
          location_code: code,
          is_active: formIsActive,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Location created');
      queryClient.invalidateQueries({ queryKey: ['client-locations', clientId] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create location');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingLocation) return;
      const code = formCode.toUpperCase().trim();
      
      const { error } = await supabase
        .from('client_locations')
        .update({
          name: formName.trim(),
          location_code: code,
          is_active: formIsActive,
        })
        .eq('id', editingLocation.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Location updated');
      queryClient.invalidateQueries({ queryKey: ['client-locations', clientId] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update location');
    },
  });

  const handleSubmit = () => {
    if (!formName.trim()) {
      toast.error('Location name is required');
      return;
    }
    if (!formCode.trim()) {
      toast.error('Location code is required');
      return;
    }
    if (formCode.trim().length < 2) {
      toast.error('Location code must be at least 2 characters');
      return;
    }
    if (!isCodeUnique) {
      setCodeError(`Location code "${formCode.toUpperCase()}" is already in use for this client`);
      return;
    }

    if (editingLocation) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <MapPin className="h-3 w-3" />
            <span className="text-xs">
              {locations?.filter(l => l.is_active).length ?? 0} location(s)
            </span>
            <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 ml-4 pl-4 border-l-2 border-muted">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Locations</span>
            <div className="flex items-center gap-2">
              {inactiveCount > 0 && (
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <Checkbox
                    checked={showInactive}
                    onCheckedChange={(checked) => setShowInactive(!!checked)}
                    className="h-3 w-3"
                  />
                  <span className="text-muted-foreground">+{inactiveCount} inactive</span>
                </label>
              )}
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={openCreateDialog}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
          </div>
          
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : displayedLocations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No locations yet.</p>
          ) : (
            <ul className="space-y-1">
              {displayedLocations.map((loc) => (
                <li key={loc.id} className={`flex items-center justify-between py-1 ${!loc.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs h-5 px-1.5">
                      {loc.location_code}
                    </Badge>
                    <span className="text-sm">{loc.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditDialog(loc)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingLocation ? 'Edit Location' : 'Add Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="locName">Location Name *</Label>
              <Input
                id="locName"
                value={formName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Langley, Downtown"
              />
            </div>

            <div>
              <Label htmlFor="locCode">Location Code *</Label>
              <Input
                id="locCode"
                value={formCode}
                onChange={(e) => {
                  setFormCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 4));
                  setCodeError('');
                }}
                placeholder="LY"
                className="font-mono"
                maxLength={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                2-4 letters. Used in order numbers.
              </p>
              {codeError && (
                <p className="text-xs text-destructive mt-1">{codeError}</p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="locActive"
                checked={formIsActive}
                onCheckedChange={(checked) => setFormIsActive(!!checked)}
              />
              <Label htmlFor="locActive" className="cursor-pointer">Active</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isPending || !isCodeUnique}>
                {isPending ? 'Saving…' : editingLocation ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
