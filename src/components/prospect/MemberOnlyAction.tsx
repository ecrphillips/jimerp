import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useIsProspect } from '@/hooks/useIsProspect';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  actionLabel?: string;
  mode?: 'replace' | 'disable';
  className?: string;
}

/**
 * Gating wrapper for member portal actions.
 * - Active members: renders children unchanged.
 * - Prospects: replaces children with a "Become a member" CTA (mode='replace')
 *   or disables children + adds a "Members only" badge (mode='disable').
 *
 * Active-member render path is byte-identical to passing the children directly.
 */
export function MemberOnlyAction({
  children,
  actionLabel,
  mode = 'replace',
  className,
}: Props) {
  const { isProspect } = useIsProspect();

  if (!isProspect) return <>{children}</>;

  if (mode === 'replace') {
    const label = actionLabel ? `Become a member to ${actionLabel}` : 'Become a member to continue';
    return (
      <Button
        className={cn('gap-2', className)}
        onClick={() =>
          toast.info("You're in preview mode. Pick a tier in the banner above to sign up.")
        }
      >
        <Lock className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  // mode === 'disable' — gray children, block clicks, append Members-only badge
  return (
    <div className={cn('relative inline-flex items-center gap-2', className)}>
      <div className="pointer-events-none opacity-50">
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          return cloneElement(child as ReactElement, {
            disabled: true,
            'aria-disabled': true,
          });
        })}
      </div>
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Lock className="h-3 w-3" />
        Members only
      </Badge>
    </div>
  );
}
