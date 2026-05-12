import { UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useOrderCreator } from '@/hooks/useOrderCreator';

interface CreatedByBadgeProps {
  userId: string | null | undefined;
  variant?: 'header' | 'modal';
}

export function CreatedByBadge({ userId, variant = 'header' }: CreatedByBadgeProps) {
  const { data: profile } = useOrderCreator(userId);

  const displayName = profile?.name?.trim() || profile?.email || null;
  const label = displayName ? `Created by ${displayName}` : 'Internal Created';

  if (variant === 'modal') {
    return (
      <Badge variant="outline" className="ml-2 text-xs">
        <UserPlus className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
      <UserPlus className="h-3 w-3" />
      {label}
    </span>
  );
}
