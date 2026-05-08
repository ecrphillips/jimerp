import type { ColumnDef } from './types';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function exportRowsToCsv<TRow>(
  rows: TRow[],
  columns: ColumnDef<TRow>[],
  getRowId: (row: TRow) => string,
  filename: string,
) {
  const headers = ['__row_id', ...columns.map((c) => c.key)];
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvField).join(','));

  for (const row of rows) {
    const values: unknown[] = [getRowId(row)];
    for (const col of columns) {
      const raw = col.getValue(row);
      values.push(raw);
    }
    lines.push(values.map(escapeCsvField).join(','));
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
