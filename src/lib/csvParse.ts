// Minimal RFC4180 CSV parser. Handles quoted fields, embedded commas,
// escaped double-quotes ("") and CRLF/LF/CR line endings.
// Returns rows of strings + a separate header array.
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const out: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      // possible CRLF
      if (text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  // Drop completely-empty trailing rows
  while (out.length && out[out.length - 1].every(s => s === '')) out.pop();
  if (out.length === 0) return { header: [], rows: [] };
  const header = out[0].map(h => h.trim());
  return { header, rows: out.slice(1) };
}
