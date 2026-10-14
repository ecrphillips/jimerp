# Sales tax on shipping, extra lines and non-coffee products

Goal: show GST/HST in the app so totals match what QBO will invoice. Coffee stays tax-free.

## What staff will see

**Shipping cost (Invoicing tab drawer + order page)**
- Next to the shipping amount, a **Tax** dropdown: No tax, 5% GST, 13% HST, 14% HST, 15% HST.
- Above it, a visible suggestion chip, e.g. "Shipping to BC — suggested 5% GST [Apply]". The dropdown starts on the suggestion; staff can change it, and their choice is saved.
- An **i** button opens the guidance:
  - BC, AB, MB, SK, QC, NT, NU, YT: 5% GST
  - ON: 13% HST
  - NS: 14% HST
  - NB, NL, PE: 15% HST
  - International: charge customs and duties as a separate line item
- If the address is outside Canada, the suggestion becomes "No tax — add customs/duties as a separate line".
- If no province can be found, the chip says "No address on file — defaulting to 5% GST".

**Extra lines (Add line)**
- Same Tax dropdown and i button, defaulting to No tax (rarely used).

**Products (non-coffee only)**
- On the product form, a "Tax" setting: No tax (default) or one of the four rates, or "Based on ship-to province" (uses the same suggestion as shipping). Coffee products stay No tax.

**Order page Line Items + Invoicing drawer**
- Each taxed line shows its tax label. Below the lines: Subtotal, a row per tax rate (e.g. "GST 5% $0.62"), then Total.

## Where the province comes from (in order)
1. The order's shipment ship-to region/country, if filled in.
2. The order's location address.
3. The account's billing address.
Province is read from the address text (two-letter code or full name). This is only a suggestion; nothing is changed automatically after staff pick a rate.

## Technical details
- Migration (additive):
  - `orders.shipping_tax_code text null` with CHECK in ('NONE','GST5','HST13','HST14','HST15'); covered by existing ADMIN/OPS shipping trigger.
  - `order_extra_lines.tax_code text not null default 'NONE'` with same CHECK.
  - `products.tax_code text not null default 'NONE'` with CHECK incl. 'BY_PROVINCE'.
  - `order_line_items.tax_code text null` snapshot at order creation so later product changes don't alter past orders.
- `src/lib/salesTax.ts`: TAX_CODES (label + rate), `provinceFromAddress()`, `suggestTaxCode(province, country)`, `computeTaxBreakdown(lines)` rounding to 2 decimals per rate. Unit tests for each province mapping and the totals math.
- Shared `TaxRateSelect` component (dropdown + i popover + suggestion chip) used by InvoicingTab, OrderDetail and AddExtraLineForm.
- Product form(s) via the shared product save step get the tax field; line-item creation copies `tax_code`.
- Totals on OrderDetail and InvoicingTab use `computeTaxBreakdown`.
- No QBO sync changes in this step.
