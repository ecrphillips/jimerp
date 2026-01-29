import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus } from 'lucide-react';

interface CaseQuantityInputProps {
  value: number;
  onChange: (qty: number) => void;
  caseSize: number;
  min?: number;
  disabled?: boolean;
  size?: 'sm' | 'default';
}

/**
 * Quantity input that enforces case-based increments.
 * +/- buttons increment by caseSize, and manual input is rounded to nearest case.
 */
export function CaseQuantityInput({
  value,
  onChange,
  caseSize,
  min = 0,
  disabled = false,
  size = 'default',
}: CaseQuantityInputProps) {
  const [inputValue, setInputValue] = useState<string>(value.toString());
  const [isFocused, setIsFocused] = useState(false);

  // Sync input with external value when not focused
  useEffect(() => {
    if (!isFocused) {
      setInputValue(value === 0 ? '' : value.toString());
    }
  }, [value, isFocused]);

  const handleIncrement = () => {
    const newValue = value + caseSize;
    onChange(newValue);
  };

  const handleDecrement = () => {
    const newValue = Math.max(min, value - caseSize);
    onChange(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setInputValue(raw);
  };

  const handleBlur = () => {
    setIsFocused(false);
    
    // Parse and round to nearest case
    const parsed = parseInt(inputValue, 10) || 0;
    const rounded = Math.round(parsed / caseSize) * caseSize;
    const final = Math.max(min, rounded);
    
    onChange(final);
    setInputValue(final === 0 ? '' : final.toString());
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const buttonClass = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  const inputClass = size === 'sm' ? 'w-12 h-6 text-xs' : 'w-14 h-7 text-sm';
  const iconClass = 'h-3 w-3';

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="outline"
        className={buttonClass}
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        type="button"
      >
        <Minus className={iconClass} />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        className={`${inputClass} text-center px-1`}
        value={inputValue}
        placeholder="0"
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button
        size="icon"
        variant="outline"
        className={buttonClass}
        onClick={handleIncrement}
        disabled={disabled}
        type="button"
      >
        <Plus className={iconClass} />
      </Button>
    </div>
  );
}
