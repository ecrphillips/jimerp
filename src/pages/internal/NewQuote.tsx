import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { RecipientPicker, type RecipientKind } from '@/components/quotes/RecipientPicker';

export default function NewQuote() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<RecipientKind>('account');
  const [accountId, setAccountId] = useState<string>('');
  const [prospectId, setProspectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        account_id: kind === 'account' ? accountId : null,
        prospect_id: kind === 'prospect' ? prospectId : null,
        status: 'DRAFT',
        title: title.trim() || null,
        valid_until: validUntil || null,
        internal_notes: internalNotes.trim() || null,
      };
      const { data, error } = await (supabase as any)
        .from('quotes')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success('Quote created');
      navigate(`/accounts/quotes/${id}`);
    },
    onError: (e: any) => toast.error(`Create failed: ${e.message}`),
  });

  const recipientId = kind === 'account' ? accountId : prospectId;
  const canContinue = !!recipientId;

  return (
    <div className="container mx-auto p-6 max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/accounts/quotes')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Quotes
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>New Quote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Recipient type</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as RecipientKind)} className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="account" id="r-account" />
                <Label htmlFor="r-account" className="font-normal cursor-pointer">Account</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="prospect" id="r-prospect" />
                <Label htmlFor="r-prospect" className="font-normal cursor-pointer">Prospect</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>{kind === 'account' ? 'Account' : 'Prospect'}</Label>
            {kind === 'account' ? (
              <RecipientPicker
                kind="account"
                value={accountId}
                onChange={(id) => setAccountId(id)}
              />
            ) : (
              <RecipientPicker
                kind="prospect"
                value={prospectId}
                onChange={(id) => setProspectId(id)}
              />
            )}
            {kind === 'prospect' && (
              <p className="text-xs text-muted-foreground">
                If your prospect isn't listed, create them in <a href="/prospects" className="underline">Relationships</a> first.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Title <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 wholesale review"
            />
          </div>

          <div className="space-y-2">
            <Label>Valid until <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Internal notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Visible only to admin/ops."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate('/accounts/quotes')}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canContinue || createMutation.isPending}
            >
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
