import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, Loader2 } from 'lucide-react';

interface InlinePackingControlProps {
  value: number;
  onCommit: (newValue: number) => Promise<void>;
  disabled?: boolean;
  isComplete?: boolean;
}

export function InlinePackingControl({ 
  value, 
  onCommit, 
  disabled = false,
  isComplete = false 
}: InlinePackingControlProps) {
  const [localValue, setLocalValue] = useState<string>(value.toString());
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedValue, setLastSavedValue] = useState(value);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isCommittingRef = useRef(false);

  // Sync local value when external value changes (e.g., after refetch)
  useEffect(() => {
    if (!isCommittingRef.current) {
      setLocalValue(value.toString());
      setLastSavedValue(value);
    }
  }, [value]);

  const commitValue = useCallback(async (newValue: number) => {
    if (newValue === lastSavedValue) return;
    
    isCommittingRef.current = true;
    setIsSaving(true);
    
    try {
      await onCommit(newValue);
      setLastSavedValue(newValue);
    } catch (error) {
      // Revert on failure
      setLocalValue(lastSavedValue.toString());
    } finally {
      setIsSaving(false);
      isCommittingRef.current = false;
    }
  }, [onCommit, lastSavedValue]);

  const scheduleCommit = useCallback((newValue: number) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      commitValue(newValue);
    }, 400);
  }, [commitValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    
    // Allow empty string while typing
    if (inputValue === '') {
      setLocalValue('');
      return;
    }
    
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setLocalValue(parsed.toString());
      scheduleCommit(parsed);
    }
  };

  const handleBlur = () => {
    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    
    // Treat empty as 0
    const finalValue = localValue === '' ? 0 : parseInt(localValue, 10) || 0;
    setLocalValue(finalValue.toString());
    commitValue(finalValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const increment = () => {
    const current = parseInt(localValue, 10) || 0;
    const newValue = current + 1;
    setLocalValue(newValue.toString());
    
    // Clear debounce and commit immediately for button clicks
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    commitValue(newValue);
  };

  const decrement = () => {
    const current = parseInt(localValue, 10) || 0;
    const newValue = Math.max(0, current - 1);
    setLocalValue(newValue.toString());
    
    // Clear debounce and commit immediately for button clicks
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    commitValue(newValue);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const isDisabled = disabled || isSaving;
  const displayValue = localValue;

  return (
    <div className="flex items-center gap-1 justify-end">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={decrement}
        disabled={isDisabled || parseInt(localValue, 10) <= 0}
      >
        <Minus className="h-3 w-3" />
      </Button>
      
      <div className="relative">
        <Input
          type="number"
          min={0}
          className={`w-16 h-7 text-center text-sm px-1 ${isComplete ? 'font-medium' : ''}`}
          value={displayValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
        />
        {isSaving && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={increment}
        disabled={isDisabled}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
