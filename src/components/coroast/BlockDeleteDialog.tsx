import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LoringBlock } from './types';

interface BlockDeleteDialogProps {
  block: LoringBlock | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function BlockDeleteDialog({ block, open, onOpenChange, onSuccess }: BlockDeleteDialogProps) {
  const queryClient = useQueryClient();
  const [deleteScope, setDeleteScope] = useState<'single' | 'future'>('single');
  const hasSeries = !!block?.recurring_series_id;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!block) return;
      if (hasSeries && deleteScope === 'future') {
        const { error } = await (supabase
          .from('coroast_loring_blocks') as any)
          .delete()
          .eq('recurring_series_id', block.recurring_series_id!)
          .gte('block_date', block.block_date);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('coroast_loring_blocks')
          .delete()
          .eq('id', block.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Block deleted');
      queryClient.invalidateQueries({ queryKey: ['coroast-loring-blocks'] });
      onSuccess();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to delete block'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Block</DialogTitle>
        </DialogHeader>
        {hasSeries && (
          <div className="rounded-md border p-3 bg-muted/50">
            <Label className="text-sm font-medium">Delete scope:</Label>
            <RadioGroup
              value={deleteScope}
              onValueChange={(v) => setDeleteScope(v as 'single' | 'future')}
              className="mt-2 space-y-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="single" id="del-single" />
                <Label htmlFor="del-single" className="font-normal">This block only</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="future" id="del-future" />
                <Label htmlFor="del-future" className="font-normal">All future blocks in this series</Label>
              </div>
            </RadioGroup>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {hasSeries && deleteScope === 'future'
            ? 'This will delete all future blocks in this recurring series. This cannot be undone.'
            : 'Are you sure you want to delete this block? This cannot be undone.'}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
