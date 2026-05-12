export type CellType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOptionGroup {
  label?: string;
  options: SelectOption[];
}

export interface ColumnDef<TRow = any> {
  key: string;
  header: string;
  type: CellType;
  readOnly?: boolean;
  width?: string;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  allowCustom?: boolean;
  getValue: (row: TRow) => unknown;
  format?: (value: unknown, row: TRow) => string;
  allowEmpty?: boolean;
}

export interface SaveResult {
  success: boolean;
  errorMessage?: string;
  newDisplayValue?: unknown;
}

export interface CellAddress {
  rowId: string;
  colKey: string;
}

export interface UndoEntry extends CellAddress {
  prevValue: unknown;
}

export interface ChangeHighlight {
  ts: number;
}

export type ChangeMap = Record<string, Record<string, Record<string, ChangeHighlight>>>;
