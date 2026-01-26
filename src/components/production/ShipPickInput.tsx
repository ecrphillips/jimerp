import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus } from 'lucide-react';

interface ShipPickInputProps {
  value: number;
  maxValue: number;
  onCommit: (newValue: number) => void;
  disabled?: boolean;
}

export function ShipPickInput({ 
  value, 
  maxValue, 
  onCommit, 
  disabled = false 
}: ShipPickInputProps) {
  const [draftValue, setDraftValue] = useState<string>(value.toString());
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from props only when NOT focused
  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value.toString());
    }
  }, [value, isFocused]);

  const commitValue = (newValue: number) => {
    // Clamp to 0-maxValue
    const clamped = Math.max(0, Math.min(newValue, maxValue));
    setDraftValue(clamped.toString());
    onCommit(clamped);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    
    // Allow empty string while typing
    if (inputValue === '') {
      setDraftValue('');
      return;
    }
    
    // Only allow valid integers
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setDraftValue(parsed.toString());
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    
    // Treat empty as 0, then commit
    const finalValue = draftValue === '' ? 0 : parseInt(draftValue, 10) || 0;
    commitValue(finalValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const handleButtonClick = (delta: number) => {
    const current = parseInt(draftValue, 10) || 0;
    const newValue = current + delta;
    commitValue(newValue);
  };

  return (
    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0"
        onClick={() => handleButtonClick(-1)}
        disabled={disabled || (parseInt(draftValue, 10) || 0) <= 0}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Input
        ref={inputRef}
        type="number"
        min="0"
        max={maxValue}
        value={draftValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-12 h-7 text-center text-sm px-1"
        disabled={disabled}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0"
        onClick={() => handleButtonClick(1)}
        disabled={disabled || (parseInt(draftValue, 10) || 0) >= maxValue}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
