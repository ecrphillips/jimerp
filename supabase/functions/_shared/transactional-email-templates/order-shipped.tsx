import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { OrderEmailShell, type OrderEmailProps } from './_shell.tsx'

const OrderShippedEmail = (props: OrderEmailProps) => (
  <OrderEmailShell
    {...props}
    previewText={`Order ${props.orderNumber ?? ''} has shipped`}
    title={`Order ${props.orderNumber ?? ''} shipped`}
    headline={props.headline ?? `Your order${props.accountName ? ` for ${props.accountName}` : ''} has shipped.`}
  />
)

export const template = {
  component: OrderShippedEmail,
  subject: (data: Record<string, any>) =>
    `Order ${data?.orderNumber ?? ''} shipped — ${data?.accountName ?? 'Home Island'}`.trim(),
  displayName: 'Order shipped notification',
  previewData: {
    orderNumber: 'HIC-1042',
    accountName: 'Sample Cafe',
    requestedShipDate: 'January 15, 2026',
  },
} satisfies TemplateEntry
