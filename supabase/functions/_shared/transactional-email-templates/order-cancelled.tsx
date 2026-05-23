import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { OrderEmailShell, type OrderEmailProps } from './_shell.tsx'

const OrderCancelledEmail = (props: OrderEmailProps) => (
  <OrderEmailShell
    {...props}
    previewText={`Order ${props.orderNumber ?? ''} cancelled`}
    title={`Order ${props.orderNumber ?? ''} cancelled`}
    headline={props.headline ?? `Your order${props.accountName ? ` for ${props.accountName}` : ''} has been cancelled.`}
  />
)

export const template = {
  component: OrderCancelledEmail,
  subject: (data: Record<string, any>) =>
    `Order ${data?.orderNumber ?? ''} cancelled — ${data?.accountName ?? 'Home Island'}`.trim(),
  displayName: 'Order cancelled notification',
  previewData: {
    orderNumber: 'HIC-1042',
    accountName: 'Sample Cafe',
    requestedShipDate: 'January 15, 2026',
  },
} satisfies TemplateEntry
