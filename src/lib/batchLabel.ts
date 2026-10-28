/**
 * WIP bin labels — 6 × 4 in landscape, for the Phomemo PM-241-BT thermal printer.
 *
 * Pure black on white, heavy sans-serif, no grey or hairlines (thermal smudges them).
 * Readable across the room: the roast group name (biggest), then the date ("OCT 28").
 * Up close: batch number, machine, green in / roasted out,
 * blend components, and the green lot when it fits.
 *
 * Printing goes through a hidden frame (printLabel), so no pop-up is needed.
 */

export interface LabelData {
  /** YYYY-MM-DD (the batch date). */
  batchDate: string;
  roastGroupName: string;
  batchNumber: string;
  machineName: string;
  greenKg: number | null;
  roastedKg: number | null;
  /** Blend labels: component batch numbers. */
  components?: string[];
  /** Single-origin / regular roast groups: green lot text (dropped if it doesn't fit). */
  lotText?: string | null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-10-28" → "OCT 28". */
export function labelDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number);
  if (!m || !d) return isoDate;
  return `${MONTHS[m - 1]} ${d}`;
}

/** Label name if set, else the first word of the full name. */
export function roasterFirstName(profile: { label_name?: string | null; name?: string | null } | null | undefined): string | null {
  if (!profile) return null;
  const label = profile.label_name?.trim();
  if (label) return label;
  const first = profile.name?.trim().split(/\s+/)[0];
  return first || null;
}

export function machineName(machine: string | null | undefined): string {
  if (machine === 'LORING') return 'Loring';
  if (machine === 'SAMIAC') return 'Samiac';
  if (machine === 'BLEND') return 'Blend';
  return '—';
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

const kg = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)} kg`);

export function labelHtml(data: LabelData): string {
  const details = [
    `<div class="row top"><span class="num">${esc(data.batchNumber)}</span><span>${esc(data.machineName)}</span></div>`,
    `<div class="row"><span>IN ${esc(kg(data.greenKg))}</span><span>OUT ${esc(kg(data.roastedKg))}</span></div>`,
  ];
  if (data.components && data.components.length > 0) {
    details.push(`<div class="comps">${data.components.map((c) => `<span class="nw">${esc(c)}</span>`).join(' ')}</div>`);
  }
  if (data.lotText) {
    details.push(`<div class="lot" id="lot">${esc(data.lotText)}</div>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(data.batchNumber)}</title>
<style>
  @page { size: 6in 4in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 6in; height: 4in; background: #fff; color: #000; }
  body {
    font-family: "Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif;
    font-weight: 900;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .label { width: 6in; height: 4in; padding: 0.18in 0.22in; display: flex; flex-direction: column; overflow: hidden; }
  .name { height: 1.75in; flex: none; display: flex; align-items: center; overflow: hidden; }
  .date { margin-top: 0.04in; font-size: 0.6in; line-height: 0.95; letter-spacing: -0.01in; white-space: nowrap; flex: none; }
  .name span { display: block; line-height: 1.0; overflow-wrap: normal; word-break: normal; }
  .rule { border-top: 0.05in solid #000; margin: 0.06in 0 0.05in; flex: none; }
  .details { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-start; gap: 0.02in; overflow: hidden; }
  .num { font-size: 0.34in; line-height: 1.0; }
  .row.top { align-items: baseline; }
  .row { display: flex; justify-content: space-between; font-size: 0.2in; line-height: 1.1; }
  .comps { font-size: 16px; line-height: 1.15; }
  .nw { white-space: nowrap; margin-right: 0.08in; }
  .lot { font-size: 0.16in; line-height: 1.15; white-space: nowrap; overflow: hidden; }
  @media screen { body { outline: 1px solid #000; } }
</style></head>
<body>
  <div class="label">
    <div class="name" id="nameBox"><span id="name">${esc(data.roastGroupName)}</span></div>
    <div class="date">${esc(labelDate(data.batchDate))}</div>
    <div class="rule"></div>
    <div class="details" id="details">${details.join('')}</div>
  </div>
<script>
  (function () {
    // Roast group name: as big as possible, two lines max.
    var box = document.getElementById('nameBox');
    var el = document.getElementById('name');
    var size = 150;
    function lines() { return Math.round(el.offsetHeight / (size * 1.0)); }
    el.style.fontSize = size + 'px';
    while (size > 18 && (lines() > 2 || el.scrollWidth > box.clientWidth || el.offsetHeight > box.clientHeight)) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
    var details = document.getElementById('details');
    function overflows() { return details.scrollHeight > details.clientHeight + 1; }
    // Blend components: always shown; shrink until they fit.
    var comps = document.querySelector('.comps');
    if (comps) {
      var cs = 16;
      while (cs > 8 && overflows()) { cs -= 1; comps.style.fontSize = cs + 'px'; }
    }
    // Green lot: only if it fits without crowding.
    var lot = document.getElementById('lot');
    if (lot && (lot.scrollWidth > lot.clientWidth + 1 || overflows())) {
      lot.parentNode.removeChild(lot);
    }
    setTimeout(function () { window.focus(); window.print(); }, 150);
  })();
</script>
</body></html>`;
}

/**
 * Print a label from a hidden frame on the current page — no pop-up window,
 * so nothing gets blocked, and with Chrome's kiosk printing it goes straight
 * to the default printer.
 */
export function printLabel(data: LabelData): void {
  const old = document.getElementById('jim-label-frame');
  if (old) old.remove();
  const frame = document.createElement('iframe');
  frame.id = 'jim-label-frame';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '6in', height: '4in', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Could not prepare the label');
  doc.open();
  doc.write(labelHtml(data));
  doc.close();
}
