/**
 * Nudge Schedule Buttons
 * 
 * Quick actions to move an order between production slices (Today ↔ Tomorrow ↔ Future)
 * by updating work_deadline_at to a computed timestamp.
 */

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  computeNudgedDeadline, 
  formatNudgeResult, 
  type NudgeDirection 
} from '@/lib/productionScheduling';
import { cn } from '@/lib/utils';

interface NudgeScheduleButtonsProps {
  orderId: string;
  currentDeadline: string | null;
  /** Compact mode for inline use in cards */
  compact?: boolean;
  /** Callback after successful nudge */
  onNudged?: () => void;
  className?: string;
}

export function NudgeScheduleButtons({
  orderId,
  currentDeadline,
  compact = false,
  onNudged,
  className,
}: NudgeScheduleButtonsProps) {
  const queryClient = useQueryClient();
  const [nudging, setNudging] = useState<NudgeDirection | null>(null);

  const nudgeMutation = useMutation({
    mutationFn: async (direction: NudgeDirection) => {
      const newDeadline = computeNudgedDeadline(currentDeadline, direction);
      
      const { error } = await supabase
        .from('orders')
        .update({ work_deadline_at: newDeadline })
        .eq('id', orderId);
      
      if (error) throw error;
      
      return { newDeadline, direction };
    },
    onMutate: (direction) => {
      setNudging(direction);
    },
    onSuccess: ({ newDeadline, direction }) => {
      const formattedDate = formatNudgeResult(newDeadline);
      toast.success(
        direction === 'later' 
          ? `Pushed to ${formattedDate}` 
          : `Pulled to ${formattedDate}`
      );
      
      // Invalidate all production-related queries
      queryClient.invalidateQueries({ queryKey: ['roast-demand-all'] });
      queryClient.invalidateQueries({ queryKey: ['pack-demand-all'] });
      queryClient.invalidateQueries({ queryKey: ['ship-demand-all'] });
      queryClient.invalidateQueries({ queryKey: ['shippable-orders-all'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      
      onNudged?.();
    },
    onError: (err) => {
      console.error('[NudgeScheduleButtons] Failed:', err);
      toast.error('Failed to update deadline');
    },
    onSettled: () => {
      setNudging(null);
    },
  });

  const handleNudge = (direction: NudgeDirection) => {
    nudgeMutation.mutate(direction);
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => handleNudge('earlier')}
          disabled={nudging !== null}
          title="Nudge earlier (pull into current/previous slice)"
        >
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => handleNudge('later')}
          disabled={nudging !== null}
          title="Nudge later (push to next slice)"
        >
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleNudge('earlier')}
        disabled={nudging !== null}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {nudging === 'earlier' ? 'Moving...' : 'Nudge Earlier'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleNudge('later')}
        disabled={nudging !== null}
      >
        {nudging === 'later' ? 'Moving...' : 'Nudge Later'}
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
