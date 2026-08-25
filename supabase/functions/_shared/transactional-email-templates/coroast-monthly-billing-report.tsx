/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Text, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

export interface CoRoastBillingRow {
  accountName: string
  tier: string
  includedHours: number
  usedHours: number
  overageHours: number
  overageRate: number
  baseFee: number
  overageCharge: number
  storageCharge: number
  extrasSubtotal: number
  gst: number
  grandTotal: number
  prorationNote?: string | null
  invoiceRecorded?: boolean
}

export interface CoRoastBillingReportProps {
  monthLabel?: string
  rows?: CoRoastBillingRow[]
  totals?: {
    baseFees: number
    overageCharges: number
    storageCharges: number
    extras: number
    gst: number
    grandTotal: number
  }
  generatedAt?: string
}

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hrs = (n: number) => `${(Number(n) || 0).toFixed(2)} h`

const Email = ({
  monthLabel = 'this month',
  rows = [],
  totals,
  generatedAt,
}: CoRoastBillingReportProps) => {
  const overageRows = rows.filter((r) => r.overageHours > 0)
  const t = totals ?? {
    baseFees: 0, overageCharges: 0, storageCharges: 0, extras: 0, gst: 0, grandTotal: 0,
  }

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Co-roasting billing summary — ${monthLabel}: ${money(t.grandTotal)} across ${rows.length} member(s), ${overageRows.length} with overage`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Co-roasting billing summary</Heading>
          <Text style={sub}>{monthLabel}</Text>

          <Section style={callout}>
            <Text style={calloutRow}>
              <strong>Month total (incl. tax):</strong> {money(t.grandTotal)}
            </Text>
            <Text style={calloutRow}>
              <strong>Members billed:</strong> {rows.length}
            </Text>
            <Text style={calloutRow}>
              <strong>Accounts with overage:</strong> {overageRows.length}
            </Text>
          </Section>

          <Heading as="h2" style={h2}>Accounts needing an invoice edit (overage)</Heading>
          {overageRows.length === 0 ? (
            <Text style={text}>
              No overage this month — recurring QuickBooks invoices can go out unchanged.
            </Text>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Account</th>
                  <th style={th}>Hours</th>
                  <th style={thRight}>Overage</th>
                  <th style={thRight}>Overage $</th>
                  <th style={thRight}>Total</th>
                </tr>
              </thead>
              <tbody>
                {overageRows.map((r) => (
                  <tr key={`ov-${r.accountName}`} style={rowFlag}>
                    <td style={td}>
                      {r.accountName}
                      <span style={tierChip}>{r.tier}</span>
                    </td>
                    <td style={td}>{hrs(r.usedHours)} / {hrs(r.includedHours)}</td>
                    <td style={tdRight}>{hrs(r.overageHours)} @ {money(r.overageRate)}</td>
                    <td style={tdRight}>{money(r.overageCharge)}</td>
                    <td style={tdRight}>{money(r.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Heading as="h2" style={h2}>All members</Heading>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Account</th>
                <th style={th}>Hours used / incl.</th>
                <th style={thRight}>Base</th>
                <th style={thRight}>Overage</th>
                <th style={thRight}>Storage</th>
                <th style={thRight}>Extras</th>
                <th style={thRight}>GST</th>
                <th style={thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountName} style={r.overageHours > 0 ? rowFlag : undefined}>
                  <td style={td}>
                    {r.accountName}
                    <span style={tierChip}>{r.tier}</span>
                    {r.prorationNote ? <div style={noteLine}>{r.prorationNote}</div> : null}
                    {r.invoiceRecorded ? <div style={noteLine}>Invoice already recorded</div> : null}
                  </td>
                  <td style={td}>{hrs(r.usedHours)} / {hrs(r.includedHours)}</td>
                  <td style={tdRight}>{money(r.baseFee)}</td>
                  <td style={tdRight}>{money(r.overageCharge)}</td>
                  <td style={tdRight}>{money(r.storageCharge)}</td>
                  <td style={tdRight}>{money(r.extrasSubtotal)}</td>
                  <td style={tdRight}>{money(r.gst)}</td>
                  <td style={tdRight}>{money(r.grandTotal)}</td>
                </tr>
              ))}
              <tr>
                <td style={tdTotal}>Month total</td>
                <td style={tdTotal}></td>
                <td style={tdTotalRight}>{money(t.baseFees)}</td>
                <td style={tdTotalRight}>{money(t.overageCharges)}</td>
                <td style={tdTotalRight}>{money(t.storageCharges)}</td>
                <td style={tdTotalRight}>{money(t.extras)}</td>
                <td style={tdTotalRight}>{money(t.gst)}</td>
                <td style={tdTotalRight}>{money(t.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <Hr style={hr} />
          <Text style={footer}>
            {generatedAt ? `Generated ${generatedAt}. ` : ''}
            Home Island Coffee Partners — homeislandcoffee.com
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `Co-roasting billing summary — ${data?.monthLabel ?? 'monthly report'}`,
  displayName: 'Co-roasting monthly billing summary',
  previewData: {
    monthLabel: 'August 2026',
    generatedAt: 'Aug 31, 2026',
    rows: [
      {
        accountName: 'Example Roasters', tier: 'MEMBER', includedHours: 8, usedHours: 10.5,
        overageHours: 2.5, overageRate: 125, baseFee: 750, overageCharge: 312.5,
        storageCharge: 0, extrasSubtotal: 0, gst: 53.13, grandTotal: 1115.63,
      },
      {
        accountName: 'Second Member Co.', tier: 'GROWTH', includedHours: 16, usedHours: 12,
        overageHours: 0, overageRate: 125, baseFee: 1200, overageCharge: 0,
        storageCharge: 100, extrasSubtotal: 0, gst: 65, grandTotal: 1365,
      },
    ],
    totals: {
      baseFees: 1950, overageCharges: 312.5, storageCharges: 100, extras: 0,
      gst: 118.13, grandTotal: 2480.63,
    },
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px', maxWidth: '680px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: 'bold' as const, color: '#0B3E5E', margin: '0 0 4px' }
const h2 = { fontSize: '15px', fontWeight: 'bold' as const, color: '#0B3E5E', margin: '28px 0 8px' }
const sub = { fontSize: '14px', color: '#666666', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#222222', lineHeight: '1.6', margin: '0 0 12px' }
const callout = { margin: '0 0 12px', padding: '12px 16px', backgroundColor: '#f5f7fa', borderRadius: '4px' }
const calloutRow = { fontSize: '14px', color: '#222222', lineHeight: '1.6', margin: '4px 0' }
const table = { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px', color: '#222222' }
const th = { textAlign: 'left' as const, padding: '6px 8px', borderBottom: '2px solid #d9dee5', color: '#0B3E5E' }
const thRight = { ...th, textAlign: 'right' as const }
const td = { padding: '6px 8px', borderBottom: '1px solid #eeeeee', verticalAlign: 'top' as const }
const tdRight = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
const rowFlag = { backgroundColor: '#fdf6e3' }
const tierChip = { marginLeft: '6px', fontSize: '10px', color: '#666666' }
const noteLine = { fontSize: '10px', color: '#888888', marginTop: '2px' }
const tdTotal = { padding: '8px', borderTop: '2px solid #d9dee5', fontWeight: 'bold' as const }
const tdTotalRight = { ...tdTotal, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
const hr = { borderColor: '#e6e6e6', margin: '32px 0 16px' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
