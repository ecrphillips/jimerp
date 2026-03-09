import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { NotesLog } from '@/components/crm/NotesLog';
import { BriefMeButton } from '@/components/crm/BriefMeModal';

type ProspectStage = 'AWARE' | 'CONTACTED' | 'CONVERSATION' | 'AGREEMENT_SENT' | 'ONBOARDED';

const STAGES: { value: ProspectStage; label: string }[] = [
  { value: 'AWARE', label: 'Aware' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'CONVERSATION', label: 'Conversation' },
  { value: 'AGREEMENT_SENT', label: 'Agreement Sent' },
  { value: 'ONBOARDED', label: 'Onboarded' },
];

const stageBadgeVariant = (stage: ProspectStage): "default" | "secondary" | "outline" => {
  switch (stage) {
    case 'ONBOARDED': return 'default';
    case 'AGREEMENT_SENT': return 'default';
    case 'CONVERSATION': return 'secondary';
    default: return 'outline';
  }
};

interface Prospect {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_info: string | null;
  stage: ProspectStage;
  created_at: string;
  updated_at: string;
}

export default function Prospects() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formContactInfo, setFormContactInfo] = useState('');

  const { data: prospects = [], isLoading } = useQuery({
    queryKey: ['prospects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Prospect[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('prospects').insert({
        business_name: formName.trim(),
        contact_name: formContact.trim() || null,
        contact_info: formContactInfo.trim() || null,
        created_by: authUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Prospect added');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      setShowDialog(false);
      setFormName('');
      setFormContact('');
      setFormContactInfo('');
    },
    onError: () => toast.error('Failed to add prospect'),
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: ProspectStage }) => {
      const { error } = await supabase
        .from('prospects')
        .update({ stage })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: () => toast.error('Failed to update stage'),
  });

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Prospects</h1>
        <Button onClick={() => setShowDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Prospect
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Co-Roasting Prospect Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : prospects.length === 0 ? (
            <p className="text-muted-foreground">No prospects yet. Add one to get started.</p>
          ) : (
            <ul className="space-y-3">
              {prospects.map((p) => (
                <li key={p.id} className="border-b pb-3 last:border-0">
                  <Collapsible
                    open={expandedId === p.id}
                    onOpenChange={(open) => setExpandedId(open ? p.id : null)}
                  >
                    <div className="flex items-center justify-between">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center gap-2 text-left group">
                          {expandedId === p.id ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <span className="font-medium group-hover:underline">{p.business_name}</span>
                            {p.contact_name && (
                              <span className="ml-2 text-sm text-muted-foreground">{p.contact_name}</span>
                            )}
                            {p.contact_info && (
                              <span className="ml-2 text-sm text-muted-foreground">· {p.contact_info}</span>
                            )}
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <div className="flex items-center gap-2">
                        <Select
                          value={p.stage}
                          onValueChange={(val) =>
                            updateStageMutation.mutate({ id: p.id, stage: val as ProspectStage })
                          }
                        >
                          <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s.value} value={s.value} className="text-xs">
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <CollapsibleContent className="mt-3 ml-6">
                      <NotesLog
                        table="prospect_notes"
                        foreignKey="prospect_id"
                        foreignId={p.id}
                        queryKey={['prospect-notes', p.id]}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Prospect Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Prospect</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="bizName">Business Name *</Label>
              <Input
                id="bizName"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Acme Coffee Co."
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="contactName">Primary Contact</Label>
              <Input
                id="contactName"
                value={formContact}
                onChange={(e) => setFormContact(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <Label htmlFor="contactInfo">Email / Phone</Label>
              <Input
                id="contactInfo"
                value={formContactInfo}
                onChange={(e) => setFormContactInfo(e.target.value)}
                placeholder="jane@acme.com or 604-555-1234"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                disabled={!formName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Adding…' : 'Add Prospect'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
