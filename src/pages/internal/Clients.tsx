import React, { useState, useMemo, useCallback } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { ClientLocations } from '@/components/clients/ClientLocations';
import { ClientOrderingConstraints } from '@/components/clients/ClientOrderingConstraints';
import { ClientAccountNotes } from '@/components/crm/ClientAccountNotes';
import { BriefMeButton } from '@/components/crm/BriefMeModal';
import { SafeDeleteModal } from '@/components/SafeDeleteModal';

interface Client {
  id: string;
  name: string;
  client_code: string;
  billing_email: string | null;
  billing_contact_name: string | null;
  shipping_address: string | null;
  is_active: boolean;
  notes_internal: string | null;
}

// Generate a client code suggestion from name
function generateClientCode(name: string): string {
  // Extract uppercase letters only, take first 3-4 chars
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 3) {
    return letters.substring(0, 3);
  }
  // Pad with X if too short
  return (letters + 'XXX').substring(0, 3);
}

// Generate alternative codes if the primary one is taken
function generateAlternativeCodes(name: string, existingCodes: string[]): string[] {
  const baseCode = generateClientCode(name);
  const alternatives: string[] = [baseCode];
  
  // Try without vowels
  const consonants = name.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  if (consonants.length >= 3) {
    alternatives.push(consonants.substring(0, 3));
  }
  
  // Try with different letter combinations
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 4) {
    alternatives.push(letters[0] + letters[2] + letters[3]);
  }
  
  // Add numeric suffixes
  for (let i = 1; i <= 9; i++) {
    alternatives.push(baseCode.substring(0, 2) + i.toString());
  }
  
  // Filter out existing codes and return unique alternatives
  return [...new Set(alternatives)].filter(code => !existingCodes.includes(code));
}

export default function Clients() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{
    open_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    products: number;
  } | null>(null);
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formClientCode, setFormClientCode] = useState('');
  const [formBillingEmail, setFormBillingEmail] = useState('');
  const [formBillingContact, setFormBillingContact] = useState('');
  const [formShippingAddress, setFormShippingAddress] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formNotes, setFormNotes] = useState('');
  const [codeError, setCodeError] = useState('');

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, client_code, billing_email, billing_contact_name, shipping_address, is_active, notes_internal')
        .order('name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });

  // Filter clients based on showInactive toggle
  const displayedClients = useMemo(() => {
    if (!clients) return [];
    return showInactive ? clients : clients.filter(c => c.is_active);
  }, [clients, showInactive]);

  const inactiveCount = useMemo(() => {
    return clients?.filter(c => !c.is_active).length ?? 0;
  }, [clients]);

  // Get all existing client codes for uniqueness check
  const existingCodes = useMemo(() => {
    return (clients ?? [])
      .filter(c => editingClient ? c.id !== editingClient.id : true)
      .map(c => c.client_code);
  }, [clients, editingClient]);

  // Check if current code is unique
  const isCodeUnique = useMemo(() => {
    if (!formClientCode) return true;
    return !existingCodes.includes(formClientCode.toUpperCase());
  }, [formClientCode, existingCodes]);

  // Suggest alternatives if code is not unique
  const suggestedAlternatives = useMemo(() => {
    if (isCodeUnique || !formName) return [];
    return generateAlternativeCodes(formName, existingCodes).slice(0, 3);
  }, [formName, existingCodes, isCodeUnique]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormClientCode('');
    setFormBillingEmail('');
    setFormBillingContact('');
    setFormShippingAddress('');
    setFormIsActive(true);
    setFormNotes('');
    setCodeError('');
    setEditingClient(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((client: Client) => {
    setEditingClient(client);
    setFormName(client.name);
    setFormClientCode(client.client_code);
    setFormBillingEmail(client.billing_email ?? '');
    setFormBillingContact(client.billing_contact_name ?? '');
    setFormShippingAddress(client.shipping_address ?? '');
    setFormIsActive(client.is_active);
    setFormNotes(client.notes_internal ?? '');
    setCodeError('');
    setShowDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowDialog(false);
    resetForm();
  }, [resetForm]);

  // Auto-suggest code when name changes (only for new clients)
  const handleNameChange = useCallback((newName: string) => {
    setFormName(newName);
    if (!editingClient && newName.length >= 2) {
      const suggested = generateClientCode(newName);
      // Only auto-fill if user hasn't manually changed the code
      if (!formClientCode || formClientCode === generateClientCode(formName)) {
        // Check if suggested is unique, if not find an alternative
        if (!existingCodes.includes(suggested)) {
          setFormClientCode(suggested);
        } else {
          const alternatives = generateAlternativeCodes(newName, existingCodes);
          if (alternatives.length > 0) {
            setFormClientCode(alternatives[0]);
          }
        }
      }
    }
  }, [editingClient, formClientCode, formName, existingCodes]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const code = formClientCode.toUpperCase().trim();
      
      // Final uniqueness check
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('client_code', code)
        .maybeSingle();
      
      if (existing) {
        throw new Error(`Client code "${code}" is already in use`);
      }

      const { error } = await supabase
        .from('clients')
        .insert({
          name: formName.trim(),
          client_code: code,
          billing_email: formBillingEmail.trim() || null,
          billing_contact_name: formBillingContact.trim() || null,
          shipping_address: formShippingAddress.trim() || null,
          is_active: formIsActive,
          notes_internal: formNotes.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Client created');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      if (err instanceof Error && err.message.includes('already in use')) {
        setCodeError(err.message);
      } else {
        toast.error('Failed to create client');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingClient) return;
      const code = formClientCode.toUpperCase().trim();
      
      // Check uniqueness if code changed
      if (code !== editingClient.client_code) {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('client_code', code)
          .neq('id', editingClient.id)
          .maybeSingle();
        
        if (existing) {
          throw new Error(`Client code "${code}" is already in use`);
        }
      }

      const { error } = await supabase
        .from('clients')
        .update({
          name: formName.trim(),
          client_code: code,
          billing_email: formBillingEmail.trim() || null,
          billing_contact_name: formBillingContact.trim() || null,
          shipping_address: formShippingAddress.trim() || null,
          is_active: formIsActive,
          notes_internal: formNotes.trim() || null,
        })
        .eq('id', editingClient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Client updated');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      if (err instanceof Error && err.message.includes('already in use')) {
        setCodeError(err.message);
      } else {
        toast.error('Failed to update client');
      }
    },
  });

  // Delete preflight mutation
  const deletePreflightMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.rpc('get_client_delete_preflight', {
        p_client_id: clientId,
      });
      if (error) throw error;
      return data as {
        open_orders: number;
        completed_orders: number;
        cancelled_orders: number;
        products: number;
      };
    },
    onSuccess: (data, clientId) => {
      const client = clients?.find(c => c.id === clientId);
      if (client) {
        setDeletingClient(client);
        setDeleteCounts(data);
        setShowDeleteModal(true);
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to check client references');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!deletingClient) throw new Error('No client selected');
      const { data, error } = await supabase.rpc('delete_client_safe', {
        p_client_id: deletingClient.id,
        p_force: force,
      });
      if (error) throw error;
      return data as { deleted: boolean; message: string };
    },
    onSuccess: (data) => {
      if (data.deleted) {
        toast.success('Client deleted');
        queryClient.invalidateQueries({ queryKey: ['clients'] });
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to delete client');
    },
  });

  // Set inactive mutation (for the delete modal's recommended action)
  const setInactiveMutation = useMutation({
    mutationFn: async () => {
      if (!deletingClient) throw new Error('No client selected');
      const { error } = await supabase
        .from('clients')
        .update({ is_active: false })
        .eq('id', deletingClient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Client set to inactive');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to set client inactive');
    },
  });

  const openDeleteDialog = useCallback((client: Client) => {
    deletePreflightMutation.mutate(client.id);
  }, [deletePreflightMutation]);

  const handleSubmit = () => {
    if (!formName.trim()) {
      toast.error('Client name is required');
      return;
    }
    if (!formClientCode.trim()) {
      toast.error('Client code is required');
      return;
    }
    if (formClientCode.trim().length < 2) {
      toast.error('Client code must be at least 2 characters');
      return;
    }
    if (!isCodeUnique) {
      setCodeError(`Client code "${formClientCode.toUpperCase()}" is already in use`);
      return;
    }

    if (editingClient) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Clients</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Client
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Clients</CardTitle>
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
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : displayedClients.length === 0 ? (
            <p className="text-muted-foreground">No clients to display.</p>
          ) : (
            <ul className="space-y-3">
              {displayedClients.map((c) => (
                <li key={c.id} className={`border-b pb-3 last:border-0 ${!c.is_active ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">
                        {c.client_code}
                      </Badge>
                      <div>
                        <span className="font-medium">{c.name}</span>
                        {c.billing_email && (
                          <span className="ml-2 text-sm text-muted-foreground">{c.billing_email}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <BriefMeButton type="client" id={c.id} name={c.name} />
                      <span className={`text-sm ${c.is_active ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => openDeleteDialog(c)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {/* Locations section */}
                  <div className="mt-2">
                    <ClientLocations clientId={c.id} clientName={c.name} />
                  </div>
                  {/* Ordering Constraints section */}
                  <ClientOrderingConstraints clientId={c.id} clientName={c.name} />
                  {/* Account Notes */}
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <button className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                        Account Notes
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <ClientAccountNotes clientId={c.id} />
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'Edit Client' : 'Add New Client'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Matchstick Coffee"
              />
            </div>

            <div>
              <Label htmlFor="clientCode">Client Code *</Label>
              <Input
                id="clientCode"
                value={formClientCode}
                onChange={(e) => {
                  setFormClientCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 5));
                  setCodeError('');
                }}
                placeholder="MAT"
                className="font-mono"
                maxLength={5}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used as prefix for order numbers (e.g., {formClientCode || 'MAT'}-000123)
              </p>
              {codeError && (
                <p className="text-xs text-destructive mt-1">{codeError}</p>
              )}
              {!isCodeUnique && !codeError && suggestedAlternatives.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-destructive">Code already in use. Try:</p>
                  <div className="flex gap-2 mt-1">
                    {suggestedAlternatives.map((alt) => (
                      <Button
                        key={alt}
                        variant="outline"
                        size="sm"
                        className="text-xs font-mono h-7"
                        onClick={() => {
                          setFormClientCode(alt);
                          setCodeError('');
                        }}
                      >
                        {alt}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="billingEmail">Billing Email</Label>
              <Input
                id="billingEmail"
                type="email"
                value={formBillingEmail}
                onChange={(e) => setFormBillingEmail(e.target.value)}
                placeholder="billing@example.com"
              />
            </div>

            <div>
              <Label htmlFor="billingContact">Billing Contact Name</Label>
              <Input
                id="billingContact"
                value={formBillingContact}
                onChange={(e) => setFormBillingContact(e.target.value)}
                placeholder="John Doe"
              />
            </div>

            <div>
              <Label htmlFor="shippingAddress">Shipping Address</Label>
              <Input
                id="shippingAddress"
                value={formShippingAddress}
                onChange={(e) => setFormShippingAddress(e.target.value)}
                placeholder="123 Main St, Vancouver, BC"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={formIsActive}
                onCheckedChange={(checked) => setFormIsActive(!!checked)}
              />
              <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
            </div>

            <div>
              <Label htmlFor="notes">Internal Notes</Label>
              <Input
                id="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Notes for internal use"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeDialog} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isPending || !isCodeUnique}>
                {isPending ? 'Saving…' : editingClient ? 'Save Changes' : 'Create Client'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Safe Delete Modal */}
      <SafeDeleteModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        entityType="client"
        entityName={deletingClient?.name ?? ''}
        counts={deleteCounts}
        isLoading={deleteMutation.isPending || setInactiveMutation.isPending}
        onSetInactive={() => setInactiveMutation.mutate()}
        onConfirmDelete={() => deleteMutation.mutate(true)}
      />
    </div>
  );
}
