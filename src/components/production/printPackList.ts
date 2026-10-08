import type { PackL1Node, PackGroupMode, PackLeafNode } from './PackGroupedView';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Print the pack list. Completed lines are excluded; for the rest the big
 * number is the units still to pack, with the packed/needed count alongside.
 * Packed counts are per-SKU global (available + picked), matching the screen.
 */
export function printPackList(
  tree: PackL1Node[],
  mode: PackGroupMode,
  availableByProduct: Record<string, number> = {},
  pickedByProduct: Record<string, number> = {},
) {
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
  const title = mode === 'account' ? 'Account → Roast' : 'Roast → Account';

  // Per-leaf progress, mirroring leafProgress in PackGroupedView: a line is
  // complete only when the SKU's global demand is fully covered.
  const progressFor = (leaf: PackLeafNode, globalDemand: number) => {
    if (!leaf.requiresProduction) return { packed: leaf.units, complete: true };
    const effectivePacked = Math.min(globalDemand, (availableByProduct[leaf.productId] ?? 0) + (pickedByProduct[leaf.productId] ?? 0));
    const complete = globalDemand > 0 && effectivePacked >= globalDemand;
    return { packed: complete ? leaf.units : Math.min(leaf.units, effectivePacked), complete };
  };

  const globalDemandOf = (leaves: PackLeafNode[], productId: string) =>
    leaves.filter((l) => l.productId === productId).reduce((s, l) => s + l.units, 0);

  let grandRemaining = 0;
  let grandPacked = 0;
  let grandNeeded = 0;

  const sections = tree
    .map((l1) => {
      const allLeaves = l1.children.flatMap((l2) => l2.leaves);
      const l2s = l1.children
        .map((l2) => {
          const rows = l2.leaves
            .map((leaf) => {
              const { packed, complete } = progressFor(leaf, globalDemandOf(allLeaves, leaf.productId));
              if (complete) return '';
              const remaining = leaf.units - packed;
              grandRemaining += remaining;
              grandPacked += packed;
              grandNeeded += leaf.units;
              const isGrind = leaf.grindUnits > 0;
              const grind = isGrind
                ? `<div class="grind"><span class="tag-inv">GRIND</span> ${leaf.grindUnits} to grind: ${Object.entries(leaf.grindByLabel)
                      .map(([l, q]) => `${q} × ${esc(l)}`)
                      .join(', ')}${leaf.wholeBeanUnits > 0 ? ` · ${leaf.wholeBeanUnits} whole bean` : ''}</div>`
                  : '';
              const stock = leaf.requiresProduction ? '' : '<span class="tag">PULL FROM STOCK</span>';
              const progress = packed > 0 ? `<span class="prog">${packed}/${leaf.units} packed</span>` : '';
              return `<tr${isGrind ? ' class="needs-grind"' : ''}>
                <td class="chk"><span class="box"></span></td>
                <td><span class="pname">${esc(leaf.productName)}</span> <span class="size">${leaf.bagSizeG}g</span>${stock}${grind}</td>
                <td class="num">${remaining}${progress}</td>
              </tr>`;
            })
            .filter(Boolean)
            .join('');
          if (!rows) return '';
          const remaining = l2.leaves.reduce((s, leaf) => {
            const { packed, complete } = progressFor(leaf, globalDemandOf(allLeaves, leaf.productId));
            return complete ? s : s + (leaf.units - packed);
          }, 0);
          return `<div class="l2"><h3>${esc(l2.label)} <span class="muted">· ${remaining} to pack</span></h3>
            <table><thead><tr><th></th><th>Product</th><th class="num">To pack</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .filter(Boolean)
        .join('');
      if (!l2s) return '';
      const remaining = l1.children.reduce((s, l2) => s + l2.leaves.reduce((s2, leaf) => {
        const { packed, complete } = progressFor(leaf, globalDemandOf(allLeaves, leaf.productId));
        return complete ? s2 : s2 + (leaf.units - packed);
      }, 0), 0);
      return `<section><h2>${esc(l1.label)} <span class="muted">· ${remaining} to pack</span></h2>${l2s}</section>`;
    })
    .filter(Boolean)
    .join('');

  const summary = grandPacked > 0 ? ` · ${grandPacked}/${grandNeeded} already packed` : '';

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
.num{text-align:right;width:110px;font-size:20px;font-weight:800;line-height:1}
.prog{display:block;font-size:11px;font-weight:600;color:#555;margin-top:2px}
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
<h1>Pack List — ${title}</h1><div class="meta">Printed ${esc(now)} · ${grandRemaining} units left to pack${esc(summary)}</div>
${sections || '<p>Nothing left to pack — everything is complete.</p>'}
<div class="foot">Remaining: ${grandRemaining} units</div>
<script>window.onload=()=>{window.print()}</script></body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
