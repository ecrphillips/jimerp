import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export type RecipientKind = 'account' | 'prospect';

export type RecipientOption = {
  id: string;
  label: string;
  kind: RecipientKind;
};

interface RecipientPickerProps {
  kind: RecipientKind;
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
}

export function RecipientPicker({ kind, value, onChange, placeholder }: RecipientPickerProps) {
  const [open, setOpen] = useState(false);

  const { data: options } = useQuery<RecipientOption[]>({
    queryKey: ['recipient-options', kind],
    queryFn: async () => {
      if (kind === 'account') {
        const { data, error } = await supabase
          .from('accounts')
          .select('id, account_name, is_active')
          .eq('is_active', true)
          .order('account_name');
        if (error) throw error;
        return (data ?? []).map((a) => ({
          id: a.id,
          label: a.account_name ?? '(unnamed)',
          kind: 'account' as RecipientKind,
        }));
      }
      const { data, error } = await supabase
        .from('prospects')
        .select('id, business_name')
        .order('business_name');
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        label: p.business_name ?? '(unnamed)',
        kind: 'prospect' as RecipientKind,
      }));
    },
  });

  const selected = useMemo(
    () => options?.find((o) => o.id === value),
    [options, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? selected.label : placeholder ?? `Select ${kind}…`}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${kind === 'account' ? 'accounts' : 'prospects'}…`} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {(options ?? []).map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.id, o.label);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === o.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
