export type MixingConsoleValue = any;
export type MixingConsoleVariant = any;

export function buildEmptyMixingConsoleValue(..._args: any[]): any {
  return {};
}

export function stripRedundantOverrides(..._args: any[]): any {
  return {};
}

export function useAccountPricingPreset(..._args: any[]): any {
  return { data: null, isLoading: false };
}

export function MixingConsole(_props: any) {
  return (
    <div className="p-4 text-sm text-muted-foreground border rounded-md">
      Pricing update in progress — check back soon.
    </div>
  );
}

export default MixingConsole;
