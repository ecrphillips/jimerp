import { useEffect, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ViewMode = 'cards' | 'list';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-input overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Card view"
        aria-pressed={value === 'cards'}
        onClick={() => onChange('cards')}
        className={cn(
          'h-9 w-9 rounded-none',
          value === 'cards' && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        )}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="List view"
        aria-pressed={value === 'list'}
        onClick={() => onChange('list')}
        className={cn(
          'h-9 w-9 rounded-none border-l border-input',
          value === 'list' && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        )}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function useViewMode(storageKey: string, defaultMode: ViewMode): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return defaultMode;
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'cards' || stored === 'list' ? stored : defaultMode;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      /* ignore */
    }
  }, [storageKey, mode]);

  return [mode, setMode];
}
