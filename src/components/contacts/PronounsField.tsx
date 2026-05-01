import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRONOUN_OPTIONS, isPresetPronoun } from '@/lib/pronounOptions';

interface PronounsFieldProps {
  /** Stored value (the literal text saved to the database) or null when unset. */
  value: string | null;
  /** Called with the new stored value (preset string, free-text string, or null when cleared). */
  onChange: (next: string | null) => void;
  label?: string;
  className?: string;
}

const NONE = '__NONE__';
const OTHER = 'other';

/**
 * Pronouns picker for internal contact forms. Renders a dropdown of common
 * presets plus an "Other (specify)" option. Selecting Other reveals a text
 * input; the free-form value is stored in the same column (no marker prefix).
 */
export function PronounsField({ value, onChange, label = 'Pronouns (optional)', className }: PronounsFieldProps) {
  const trimmed = value?.trim() ?? '';
  const isOther = trimmed.length > 0 && !isPresetPronoun(trimmed);
  const selectValue = trimmed === '' ? NONE : isOther ? OTHER : trimmed;

  const handleSelect = (next: string) => {
    if (next === NONE) {
      onChange(null);
    } else if (next === OTHER) {
      // Switching to Other clears the stored value until the user types
      // something. Keeps the row column clean rather than persisting "other".
      onChange('');
    } else {
      onChange(next);
    }
  };

  return (
    <div className={className}>
      <Label>{label}</Label>
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger>
          <SelectValue placeholder="Select pronouns" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {PRONOUN_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectValue === OTHER && (
        <Input
          className="mt-2"
          value={trimmed}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
          placeholder="Specify pronouns"
          maxLength={40}
        />
      )}
    </div>
  );
}
