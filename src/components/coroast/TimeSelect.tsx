import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 5; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? 'PM' : 'AM';
    TIME_OPTIONS.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` });
  }
}

interface TimeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export function TimeSelect({ value, onValueChange, placeholder = 'Select time' }: TimeSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[200px]">
        {TIME_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
