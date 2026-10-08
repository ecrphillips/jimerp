import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ProductNote } from '@/hooks/useAccountProductNotes';

interface Props {
  accountId: string;
  roastGroup: string;
  notes: ProductNote[];
  /** Copy shown under the composer. */
  hint?: string;
}

/** Note thread + composer for one (account, roast group). */
export function ProductNotes({ accountId, roastGroup, notes, hint }: Props) {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const [draft, setDraft] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['client-product-notes', accountId] });

  const addMutation = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase
        .from('client_product_notes')
        .insert({ account_id: accountId, roast_group: roastGroup, note_text: text });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: () => toast.error("Couldn't save note"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_product_notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't delete note"),
  });

  return (
    <div className="space-y-3">
      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-muted/50 p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap">{n.note_text}</p>
                {n.created_by === authUser?.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => deleteMutation.mutate(n.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {n.author_is_staff ? `${n.author_name ?? 'Home Island'} (Home Island)` : n.author_name ?? 'Your team'}
                {' · '}
                {format(new Date(n.created_at), 'MMM d, yyyy')}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          rows={2}
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
        />
        <div className="flex items-center justify-between gap-2">
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : <span />}
          <Button
            size="sm"
            onClick={() => addMutation.mutate(draft.trim())}
            disabled={!draft.trim() || addMutation.isPending}
          >
            {addMutation.isPending ? 'Saving…' : 'Add note'}
          </Button>
        </div>
      </div>
    </div>
  );
}
