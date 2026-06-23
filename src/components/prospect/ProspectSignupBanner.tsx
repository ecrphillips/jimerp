import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import { useIsProspect, type CoroastTier } from '@/hooks/useIsProspect';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const TIERS: CoroastTier[] = ['MEMBER', 'GROWTH', 'PRODUCTION'];

export function ProspectSignupBanner() {
  const { isProspect, selectedTier, accountId, isLoading } = useIsProspect();
  const { authUser } = useAuth();
  const [picked, setPicked] = useState<CoroastTier | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  if (isLoading || !isProspect || !accountId) return null;

  const submitted = !!selectedTier;
  const activeTier = submitted ? selectedTier : picked;

  const handleSubmit = async () => {
    if (!picked || !accountId) return;
    setSubmitting(true);
    const { error } = await supabase
      .from('accounts')
      .update({ prospect_selected_tier: picked })
      .eq('id', accountId);

    if (error) {
      setSubmitting(false);
      toast.error("Couldn't record your selection — try again");
      return;
    }

    // Fire team notification by inserting a coroast_prospect_submissions row.
    // The existing notify-prospect-submission edge function emails Ted + Aaron.
    // No transaction wrapper exists in this codebase — sequential writes;
    // if the notification path fails the user still sees the success state
    // (their tier intent is recorded on accounts.prospect_selected_tier).
    try {
      const { data: prospect } = await supabase
        .from('prospects')
        .select('id')
        .eq('converted_to_account_id', accountId)
        .maybeSingle();

      const prospectId = prospect?.id ?? null;
      let invitationId: string | null = null;
      if (prospectId) {
        const { data: inv } = await supabase
          .from('coroast_prospect_invitations')
          .select('id')
          .eq('prospect_id', prospectId)
          .order('invited_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        invitationId = inv?.id ?? null;
      }

      if (prospectId && invitationId) {
        const { data: acct } = await supabase
          .from('accounts')
          .select('account_name')
          .eq('id', accountId)
          .maybeSingle();

        const { data: sub, error: subErr } = await supabase
          .from('coroast_prospect_submissions')
          .insert({
            prospect_id: prospectId,
            invitation_id: invitationId,
            selected_tier: picked,
            company_name: acct?.account_name ?? null,
            contact_email: authUser?.email ?? null,
            notes: `Tier intent signalled from portal banner: ${picked}`,
          })
          .select('id')
          .single();

        if (subErr) {
          console.warn('[ProspectSignupBanner] submission insert failed:', subErr);
        } else if (sub?.id) {
          supabase.functions
            .invoke('notify-prospect-submission', { body: { submission_id: sub.id } })
            .catch(() => {});
        }
      } else {
        console.warn(
          '[ProspectSignupBanner] no prospect/invitation linked to account',
          accountId,
        );
      }
    } catch (err) {
      console.warn('[ProspectSignupBanner] notification path failed:', err);
    }

    qc.invalidateQueries({ queryKey: ['account-status', accountId] });
    setSubmitting(false);
    toast.success("Got it — we'll be in touch shortly");
  };

  return (
    <div className="border-b border-primary/30 bg-primary/10 px-4 py-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-foreground">
            {submitted
              ? "We've got your tier selection — our team will follow up shortly."
              : "You're previewing the member portal."}
          </div>
          <div className="text-xs text-muted-foreground">
            {submitted
              ? `Your selection: ${TIER_RATES[selectedTier!]?.label ?? selectedTier}`
              : 'Pick a tier to sign up — our team will follow up to finalize.'}
          </div>
        </div>

        {submitted ? (
          <div className="inline-flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground">
            <Check className="h-4 w-4 text-success" />
            Signup pending
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <RadioGroup
              value={activeTier ?? ''}
              onValueChange={(v) => setPicked(v as CoroastTier)}
              className="flex flex-wrap gap-1"
            >
              {TIERS.map((t) => (
                <Label
                  key={t}
                  className={cn(
                    'flex cursor-pointer items-center justify-center rounded-md border px-3 py-1.5 text-xs',
                    activeTier === t
                      ? 'border-primary bg-primary text-primary-foreground font-semibold'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  <RadioGroupItem value={t} className="sr-only" />
                  {TIER_RATES[t]?.label ?? t}
                </Label>
              ))}
            </RadioGroup>
            <Button
              size="sm"
              disabled={!picked || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Submitting…</>
              ) : (
                <>Sign up{picked ? ` at ${TIER_RATES[picked]?.label ?? picked}` : ''}</>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
