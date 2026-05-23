import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { OrderEmailShell, type OrderEmailProps } from './_shell.tsx'

const OrderSubmittedEmail = (props: OrderEmailProps) => (
  <OrderEmailShell
    {...props}
    previewText={`New order ${props.orderNumber ?? ''} submitted`}
    title={`New order ${props.orderNumber ?? ''} submitted`}
    headline={props.headline ?? `A new order has been submitted${props.accountName ? ` for ${props.accountName}` : ''}.`}
  />
)

export const template = {
  component: OrderSubmittedEmail,
  subject: (data: Record<string, any>) =>
    `New order ${data?.orderNumber ?? ''} — ${data?.accountName ?? 'Home Island'}`.trim(),
  displayName: 'Order submitted notification',
  previewData: {
    orderNumber: 'HIC-1042',
    accountName: 'Sample Cafe',
    requestedShipDate: 'January 15, 2026',
  },
} satisfies TemplateEntry
