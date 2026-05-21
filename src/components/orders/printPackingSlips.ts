import { supabase } from '@/integrations/supabase/client';

interface ShipmentRow {
  id: string;
  shipment_number: number;
  delivery_method: string;
  location_id: string | null;
  ship_to_name: string | null;
  ship_to_address_line1: string | null;
  ship_to_address_line2: string | null;
  ship_to_city: string | null;
  ship_to_region: string | null;
  ship_to_postal: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  location: { name: string | null; location_code: string | null } | null;
}

interface LineRow {
  id: string;
  quantity_units: number;
  grind: string | null;
  shipment_id: string | null;
  product: {
    product_name: string | null;
    bag_size_g: number | null;
    packaging_variant: string | null;
  } | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  requested_ship_date: string | null;
  client_po: string | null;
  client_notes: string | null;
  delivery_method: string;
  account: { account_name: string | null } | null;
  client: { name: string | null } | null;
}

const esc = (s: unknown): string => {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const shipToBlock = (s: ShipmentRow, fallbackAccount: string): string => {
  // Prefer linked client_location, then explicit ship-to fields, then account label.
  if (s.location && (s.location.name || s.location.location_code)) {
    const parts: string[] = [];
    if (s.location.location_code) parts.push(`<div class="loc-code">${esc(s.location.location_code)}</div>`);
    if (s.location.name) parts.push(`<div>${esc(s.location.name)}</div>`);
    return parts.join('');
  }
  const lines: string[] = [];
  lines.push(`<div>${esc(s.ship_to_name ?? fallbackAccount)}</div>`);
  if (s.ship_to_address_line1) lines.push(`<div>${esc(s.ship_to_address_line1)}</div>`);
  if (s.ship_to_address_line2) lines.push(`<div>${esc(s.ship_to_address_line2)}</div>`);
  const cityLine = [s.ship_to_city, s.ship_to_region, s.ship_to_postal].filter(Boolean).join(', ');
  if (cityLine) lines.push(`<div>${esc(cityLine)}</div>`);
  return lines.join('');
};

const contactBlock = (s: ShipmentRow): string => {
  const parts: string[] = [];
  if (s.contact_name) parts.push(esc(s.contact_name));
  if (s.contact_phone) parts.push(esc(s.contact_phone));
  if (s.contact_email) parts.push(esc(s.contact_email));
  return parts.length ? `<div class="contact">${parts.join(' • ')}</div>` : '';
};

const slipHtml = (
  order: OrderRow,
  shipment: ShipmentRow,
  lines: LineRow[],
  totalShipments: number,
): string => {
  const accountLabel = order.account?.account_name ?? order.client?.name ?? '';
  const shipDate = order.requested_ship_date ?? '';
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity_units, 0);

  const rows = lines.length
    ? lines
        .map(
          (l) => `
        <tr>
          <td>${esc(l.product?.product_name ?? 'Unknown')}</td>
          <td class="num">${esc(l.product?.bag_size_g ?? '')}g</td>
          <td>${esc(l.product?.packaging_variant ?? '')}</td>
          <td class="num">${esc(l.quantity_units)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="muted">No line items assigned to this shipment.</td></tr>`;

  return `
  <section class="slip">
    <header class="slip-header">
      <div class="left">
        <div class="brand">Home Island Coffee Partners</div>
        <div class="muted">Packing Slip</div>
      </div>
      <div class="right">
        <div><strong>Order ${esc(order.order_number)}</strong></div>
        <div>Shipment ${esc(shipment.shipment_number)} of ${esc(totalShipments)}</div>
        ${shipDate ? `<div>Requested ship: ${esc(shipDate)}</div>` : ''}
        ${order.client_po ? `<div>PO: ${esc(order.client_po)}</div>` : ''}
      </div>
    </header>

    <div class="addresses">
      <div class="addr">
        <div class="muted">Bill to</div>
        <div>${esc(accountLabel)}</div>
      </div>
      <div class="addr">
        <div class="muted">Ship to (${esc(shipment.delivery_method)})</div>
        ${shipToBlock(shipment, accountLabel)}
        ${contactBlock(shipment)}
      </div>
    </div>

    <table class="lines">
      <thead>
        <tr>
          <th>Product</th>
          <th class="num">Size</th>
          <th>Packaging</th>
          <th class="num">Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="num"><strong>Total units</strong></td>
          <td class="num"><strong>${esc(totalUnits)}</strong></td>
        </tr>
      </tfoot>
    </table>

    ${
      shipment.notes
        ? `<div class="notes"><strong>Shipment notes:</strong> ${esc(shipment.notes)}</div>`
        : ''
    }
    ${
      order.client_notes
        ? `<div class="notes muted"><strong>Order notes:</strong> ${esc(order.client_notes)}</div>`
        : ''
    }

    <footer class="slip-footer muted">Printed ${esc(new Date().toLocaleString())}</footer>
  </section>`;
};

const wrap = (body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Packing Slips</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; color: #111; }
  .slip { padding: 24px; page-break-after: always; min-height: 100vh; }
  .slip:last-of-type { page-break-after: auto; }
  .slip-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .slip-header .brand { font-size: 18px; font-weight: 700; }
  .slip-header .right { text-align: right; font-size: 13px; }
  .muted { color: #666; }
  .addresses { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; font-size: 13px; }
  .addr .muted { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .loc-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
  .contact { margin-top: 4px; font-size: 12px; color: #666; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.lines th, table.lines td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; }
  table.lines th { background: #f4f4f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  table.lines td.num, table.lines th.num { text-align: right; }
  table.lines tfoot td { border-top: 2px solid #111; border-bottom: none; padding-top: 10px; }
  .notes { margin-top: 16px; font-size: 12px; padding: 8px 10px; background: #fafafa; border-left: 3px solid #ccc; }
  .slip-footer { margin-top: 24px; font-size: 11px; text-align: right; }
  @media print { .slip { padding: 16mm; } }
</style>
</head><body>${body}</body></html>`;

export async function printPackingSlips(orderId: string): Promise<void> {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, requested_ship_date, client_po, client_notes, delivery_method, account:accounts(account_name), client:clients(name)',
    )
    .eq('id', orderId)
    .single();
  if (orderErr || !order) throw orderErr ?? new Error('Order not found');

  const { data: shipments, error: shipErr } = await supabase
    .from('order_shipments')
    .select(
      'id, shipment_number, delivery_method, location_id, ship_to_name, ship_to_address_line1, ship_to_address_line2, ship_to_city, ship_to_region, ship_to_postal, contact_name, contact_phone, contact_email, notes, location:account_locations(name:location_name, location_code)',
    )
    .eq('order_id', orderId)
    .order('shipment_number');
  if (shipErr) throw shipErr;

  const { data: lines, error: lineErr } = await supabase
    .from('order_line_items')
    .select(
      'id, quantity_units, grind, shipment_id, product:products(product_name, bag_size_g, packaging_variant)',
    )
    .eq('order_id', orderId);
  if (lineErr) throw lineErr;

  const shipmentRows = (shipments ?? []) as unknown as ShipmentRow[];
  const lineRows = (lines ?? []) as unknown as LineRow[];

  // Fallback: if no shipments exist, render a single slip covering all lines.
  const renderSet: ShipmentRow[] = shipmentRows.length
    ? shipmentRows
    : [
        {
          id: 'fallback',
          shipment_number: 1,
          delivery_method: order.delivery_method,
          location_id: null,
          ship_to_name: null,
          ship_to_address_line1: null,
          ship_to_address_line2: null,
          ship_to_city: null,
          ship_to_region: null,
          ship_to_postal: null,
          contact_name: null,
          contact_phone: null,
          contact_email: null,
          notes: null,
          location: null,
        },
      ];

  const body = renderSet
    .map((s) => {
      const linesForShipment = shipmentRows.length
        ? lineRows.filter((l) => l.shipment_id === s.id)
        : lineRows;
      return slipHtml(order as unknown as OrderRow, s, linesForShipment, renderSet.length);
    })
    .join('');

  const html = wrap(body);
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Popup blocked — allow popups to print packing slips.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new doc a tick to render, then open print dialog.
  win.setTimeout(() => win.print(), 200);
}
