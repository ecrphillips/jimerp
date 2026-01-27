import React, { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';

/**
 * Order Progress Milestones & Weights:
 * - Confirmed (work_deadline_at set + status >= CONFIRMED): 15%
 * - Roasted (derived from roasted batches coverage): 20%
 * - Packed (all line items have sufficient packing_runs): 30%
 * - Picked (ship_picks units_picked >= demanded): 15%
 * - Shipped (status = SHIPPED): 10%
 * - Invoiced (invoiced = true): 10%
 * 
 * If picking is not implemented/used, we normalize without it.
 */

interface OrderProgressData {
  status: string;
  workDeadlineAt: string | null;
  invoiced: boolean;
  // Derived states (0-1 each)
  roastedCoverage?: number; // 0-1 ratio of roast coverage
  packedComplete?: boolean;
  pickedComplete?: boolean;
  hasPickingData?: boolean; // whether picking system is in use
}

interface OrderProgressBarProps {
  data: OrderProgressData;
  compact?: boolean;
  showNextAction?: boolean;
}

interface Milestone {
  key: string;
  label: string;
  weight: number;
  complete: boolean;
  partial?: number; // 0-1 for partial completion
}

export function OrderProgressBar({ data, compact = false, showNextAction = true }: OrderProgressBarProps) {
  const { milestones, progress, nextAction } = useMemo(() => {
    const {
      status,
      workDeadlineAt,
      invoiced,
      roastedCoverage = 0,
      packedComplete = false,
      pickedComplete = false,
      hasPickingData = false,
    } = data;

    // Define milestone weights
    const baseWeights = {
      confirmed: 15,
      roasted: 20,
      packed: 30,
      picked: hasPickingData ? 15 : 0,
      shipped: 10,
      invoiced: 10,
    };

    // Normalize if picking not used
    const totalBase = Object.values(baseWeights).reduce((a, b) => a + b, 0);
    const scale = 100 / totalBase;

    const weights = {
      confirmed: baseWeights.confirmed * scale,
      roasted: baseWeights.roasted * scale,
      packed: baseWeights.packed * scale,
      picked: baseWeights.picked * scale,
      shipped: baseWeights.shipped * scale,
      invoiced: baseWeights.invoiced * scale,
    };

    // Determine milestone completion
    const isConfirmed = !!workDeadlineAt && ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'].includes(status);
    const isShipped = status === 'SHIPPED';
    const isCancelled = status === 'CANCELLED';

    const milestones: Milestone[] = [
      {
        key: 'confirmed',
        label: 'Confirmed',
        weight: weights.confirmed,
        complete: isConfirmed,
      },
      {
        key: 'roasted',
        label: 'Roasted',
        weight: weights.roasted,
        complete: roastedCoverage >= 1,
        partial: roastedCoverage,
      },
      {
        key: 'packed',
        label: 'Packed',
        weight: weights.packed,
        complete: packedComplete,
      },
    ];

    if (hasPickingData) {
      milestones.push({
        key: 'picked',
        label: 'Picked',
        weight: weights.picked,
        complete: pickedComplete,
      });
    }

    milestones.push(
      {
        key: 'shipped',
        label: 'Shipped',
        weight: weights.shipped,
        complete: isShipped,
      },
      {
        key: 'invoiced',
        label: 'Invoiced',
        weight: weights.invoiced,
        complete: invoiced,
      }
    );

    // Calculate total progress
    let totalProgress = 0;
    for (const m of milestones) {
      if (m.complete) {
        totalProgress += m.weight;
      } else if (m.partial !== undefined && m.partial > 0) {
        totalProgress += m.weight * m.partial;
      }
    }

    // If cancelled, show 0
    if (isCancelled) {
      totalProgress = 0;
    }

    // Determine next action
    let nextActionText = '';
    if (isCancelled) {
      nextActionText = 'Cancelled';
    } else if (!isConfirmed) {
      nextActionText = 'Set deadline & confirm';
    } else if (roastedCoverage < 1) {
      nextActionText = 'Complete roasting';
    } else if (!packedComplete) {
      nextActionText = 'Complete packing';
    } else if (hasPickingData && !pickedComplete) {
      nextActionText = 'Complete picking';
    } else if (!isShipped) {
      nextActionText = 'Ship order';
    } else if (!invoiced) {
      nextActionText = 'Invoice';
    } else {
      nextActionText = 'Complete';
    }

    return {
      milestones,
      progress: Math.round(totalProgress),
      nextAction: nextActionText,
    };
  }, [data]);

  if (compact) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Progress value={progress} className="h-1.5 w-16 flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{progress}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Progress value={progress} className="h-2 flex-1" />
        <span className="text-xs font-medium text-muted-foreground w-8">{progress}%</span>
      </div>
      {showNextAction && nextAction && (
        <p className="text-xs text-muted-foreground truncate">
          Next: {nextAction}
        </p>
      )}
    </div>
  );
}

interface DeadlineStatusProps {
  workDeadlineAt: string | null;
  status: string;
  packedComplete: boolean;
  compact?: boolean;
}

export function DeadlineStatus({ workDeadlineAt, status, packedComplete, compact = false }: DeadlineStatusProps) {
  const { indicator, label, colorClass } = useMemo(() => {
    if (status === 'CANCELLED') {
      return {
        indicator: <XCircle className="h-3 w-3" />,
        label: 'Cancelled',
        colorClass: 'text-muted-foreground',
      };
    }

    if (status === 'SHIPPED') {
      return {
        indicator: <CheckCircle2 className="h-3 w-3" />,
        label: 'Shipped',
        colorClass: 'text-muted-foreground',
      };
    }

    if (!workDeadlineAt) {
      return {
        indicator: <Clock className="h-3 w-3" />,
        label: 'No deadline',
        colorClass: 'text-warning',
      };
    }

    const deadline = new Date(workDeadlineAt);
    const now = new Date();
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Late: past deadline and not shipped
    if (hoursUntilDeadline < 0) {
      return {
        indicator: <XCircle className="h-3 w-3" />,
        label: 'Late',
        colorClass: 'text-destructive',
      };
    }

    // At risk: within 24h and not packed
    if (hoursUntilDeadline <= 24 && !packedComplete) {
      return {
        indicator: <AlertTriangle className="h-3 w-3" />,
        label: 'At risk',
        colorClass: 'text-warning',
      };
    }

    // On track
    return {
      indicator: <CheckCircle2 className="h-3 w-3" />,
      label: 'On track',
      colorClass: 'text-primary',
    };
  }, [workDeadlineAt, status, packedComplete]);

  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs', colorClass)} title={label}>
        {indicator}
      </span>
    );
  }

  return (
    <Badge variant="outline" className={cn('text-xs gap-1', colorClass)}>
      {indicator}
      {label}
    </Badge>
  );
}
