import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, Loader2 } from 'lucide-react';

interface InlinePackingControlProps {
  value: number;
  onCommit: (newValue: number) => Promise<void>;
  onEditingChange?: (isEditing: boolean) => void;
  disabled?: boolean;
  isComplete?: boolean;
}

export function InlinePackingControl({ 
  value, 
  onCommit, 
  onEditingChange,
  disabled = false,
  isComplete = false 
}: InlinePackingControlProps) {
  const [localValue, setLocalValue] = useState<string>(value.toString());
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedValue, setLastSavedValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isCommittingRef = useRef(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local value when external value changes (e.g., after refetch)
  useEffect(() => {
    if (!isCommittingRef.current && !isFocused) {
      setLocalValue(value.toString());
      setLastSavedValue(value);
    }
  }, [value, isFocused]);

  // Notify parent of editing state changes
  const notifyEditingChange = useCallback((editing: boolean) => {
    onEditingChange?.(editing);
  }, [onEditingChange]);

  // Reset idle timeout - allows re-sort after 1200ms of inactivity
  const resetIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    idleTimeoutRef.current = setTimeout(() => {
      // After idle period, allow re-sort even if still focused
      notifyEditingChange(false);
    }, 1200);
  }, [notifyEditingChange]);

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
    
    // Reset idle timeout on any change
    resetIdleTimeout();
    
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

  const handleFocus = () => {
    setIsFocused(true);
    notifyEditingChange(true);
    resetIdleTimeout();
  };

  const handleBlur = () => {
    setIsFocused(false);
    
    // Clear idle timeout
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
    
    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    
    // Treat empty as 0
    const finalValue = localValue === '' ? 0 : parseInt(localValue, 10) || 0;
    setLocalValue(finalValue.toString());
    commitValue(finalValue);
    
    // Notify editing ended
    notifyEditingChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const handleButtonClick = (delta: number) => {
    const current = parseInt(localValue, 10) || 0;
    const newValue = Math.max(0, current + delta);
    setLocalValue(newValue.toString());
    
    // Notify editing started, reset idle
    notifyEditingChange(true);
    resetIdleTimeout();
    
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
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  const isDisabled = disabled || isSaving;
  const displayValue = localValue;

  return (
    <div 
      className="flex items-center gap-1 justify-end"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => handleButtonClick(-1)}
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
          onFocus={handleFocus}
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
        onClick={() => handleButtonClick(1)}
        disabled={isDisabled}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
