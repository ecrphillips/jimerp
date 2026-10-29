/**
 * WIP bin labels — 4 × 6 in portrait, for the Phomemo PM-241-BT thermal printer.
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
  /** Products this WIP feeds: family name + customer code. */
  products?: { name: string; accountCode: string | null }[];
  /** Post-roast blends: the component batches that went in. */
  componentDetails?: { roastGroupName: string; batchNumber: string }[];
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
  const products = data.products ?? [];
  const comps = data.componentDetails ?? [];
  const productHtml = products.length
    ? `<ul class="list" id="products">${products.map((p) => `<li><span class="pn">${esc(p.name)}</span>${p.accountCode ? `<span class="ac">${esc(p.accountCode)}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const compHtml = comps.length
    ? `<ul class="list comps" id="comps">${comps.map((c) => `<li><span class="pn">${esc(c.roastGroupName)}</span><span class="ac">${esc(c.batchNumber)}</span></li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(data.batchNumber)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 4in; height: 6in; background: #fff; color: #000; overflow: hidden; }
  .label { position: absolute; top: 0; left: 0; }
  body { font-family: "Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif; font-weight: 900;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: 4in; height: 6in; padding: 0.2in 0.2in 0.14in; display: flex; flex-direction: column; overflow: hidden; }
  .name { height: 2.3in; flex: none; display: flex; align-items: flex-start; overflow: hidden; }
  .name span { display: block; line-height: 1.0; overflow-wrap: normal; word-break: normal; }
  .date { margin-top: 0.06in; font-size: 0.85in; line-height: 0.95; white-space: nowrap; flex: none; }
  .rule { border-top: 0.05in solid #000; margin: 0.1in 0 0.08in; flex: none; }
  .details { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start; gap: 0.08in; }
  .list { list-style: none; font-size: 18px; line-height: 1.2; }
  .list li { display: flex; justify-content: space-between; gap: 0.1in; }
  .pn { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ac { flex: none; }
  .comps { border-top: 0.03in solid #000; padding-top: 0.06in; }
  .more { font-size: 14px; }
  .foot { flex: none; margin-top: auto; font-size: 0.16in; text-align: right; padding-top: 0.04in; }
  @media screen { body { outline: 1px solid #000; } }
</style></head>
<body>
  <div class="label">
    <div class="name" id="nameBox"><span id="name">${esc(data.roastGroupName)}</span></div>
    <div class="date">${esc(labelDate(data.batchDate))}</div>
    <div class="rule"></div>
    <div class="details" id="details">${productHtml}${compHtml}</div>
    <div class="foot">${esc(data.batchNumber)}</div>
  </div>
<script>
  (function () {
    var box = document.getElementById('nameBox');
    var el = document.getElementById('name');
    var size = 130;
    function lines() { return Math.round(el.offsetHeight / size); }
    el.style.fontSize = size + 'px';
    while (size > 18 && (lines() > 3 || el.scrollWidth > box.clientWidth || el.offsetHeight > box.clientHeight)) {
      size -= 2; el.style.fontSize = size + 'px';
    }
    var details = document.getElementById('details');
    function overflows() { return details.scrollHeight > details.clientHeight + 1; }
    var lists = details.querySelectorAll('.list');
    var fs = 18;
    while (fs > 11 && overflows()) { fs -= 1; for (var i = 0; i < lists.length; i++) lists[i].style.fontSize = fs + 'px'; }
    // Still too long: trim the product list and say how many were left off.
    var prod = document.getElementById('products');
    if (prod && overflows()) {
      var hidden = 0;
      var more = document.createElement('li'); more.className = 'more'; prod.appendChild(more);
      while (overflows() && prod.children.length > 2) { prod.removeChild(prod.children[prod.children.length - 2]); hidden++; more.textContent = '+ ' + hidden + ' more'; }
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
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '4in', height: '6in', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Could not prepare the label');
  doc.open();
  doc.write(labelHtml(data));
  doc.close();
}
