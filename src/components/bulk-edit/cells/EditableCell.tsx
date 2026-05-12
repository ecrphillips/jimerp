import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
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
import { Checkbox } from '@/components/ui/checkbox';
import type { ColumnDef, SaveResult } from '../types';

interface Props<TRow> {
  row: TRow;
  column: ColumnDef<TRow>;
  isHighlighted: boolean;
  onSave: (newValue: unknown) => Promise<SaveResult>;
}

export function EditableCell<TRow>({ row, column, isHighlighted, onSave }: Props<TRow>) {
  const initial = column.getValue(row);
  const [value, setValue] = useState<unknown>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forceCustom, setForceCustom] = useState(false);
  const lastSavedRef = useRef<unknown>(initial);

  useEffect(() => {
    setValue(initial);
    lastSavedRef.current = initial;
    setForceCustom(false);
  }, [initial]);

  const formatted = column.format ? column.format(value, row) : (value ?? '');

  if (column.readOnly) {
    return (
      <td className="px-2 py-1 text-xs text-muted-foreground bg-muted/30 border-r last:border-r-0 truncate" style={{ width: column.width }}>
        {String(formatted ?? '')}
      </td>
    );
  }

  const commit = async (next: unknown) => {
    if (Object.is(next, lastSavedRef.current)) return;
    if (!column.allowEmpty && (next === '' || next === null || next === undefined)) {
      setError('Required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(next);
      if (!result.success) {
        const msg = result.errorMessage ?? 'Save failed';
        setError(msg);
        toast.error(`${column.header}: ${msg}`);
        setValue(lastSavedRef.current);
      } else {
        const display = result.newDisplayValue !== undefined ? result.newDisplayValue : next;
        setValue(display);
        lastSavedRef.current = display;
      }
    } finally {
      setSaving(false);
    }
  };

  const cellClass = cn(
    'px-1 py-0.5 border-r last:border-r-0 align-top',
    isHighlighted && 'bg-amber-100 dark:bg-amber-900/40',
    error && 'ring-1 ring-destructive ring-inset',
  );

  return (
    <td className={cellClass} style={{ width: column.width }} title={error ?? undefined}>
      {column.type === 'text' && (
        <Input
          className="h-7 text-xs"
          value={(value as string) ?? ''}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commit(value)}
          disabled={saving}
        />
      )}
      {column.type === 'number' && (
        <Input
          type="number"
          className="h-7 text-xs"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v === '' ? null : Number(v));
          }}
          onBlur={() => commit(value)}
          disabled={saving}
        />
      )}
      {column.type === 'date' && (
        <Input
          type="date"
          className="h-7 text-xs"
          value={(value as string) ?? ''}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commit(value)}
          disabled={saving}
        />
      )}
      {column.type === 'select' && (() => {
        const CUSTOM = '__custom__';
        const strValue = value === null || value === undefined ? '' : String(value);
        const knownValues = new Set<string>([
          ...(column.options ?? []).map((o) => o.value),
          ...(column.groups ?? []).flatMap((g) => g.options.map((o) => o.value)),
        ]);
        const isUnknownExisting = column.allowCustom && strValue !== '' && !knownValues.has(strValue);
        const inCustomMode = column.allowCustom && (forceCustom || isUnknownExisting);
        const selectValue = inCustomMode ? CUSTOM : strValue === '' ? '__none__' : strValue;

        if (inCustomMode) {
          return (
            <div className="flex items-center gap-1">
              <Input
                className="h-7 text-xs flex-1"
                value={(value as string) ?? ''}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => commit(value)}
                disabled={saving}
              />
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline px-1"
                onClick={() => { setForceCustom(false); setValue(null); commit(null); }}
                disabled={saving}
              >
                clear
              </button>
            </div>
          );
        }

        return (
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === '__none__') { setForceCustom(false); setValue(null); commit(null); return; }
              if (v === CUSTOM) { setForceCustom(true); setValue(''); return; }
              setForceCustom(false);
              setValue(v);
              commit(v);
            }}
            disabled={saving}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {column.allowEmpty && <SelectItem value="__none__">—</SelectItem>}
              {(column.options ?? []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
              {(column.groups ?? []).map((group, idx) => (
                <React.Fragment key={group.label ?? `g-${idx}`}>
                  <SelectSeparator />
                  <SelectGroup>
                    {group.label && <SelectLabel>{group.label}</SelectLabel>}
                    {group.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </React.Fragment>
              ))}
              {column.allowCustom && (
                <>
                  <SelectSeparator />
                  <SelectItem value={CUSTOM}>Other…</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        );
      })()}
      {column.type === 'boolean' && (
        <div className="flex items-center justify-center h-7">
          <Checkbox
            checked={!!value}
            onCheckedChange={(c) => {
              const next = !!c;
              setValue(next);
              commit(next);
            }}
            disabled={saving}
          />
        </div>
      )}
      {error && <p className="text-[10px] text-destructive mt-0.5 truncate">{error}</p>}
    </td>
  );
}
