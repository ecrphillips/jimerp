import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, CheckCircle2 } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type ProspectStream = Database['public']['Enums']['prospect_stream'];
type ProspectStage = Database['public']['Enums']['prospect_stage'];

const STREAM_CONFIG: { value: ProspectStream; label: string; description: string; variant: 'default' | 'secondary' | 'outline' }[] = [
  { value: 'CO_ROAST', label: 'Co-Roast', description: 'Potential co-roasting member looking to rent Loring time', variant: 'default' },
  { value: 'CONTRACT', label: 'Contract Manufacturing', description: 'Potential client looking to outsource roasting and/or packing', variant: 'secondary' },
  { value: 'BOTH', label: 'Both', description: 'Could be a fit for either co-roasting or contract manufacturing', variant: 'outline' },
  { value: 'INDUSTRY_CONTACT', label: 'Industry Contact', description: 'Not a likely customer — a relationship worth tracking (importers, other roasters, retailers, industry connections)', variant: 'outline' },
];

const streamLabel = (s: ProspectStream) => STREAM_CONFIG.find(c => c.value === s)?.label ?? s;
const streamVariant = (s: ProspectStream) => STREAM_CONFIG.find(c => c.value === s)?.variant ?? 'outline';

interface Prospect {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_info: string | null;
  stage: ProspectStage;
  stream: ProspectStream;
  converted: boolean;
  created_at: string;
}

export default function Prospects() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStream, setFormStream] = useState<ProspectStream>('CO_ROAST');

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
      const contactInfo = [formEmail.trim(), formPhone.trim()].filter(Boolean).join(' | ') || null;
      const { error } = await supabase.from('prospects').insert({
        business_name: formName.trim(),
        contact_name: formContact.trim() || null,
        contact_info: contactInfo,
        stream: formStream,
        created_by: authUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Prospect added');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      resetForm();
    },
    onError: () => toast.error('Failed to add prospect'),
  });

  const resetForm = () => {
    setShowDialog(false);
    setFormName('');
    setFormContact('');
    setFormEmail('');
    setFormPhone('');
    setFormStream('CO_ROAST');
  };

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
          <CardTitle>CRM Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : prospects.length === 0 ? (
            <p className="text-muted-foreground">No prospects yet. Add one to get started.</p>
          ) : (
            <ul className="space-y-1">
              {prospects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors border-b last:border-0"
                  onClick={() => navigate(`/prospects/${p.id}`)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <span className="font-medium">{p.business_name}</span>
                      {p.contact_name && (
                        <span className="ml-2 text-sm text-muted-foreground">{p.contact_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.converted && (
                      <Badge variant="default" className="gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3" />
                        Converted
                      </Badge>
                    )}
                    <Badge variant={streamVariant(p.stream)} className="text-xs">
                      {streamLabel(p.stream)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Prospect Dialog */}
      <Dialog open={showDialog} onOpenChange={(v) => { if (!v) resetForm(); else setShowDialog(true); }}>
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="jane@acme.com"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="604-555-1234"
              />
            </div>
            <div>
              <Label>Stream *</Label>
              <Select value={formStream} onValueChange={(v) => setFormStream(v as ProspectStream)}>
                <SelectTrigger className="h-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_CONFIG.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <div>
                        <span className="font-medium">{s.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground/70">{s.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={resetForm}>
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
