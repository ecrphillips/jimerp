import React from 'react';
import type { DateFilterConfig } from '@/components/production/types';

interface PlanTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

export function PlanTab({ dateFilterConfig, today }: PlanTabProps) {
  return (
    <div className="text-sm text-muted-foreground">
      Plan
    </div>
  );
}
