import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { UserPlus, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface CreatedState {
  accountId: string;
  prospectId: string;
  invitationId: string;
  email: string;
  businessName: string;
}

export function ProspectAccountCreator() {
  const { authUser } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedState | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setBusinessName('');
    setContactName('');
    setEmail('');
    setNotes('');
    setCreated(null);
    setSubmitting(false);
  };

  const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

  const handleSubmit = async () => {
    const bn = businessName.trim();
    const cn = contactName.trim();
    const em = email.trim().toLowerCase();
    if (!bn || !cn || !em) {
      toast.error('Business name, contact name, and email are required');
      return;
    }
    if (!validEmail(em)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (!authUser?.id) {
      toast.error('Sign-in required');
      return;
    }

    setSubmitting(true);

    // Track created rows for manual cleanup if a later step fails.
    let prospectId: string | null = null;
    let accountId: string | null = null;
    let invitationId: string | null = null;

    try {
      // Pre-check: refuse if the contact already has a profile (i.e. an auth user).
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', em)
        .maybeSingle();
      if (existingProfile) {
        throw new Error('This email already has an account — link manually instead.');
      }

      // 1. prospects
      const { data: prospect, error: pErr } = await supabase
        .from('prospects')
        .insert({
          business_name: bn,
          contact_name: cn,
          prospect_email: em,
          contact_info: notes.trim() || null,
          stage: 'CONTACTED',
          stream: 'CO_ROAST',
          created_by: authUser.id,
        })
        .select('id')
        .single();
      if (pErr || !prospect) throw new Error(`prospects insert: ${pErr?.message ?? 'unknown'}`);
      prospectId = prospect.id;

      // 2. accounts (PROSPECT status, COROASTING program)
      const { data: account, error: aErr } = await supabase
        .from('accounts')
        .insert({
          account_name: bn,
          account_status: 'PROSPECT',
          programs: ['COROASTING'],
        })
        .select('id')
        .single();
      if (aErr || !account) throw new Error(`accounts insert: ${aErr?.message ?? 'unknown'}`);
      accountId = account.id;

      // 3. coroast_prospect_invitations (token + expires_at have DB defaults)
      const { data: inv, error: iErr } = await supabase
        .from('coroast_prospect_invitations')
        .insert({
          prospect_id: prospectId,
          invited_by: authUser.id,
        })
        .select('id')
        .single();
      if (iErr || !inv) throw new Error(`invitations insert: ${iErr?.message ?? 'unknown'}`);
      invitationId = inv.id;

      // 4 + 5. Auth invite + account_users link via edge function.
      // This calls supabase.auth.admin.inviteUserByEmail, creates profiles +
      // user_roles + account_users (perms: is_owner=true, can_book_roaster=true,
      // can_place_orders=false). Lands them at /auth/callback on first login,
      // then ProtectedRoute routes coroast members to /member-portal.
      const { data: inviteRes, error: invokeErr } = await supabase.functions.invoke(
        'invite-account-user',
        {
          body: {
            email: em,
            account_id: accountId,
            is_owner: true,
            can_book_roaster: true,
            can_place_orders: false,
            can_manage_locations: false,
            can_invite_users: false,
            location_access: 'ALL',
          },
        },
      );
      if (invokeErr || (inviteRes && (inviteRes as { error?: string }).error)) {
        const msg = invokeErr?.message ?? (inviteRes as { error?: string }).error ?? 'unknown';
        throw new Error(`invite-account-user: ${msg}`);
      }

      // 6. Link prospect → account
      const { error: linkErr } = await supabase
        .from('prospects')
        .update({ converted_to_account_id: accountId })
        .eq('id', prospectId);
      if (linkErr) {
        console.warn('[ProspectAccountCreator] converted_to_account_id link failed:', linkErr);
        // Non-fatal — the invite succeeded; admin can fix the link manually.
      }

      qc.invalidateQueries({ queryKey: ['prospects'] });
      setCreated({
        accountId,
        prospectId,
        invitationId,
        email: em,
        businessName: bn,
      });
      toast.success('Prospect account created — invitation sent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ProspectAccountCreator] flow failed:', msg, {
        prospectId,
        accountId,
        invitationId,
      });
      toast.error(`Couldn't create prospect: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="h-4 w-4 mr-2" />
          Create Prospect with Portal Access
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" /> Prospect created
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Account: </span>
                <span className="font-medium">{created.businessName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Invitation sent to: </span>
                <span className="font-medium">{created.email}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                They'll get an email link. On first login they land in the member portal with the prospect signup banner.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={reset}>Create another</Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create Prospect with Portal Access</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pcc-business">Business name *</Label>
                <Input
                  id="pcc-business"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Coffee Roasters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pcc-contact">Contact name *</Label>
                <Input
                  id="pcc-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pcc-email">Contact email *</Label>
                <Input
                  id="pcc-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@acmecoffee.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pcc-notes">Notes / source (optional)</Label>
                <Textarea
                  id="pcc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Met at SCA Expo; warm intro from …"
                  rows={3}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Creates a prospects row, a PROSPECT-status account, a coroast invitation, sends an auth invite, and links the new user as account owner with co-roasting access only.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</>
                ) : (
                  'Create + send invite'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
