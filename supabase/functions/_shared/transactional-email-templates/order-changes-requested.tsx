import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { OrderEmailShell, type OrderEmailProps } from './_shell.tsx'

const OrderChangesRequestedEmail = (props: OrderEmailProps) => (
  <OrderEmailShell
    {...props}
    previewText={`Changes requested on order ${props.orderNumber ?? ''}`}
    title={`Changes requested on order ${props.orderNumber ?? ''}`}
    headline={props.headline ?? `The client has requested changes to order ${props.orderNumber ?? ''}${props.accountName ? ` for ${props.accountName}` : ''}.`}
  />
)

export const template = {
  component: OrderChangesRequestedEmail,
  subject: (data: Record<string, any>) =>
    `Changes requested on order ${data?.orderNumber ?? ''} — ${data?.accountName ?? 'Home Island'}`.trim(),
  displayName: 'Order changes requested notification',
  previewData: {
    orderNumber: 'HIC-1042',
    accountName: 'Sample Cafe',
    requestedShipDate: 'January 15, 2026',
    notes: 'Please swap 2 bags of espresso for filter roast.',
  },
} satisfies TemplateEntry
