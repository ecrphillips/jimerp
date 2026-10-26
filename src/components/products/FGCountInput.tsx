import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

interface FGCountInputProps {
  units: number;
  productName: string;
  disabled: boolean;
  onCount: (units: number) => void;
}

export function FGCountInput({ units, productName, disabled, onCount }: FGCountInputProps) {
  const [draft, setDraft] = useState(String(units));
  const editing = useRef(false);
  const changed = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(String(units));
  }, [units, disabled]);

  const commit = () => {
    editing.current = false;
    if (!changed.current) {
      setDraft(String(units));
      return;
    }
    changed.current = false;
    const count = Number(draft);
    if (draft.trim() === '' || !Number.isSafeInteger(count) || count < 0) {
      setDraft(String(units));
      return;
    }
    onCount(count);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      aria-label={`On hand for ${productName}`}
      className="w-16 h-7 text-center text-sm px-1"
      value={draft}
      disabled={disabled}
      onFocus={() => { editing.current = true; }}
      onChange={(event) => {
        changed.current = true;
        setDraft(event.target.value.replace(/[^0-9]/g, ''));
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          changed.current = false;
          setDraft(String(units));
          event.currentTarget.blur();
        }
      }}
    />
  );
}