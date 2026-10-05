import type { PackL1Node, PackGroupMode } from './PackGroupedView';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printPackList(tree: PackL1Node[], mode: PackGroupMode) {
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
  const title = mode === 'account' ? 'Account → Roast' : 'Roast → Account';
  const grandUnits = tree.reduce((s, l1) => s + l1.totalUnits, 0);

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
                <td class="chk"><span class="box"></span></td>
                <td><span class="pname">${esc(leaf.productName)}</span> <span class="size">${leaf.bagSizeG}g</span>${stock}${grind}</td>
                <td class="num">${leaf.units}</td>
              </tr>`;
            })
            .join('');
          return `<div class="l2"><h3>${esc(l2.label)} <span class="muted">· ${l2.totalUnits} units</span></h3>
            <table><thead><tr><th></th><th>Product</th><th class="num">Units</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .join('');
      return `<section><h2>${esc(l1.label)} <span class="muted">· ${l1.totalUnits} units</span></h2>${l2s}</section>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pack List</title>
<style>
body{font-family:system-ui,sans-serif;color:#000;margin:24px;font-size:14px;line-height:1.35}
h1{font-size:22px;margin:0;letter-spacing:.3px}.meta{color:#444;margin:6px 0 18px;font-size:13px}
section{margin-bottom:22px;border-top:3px solid #000;padding-top:8px}
h2{font-size:17px;text-transform:uppercase;margin:0 0 8px;letter-spacing:.4px}
h3{font-size:14px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1px solid #000}
.muted{color:#555;font-weight:normal;font-size:12px;text-transform:none}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid #999;padding:9px 8px;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#333;border-bottom:2px solid #000}
.num{text-align:right;width:74px;font-size:20px;font-weight:800;line-height:1}
.chk{width:30px}.box{display:inline-block;width:18px;height:18px;border:2px solid #000;border-radius:3px;vertical-align:middle}
.pname{font-size:16px;font-weight:700}
.size{display:inline-block;border:1.5px solid #000;border-radius:4px;padding:1px 7px;font-size:12px;font-weight:700;margin-left:4px;white-space:nowrap}
.grind{font-weight:700;margin-top:5px;font-size:14px}
.tag{border:1.5px solid #000;padding:1px 6px;font-size:11px;font-weight:700;margin-left:6px;white-space:nowrap}
.tag-inv{background:#000;color:#fff;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:.6px;margin-right:4px}
tr{break-inside:avoid}h2,h3{break-after:avoid}
tr.needs-grind td{background:#e6e6e6}
tr.needs-grind td:first-child{box-shadow:inset 7px 0 0 #000}
.l2{margin-left:10px}
.foot{margin-top:18px;border-top:2px solid #000;padding-top:6px;font-weight:700;font-size:14px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>Pack List — ${title}</h1><div class="meta">Printed ${esc(now)} · ${grandUnits} units total</div>
${sections || '<p>No packing demand.</p>'}
<div class="foot">Total: ${grandUnits} units</div>
<script>window.onload=()=>{window.print()}</script></body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
