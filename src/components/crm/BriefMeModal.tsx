import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface BriefMeModalProps {
  type: 'client' | 'prospect';
  id: string;
  name: string;
}

export function BriefMeButton({ type, id, name }: BriefMeModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <FileText className="h-3.5 w-3.5" />
        Brief Me
      </Button>
      {open && (
        <BriefMeDialog
          type={type}
          id={id}
          name={name}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

function BriefMeDialog({
  type,
  id,
  name,
  open,
  onOpenChange,
}: BriefMeModalProps & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [copied, setCopied] = useState(false);

  const { data: briefText = '', isLoading } = useQuery({
    queryKey: ['brief-me', type, id],
    enabled: open,
    queryFn: async () => {
      if (type === 'client') {
        return buildClientBrief(id);
      } else {
        return buildProspectBrief(id);
      }
    },
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(briefText);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Brief: {name}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Compiling brief...</p>
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground bg-muted/30 rounded-md p-4">
              {briefText}
            </pre>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleCopy} disabled={isLoading} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy to Clipboard'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function getProfileMap(userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name')
    .in('user_id', userIds);
  if (!profiles) return {};
  return Object.fromEntries(profiles.map((p) => [p.user_id, p.name]));
}

async function buildClientBrief(clientId: string): Promise<string> {
  // 1. Client info
  const { data: client } = await supabase
    .from('clients')
    .select('name, client_code, billing_email, billing_contact_name, shipping_address, notes_internal, is_active')
    .eq('id', clientId)
    .single();

  if (!client) return 'Client not found.';

  const lines: string[] = [];
  lines.push(`Client: ${client.name} (${client.client_code})`);
  lines.push(`Status: ${client.is_active ? 'Active' : 'Inactive'}`);
  if (client.billing_contact_name) lines.push(`Billing Contact: ${client.billing_contact_name}`);
  if (client.billing_email) lines.push(`Billing Email: ${client.billing_email}`);
  if (client.shipping_address) lines.push(`Shipping Address: ${client.shipping_address}`);
  if (client.notes_internal) {
    lines.push('');
    lines.push(`Internal Notes: ${client.notes_internal}`);
  }

  // 2. Order history summary
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status, requested_ship_date, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (orders && orders.length > 0) {
    lines.push('');
    lines.push('--- Order History ---');
    lines.push(`Total orders found: ${orders.length}`);

    const statusCounts: Record<string, number> = {};
    for (const o of orders) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    }
    lines.push(`By status: ${Object.entries(statusCounts).map(([s, c]) => `${s} (${c})`).join(', ')}`);

    // Get line items for recent orders to show products/volume
    const recentOrderIds = orders.slice(0, 10).map((o) => o.id);
    const { data: lineItems } = await supabase
      .from('order_line_items')
      .select('order_id, product_id, quantity_units, products(product_name, bag_size_g)')
      .in('order_id', recentOrderIds);

    if (lineItems && lineItems.length > 0) {
      // Summarize products ordered
      const productSummary: Record<string, { units: number; name: string }> = {};
      for (const li of lineItems) {
        const pName = (li.products as any)?.product_name || 'Unknown';
        if (!productSummary[pName]) productSummary[pName] = { units: 0, name: pName };
        productSummary[pName].units += li.quantity_units;
      }

      lines.push('');
      lines.push(`Products ordered (last ${Math.min(orders.length, 10)} orders):`);
      for (const [, s] of Object.entries(productSummary).sort((a, b) => b[1].units - a[1].units)) {
        lines.push(`  ${s.name}: ${s.units} units`);
      }
    }

    lines.push('');
    lines.push('Recent orders:');
    for (const o of orders.slice(0, 10)) {
      const date = o.requested_ship_date || o.created_at?.split('T')[0] || 'No date';
      lines.push(`  ${o.order_number} - ${o.status} - ${date}`);
    }
  } else {
    lines.push('');
    lines.push('No order history.');
  }

  // 3. Account notes
  const { data: notes } = await supabase
    .from('client_notes')
    .select('note_text, follow_up_by, created_by, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });

  if (notes && notes.length > 0) {
    const profileMap = await getProfileMap([...new Set(notes.map((n) => n.created_by))]);
    lines.push('');
    lines.push('--- Account Notes ---');
    for (const n of notes) {
      const author = profileMap[n.created_by] || 'Unknown';
      const date = format(new Date(n.created_at), 'MMM d, yyyy');
      lines.push(`[${date}] (${author}) ${n.note_text}`);
      if (n.follow_up_by) {
        lines.push(`  Follow up by: ${format(new Date(n.follow_up_by + 'T00:00:00'), 'MMM d, yyyy')}`);
      }
    }
  }

  // 4. Outstanding follow-ups
  const upcomingFollowUps = (notes || []).filter((n) => n.follow_up_by);
  if (upcomingFollowUps.length > 0) {
    const profileMap = await getProfileMap([...new Set(upcomingFollowUps.map((n) => n.created_by))]);
    lines.push('');
    lines.push('--- Outstanding Follow-ups ---');
    for (const n of upcomingFollowUps) {
      const author = profileMap[n.created_by] || 'Unknown';
      lines.push(`  ${format(new Date(n.follow_up_by + 'T00:00:00'), 'MMM d, yyyy')} - ${author}: ${n.note_text.substring(0, 80)}${n.note_text.length > 80 ? '...' : ''}`);
    }
  }

  return lines.join('\n');
}

async function buildProspectBrief(prospectId: string): Promise<string> {
  const { data: prospect } = await supabase
    .from('prospects')
    .select('business_name, contact_name, contact_info, stage, created_at')
    .eq('id', prospectId)
    .single();

  if (!prospect) return 'Prospect not found.';

  const stageLabels: Record<string, string> = {
    AWARE: 'Aware',
    CONTACTED: 'Contacted',
    CONVERSATION: 'Conversation',
    AGREEMENT_SENT: 'Agreement Sent',
    ONBOARDED: 'Onboarded',
  };

  const lines: string[] = [];
  lines.push(`Prospect: ${prospect.business_name}`);
  if (prospect.contact_name) lines.push(`Contact: ${prospect.contact_name}`);
  if (prospect.contact_info) lines.push(`Contact Info: ${prospect.contact_info}`);
  lines.push(`Pipeline Stage: ${stageLabels[prospect.stage] || prospect.stage}`);
  lines.push(`Added: ${format(new Date(prospect.created_at), 'MMM d, yyyy')}`);

  // Notes
  const { data: notes } = await supabase
    .from('prospect_notes')
    .select('note_text, follow_up_by, created_by, created_at')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true });

  if (notes && notes.length > 0) {
    const profileMap = await getProfileMap([...new Set(notes.map((n) => n.created_by))]);
    lines.push('');
    lines.push('--- Notes ---');
    for (const n of notes) {
      const author = profileMap[n.created_by] || 'Unknown';
      const date = format(new Date(n.created_at), 'MMM d, yyyy');
      lines.push(`[${date}] (${author}) ${n.note_text}`);
      if (n.follow_up_by) {
        lines.push(`  Follow up by: ${format(new Date(n.follow_up_by + 'T00:00:00'), 'MMM d, yyyy')}`);
      }
    }
  } else {
    lines.push('');
    lines.push('No notes yet.');
  }

  return lines.join('\n');
}
