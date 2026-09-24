import type { PackL1Node, PackGroupMode } from './PackGroupedView';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printPackList(tree: PackL1Node[], mode: PackGroupMode) {
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
  const title = mode === 'account' ? 'Account → Roast' : 'Roast → Account';

  const sections = tree
    .map((l1) => {
      const l2s = l1.children
        .map((l2) => {
          const rows = l2.leaves
            .map((leaf) => {
              const isGrind = leaf.grindUnits > 0;
              const grind = isGrind
                ? `<div class="grind"><span class="tag-inv">GRIND</span> ${leaf.grindUnits} to grind: ${Object.entries(leaf.grindByLabel)
                      .map(([l, q]) => `${q} × ${esc(l)}`)
                      .join(', ')}${leaf.wholeBeanUnits > 0 ? ` · ${leaf.wholeBeanUnits} whole bean` : ''}</div>`
                  : '';
              const stock = leaf.requiresProduction ? '' : '<span class="tag">PULL FROM STOCK</span>';
              return `<tr${isGrind ? ' class="needs-grind"' : ''}>
                <td class="chk">☐</td>
                <td><strong>${esc(leaf.productName)}</strong> ${stock}${grind}</td>
                <td>${leaf.bagSizeG}g</td>
                <td class="sku">${esc(leaf.sku || '—')}</td>
                <td class="num">${leaf.units}</td>
              </tr>`;
            })
            .join('');
          return `<div class="l2"><h3>${esc(l2.label)} <span class="muted">· ${l2.totalUnits} units</span></h3>
            <table><thead><tr><th></th><th>Product</th><th>Size</th><th>SKU</th><th class="num">Units</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .join('');
      return `<section><h2>${esc(l1.label)} <span class="muted">· ${l1.totalUnits} units</span></h2>${l2s}</section>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pack List</title>
<style>
body{font-family:system-ui,sans-serif;color:#111;margin:24px;font-size:12px}
h1{font-size:18px;margin:0}.meta{color:#555;margin:4px 0 16px}
section{break-inside:avoid-page;margin-bottom:18px;border-top:2px solid #111;padding-top:6px}
h2{font-size:15px;text-transform:uppercase;margin:0 0 6px}h3{font-size:13px;margin:8px 0 4px}
.muted{color:#666;font-weight:normal;font-size:11px;text-transform:none}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{font-size:10px;text-transform:uppercase;color:#555}.num{text-align:right;width:50px;font-weight:bold}
.chk{width:18px;font-size:14px}.sku{font-family:monospace;font-size:10px}
.grind{font-weight:bold;margin-top:2px}.tag{border:1px solid #111;padding:0 4px;font-size:9px;font-weight:bold}
.l2{break-inside:avoid;margin-left:8px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>Pack List — ${title}</h1><div class="meta">Printed ${esc(now)}</div>
${sections || '<p>No packing demand.</p>'}
<script>window.onload=()=>{window.print()}</script></body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
