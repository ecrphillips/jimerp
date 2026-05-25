import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check } from 'lucide-react';

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

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value.toString());
    }
  }, [value, isFocused]);

  const commitValue = (newValue: number) => {
    const clamped = Math.max(0, Math.min(newValue, maxValue));
    setDraftValue(clamped.toString());
    onCommit(clamped);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (inputValue === '') {
      setDraftValue('');
      return;
    }

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
    const finalValue = draftValue === '' ? 0 : parseInt(draftValue, 10) || 0;
    commitValue(finalValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const handlePickAll = () => {
    commitValue(maxValue);
  };

  const currentValue = parseInt(draftValue, 10) || 0;

  return (
    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
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
        className="w-16 h-7 text-center text-sm px-1"
        disabled={disabled}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1"
        onClick={handlePickAll}
        disabled={disabled || currentValue >= maxValue}
        title="Pick all"
      >
        <Check className="h-3 w-3" />
        Pick all
      </Button>
    </div>
  );
}
