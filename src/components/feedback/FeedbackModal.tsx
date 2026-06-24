import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

const CATEGORIES = [
  { value: 'BUG', label: 'Bug Report' },
  { value: 'WORKFLOW', label: 'Workflow' },
  { value: 'UX_IMPROVEMENT', label: 'UX Improvement' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const { authUser } = useAuth();
  const [category, setCategory] = useState<string>('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const MAX_MESSAGE_LENGTH = 2000;

  const handleSubmit = async () => {
    if (!category || !message.trim() || !authUser) return;
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      toast({ title: 'Too long', description: `Please keep feedback under ${MAX_MESSAGE_LENGTH} characters.`, variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('feedback_submissions')
        .insert({
          created_by: authUser.id,
          category,
          message: message.trim().slice(0, MAX_MESSAGE_LENGTH),
        });
      if (error) throw error;
      toast({ title: 'Got it — thanks!', description: 'Your feedback has been submitted.' });
      setCategory('');
      setMessage('');
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Give Feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  category === cat.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Describe the issue or idea..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={MAX_MESSAGE_LENGTH}
          />
          <p className="text-[10px] text-muted-foreground text-right">
            {message.length} / {MAX_MESSAGE_LENGTH}
          </p>
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!category || !message.trim() || submitting}
              size="sm"
            >
              {submitting ? 'Sending...' : 'Submit'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
