import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, Loader2, Check } from 'lucide-react';
import { blockNonIntegerKeys } from '@/lib/numericInput';

interface InlinePackingControlProps {
  unitLabel?: 'case' | 'bag';
  /** Current packed total (absolute). */
  value: number;
  /** Receives the new absolute packed total. */
  onCommit: (newValue: number) => Promise<void>;
  onEditingChange?: (isEditing: boolean) => void;
  disabled?: boolean;
  isComplete?: boolean;
  /** Target packed total; enables the "All packed" button. */
  fillValue?: number;
}

/**
 * Additive packing entry: staff type how many bags they just packed and press
 * Add — the control adds it to the running total, so nobody does mental math.
 * −/+ correct the total by one bag.
 */
export function InlinePackingControl({
  value,
  unitLabel = 'bag',
  onCommit,
  onEditingChange,
  disabled = false,
  fillValue,
}: InlinePackingControlProps) {
  const [addText, setAddText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [total, setTotal] = useState(value);
  const committingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!committingRef.current) setTotal(value);
  }, [value]);

  const commit = useCallback(async (next: number) => {
    next = Math.max(0, next);
    setTotal(next);
    if (committingRef.current) { pendingRef.current = next; return; }
    committingRef.current = true;
    setIsSaving(true);
    onEditingChange?.(true);
    let target: number | null = next;
    try {
      while (target !== null) {
        await onCommit(target);
        target = pendingRef.current;
        pendingRef.current = null;
      }
    } catch {
      pendingRef.current = null;
      setTotal(value);
    } finally {
      committingRef.current = false;
      setIsSaving(false);
      onEditingChange?.(false);
    }
  }, [onCommit, onEditingChange, value]);

  const addQty = parseInt(addText, 10) || 0;
  const handleAdd = () => {
    if (addQty <= 0) return;
    setAddText('');
    commit(total + addQty);
  };

  return (
    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8"
        onClick={() => commit(total - 1)} disabled={disabled || total <= 0} title={`Remove 1 packed ${unitLabel}`}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          aria-label={unitLabel === 'case' ? 'Cases just packed' : 'Bags just packed'}
          placeholder="+ qty"
          className="w-16 h-8 text-center text-sm px-1"
          value={addText}
          onChange={(e) => setAddText(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={() => onEditingChange?.(true)}
          onBlur={() => onEditingChange?.(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleAdd(); return; }
            blockNonIntegerKeys(e);
          }}
          disabled={disabled}
        />
        {isSaving && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      {addQty > 0 ? (
        <Button type="button" size="sm" className="h-8 px-2 text-xs font-bold" onClick={handleAdd} disabled={disabled}>
          Add {addQty}{unitLabel === 'case' ? ' cases' : ''}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="icon" className="h-8 w-8"
          onClick={() => commit(total + 1)} disabled={disabled} title={`Add 1 packed ${unitLabel}`}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
      {fillValue !== undefined && (
        <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs gap-1"
          onClick={() => commit(fillValue)} disabled={disabled || total >= fillValue} title="All packed">
          <Check className="h-3 w-3" />
          All packed
        </Button>
      )}
    </div>
  );
}
