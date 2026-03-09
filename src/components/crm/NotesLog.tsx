import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface Note {
  id: string;
  note_text: string;
  follow_up_by: string | null;
  created_by: string;
  created_at: string;
  author_name?: string;
}

interface NotesLogProps {
  table: 'client_notes' | 'prospect_notes';
  foreignKey: 'client_id' | 'prospect_id';
  foreignId: string;
  queryKey: string[];
}

export function NotesLog({ table, foreignKey, foreignId, queryKey }: NotesLogProps) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [followUpBy, setFollowUpBy] = useState('');

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let data: any[] | null = null;
      let error: any = null;

      if (table === 'client_notes') {
        const res = await supabase
          .from('client_notes')
          .select('*')
          .eq('client_id', foreignId)
          .order('created_at', { ascending: false });
        data = res.data;
        error = res.error;
      } else {
        const res = await supabase
          .from('prospect_notes')
          .select('*')
          .eq('prospect_id', foreignId)
          .order('created_at', { ascending: false });
        data = res.data;
        error = res.error;
      }

      if (error) throw error;

      // Fetch author names
      const userIds = [...new Set((data ?? []).map((n: any) => n.created_by))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
        }
      }

      return (data ?? []).map((n: any) => ({
        ...n,
        author_name: profileMap[n.created_by] || 'Unknown',
      })) as Note[];
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      if (table === 'client_notes') {
        const { error } = await supabase.from('client_notes').insert({
          client_id: foreignId,
          note_text: noteText.trim(),
          created_by: authUser!.id,
          follow_up_by: followUpBy || null,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('prospect_notes').insert({
          prospect_id: foreignId,
          note_text: noteText.trim(),
          created_by: authUser!.id,
          follow_up_by: followUpBy || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setNoteText('');
      setFollowUpBy('');
      setShowForm(false);
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  return (
    <div className="space-y-3">
      {!showForm ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(true)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Note
        </Button>
      ) : (
        <div className="space-y-2 border rounded-md p-3 bg-muted/30">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Type your note…"
            className="min-h-[60px] text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="followUp" className="text-xs text-muted-foreground whitespace-nowrap">
              <Calendar className="h-3 w-3 inline mr-1" />
              Follow up by
            </Label>
            <Input
              id="followUp"
              type="date"
              value={followUpBy}
              onChange={(e) => setFollowUpBy(e.target.value)}
              className="h-8 text-xs w-40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setNoteText('');
                setFollowUpBy('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!noteText.trim() || addNoteMutation.isPending}
              onClick={() => addNoteMutation.mutate()}
            >
              {addNoteMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="border-l-2 border-muted-foreground/20 pl-3 py-1">
              <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{note.author_name}</span>
                <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                {note.follow_up_by && (
                  <span className="text-primary font-medium">
                    Follow up: {format(new Date(note.follow_up_by + 'T00:00:00'), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
