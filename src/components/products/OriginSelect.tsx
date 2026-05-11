import React, { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  ORIGIN_GROUPS,
  ORIGIN_CUSTOM_SENTINEL,
  isKnownOrigin,
} from '@/lib/originOptions';

const NONE_VALUE = '__none__';

export interface OriginSelectValue {
  value: string;
  customValue: string;
}

interface Props {
  value: string;
  customValue: string;
  onChange: (next: OriginSelectValue) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

/**
 * Grouped origin picker. `value` is either '' (none), a known origin,
 * or ORIGIN_CUSTOM_SENTINEL. When sentinel, `customValue` holds the
 * free-text entry. Legacy values not in the known set auto-promote to
 * custom mode.
 */
export function OriginSelect({
  value,
  customValue,
  onChange,
  placeholder = 'Select origin…',
  id,
  disabled,
}: Props) {
  // Auto-promote legacy free-text origin to custom mode
  useEffect(() => {
    if (value && value !== ORIGIN_CUSTOM_SENTINEL && !isKnownOrigin(value)) {
      onChange({ value: ORIGIN_CUSTOM_SENTINEL, customValue: value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectValue = value === '' ? NONE_VALUE : value;

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === NONE_VALUE) onChange({ value: '', customValue: '' });
          else if (v === ORIGIN_CUSTOM_SENTINEL) onChange({ value: ORIGIN_CUSTOM_SENTINEL, customValue });
          else onChange({ value: v, customValue: '' });
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{placeholder}</SelectItem>
          {ORIGIN_GROUPS.map((group, idx) => (
            <React.Fragment key={group.label}>
              <SelectSeparator />
              <SelectGroup>
                {group.label && <SelectLabel>{group.label}</SelectLabel>}
                {group.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectGroup>
              {idx === ORIGIN_GROUPS.length - 1 && <SelectSeparator />}
            </React.Fragment>
          ))}
          <SelectItem value={ORIGIN_CUSTOM_SENTINEL}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {value === ORIGIN_CUSTOM_SENTINEL && (
        <Input
          placeholder="Enter origin"
          value={customValue}
          onChange={(e) => onChange({ value: ORIGIN_CUSTOM_SENTINEL, customValue: e.target.value })}
          disabled={disabled}
        />
      )}
    </div>
  );
}
