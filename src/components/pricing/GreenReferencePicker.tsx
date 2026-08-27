import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Layers, Package } from 'lucide-react';
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
import { useGreenReferences, type GreenReference } from '@/hooks/useGreenReferences';

interface Props {
  /** Applies the reference's market value to the benchmark field. */
  onUseAsBenchmark: (perKg: number) => void;
  /** Applies it as the line's market value instead. */
  onUseAsMarket: (perKg: number) => void;
}

const perKg = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

/**
 * Green price reference points, inline.
 *
 * Setting a benchmark means choosing a ceiling with headroom over what the
 * coffee actually costs — a judgement that needs the real numbers to hand.
 * Without this you would leave the sheet, look up a roast group, and come back,
 * which is exactly the round trip that makes quoting slow.
 *
 * It suggests rather than decides: the value is shown, and applying it is a
 * separate click, because a benchmark is usually a round number above the
 * reference rather than the reference itself.
 */
export function GreenReferencePicker({ onUseAsBenchmark, onUseAsMarket }: Props) {
  const { data: references = [], isLoading } = useGreenReferences();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => references.find((r) => `${r.kind}:${r.id}` === selectedId) ?? null,
    [references, selectedId],
  );

  const groups = references.filter((r) => r.kind === 'ROAST_GROUP');
  const lots = references.filter((r) => r.kind === 'LOT');

  const renderItem = (r: GreenReference) => {
    const key = `${r.kind}:${r.id}`;
    return (
      <CommandItem
        key={key}
        value={`${r.label} ${r.sublabel}`}
        onSelect={() => {
          setSelectedId(key);
          setOpen(false);
        }}
      >
        <Check
          className={cn('mr-2 h-4 w-4', selectedId === key ? 'opacity-100' : 'opacity-0')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{r.label}</span>
          <span className="block truncate text-xs text-muted-foreground">{r.sublabel}</span>
        </span>
        <span className="ml-2 shrink-0 font-mono text-sm">{perKg(r.marketPerKg)}</span>
      </CommandItem>
    );
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-8 font-normal"
            disabled={isLoading || references.length === 0}
          >
            <span className="truncate text-muted-foreground">
              {isLoading
                ? 'Loading references…'
                : references.length === 0
                  ? 'No priced roast groups or lots'
                  : selected
                    ? selected.label
                    : 'Compare against a roast group or lot…'}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search roast groups and lots…" />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.length > 0 && (
                <CommandGroup heading="Roast groups">{groups.map(renderItem)}</CommandGroup>
              )}
              {lots.length > 0 && (
                <CommandGroup heading="Green lots">{lots.map(renderItem)}</CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected && (
        <div className="rounded-md border bg-muted/40 p-2.5 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {selected.kind === 'ROAST_GROUP' ? (
              <Layers className="h-3.5 w-3.5" />
            ) : (
              <Package className="h-3.5 w-3.5" />
            )}
            <span className="truncate">
              {selected.kind === 'ROAST_GROUP' ? 'Roast group' : 'Green lot'} · {selected.sublabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            <div>
              <span className="block text-xs text-muted-foreground">Market value</span>
              <span className="font-semibold">{perKg(selected.marketPerKg)}/kg</span>
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">Landed book value</span>
              <span className="text-muted-foreground">{perKg(selected.bookPerKg)}/kg</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={selected.marketPerKg == null}
              onClick={() => onUseAsBenchmark(selected.marketPerKg as number)}
            >
              Use as benchmark
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={selected.marketPerKg == null}
              onClick={() => onUseAsMarket(selected.marketPerKg as number)}
            >
              Use as market value
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A benchmark is normally set above the reference, so the coffee has headroom under it.
          </p>
        </div>
      )}
    </div>
  );
}

export default GreenReferencePicker;
