import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { OrderEmailShell, type OrderEmailProps } from './_shell.tsx'

const OrderConfirmedEmail = (props: OrderEmailProps) => (
  <OrderEmailShell
    {...props}
    previewText={`Order ${props.orderNumber ?? ''} confirmed`}
    title={`Order ${props.orderNumber ?? ''} confirmed`}
    headline={props.headline ?? `Your order${props.accountName ? ` for ${props.accountName}` : ''} has been confirmed by the Home Island team.`}
  />
)

export const template = {
  component: OrderConfirmedEmail,
  subject: (data: Record<string, any>) =>
    `Order ${data?.orderNumber ?? ''} confirmed — ${data?.accountName ?? 'Home Island'}`.trim(),
  displayName: 'Order confirmed notification',
  previewData: {
    orderNumber: 'HIC-1042',
    accountName: 'Sample Cafe',
    requestedShipDate: 'January 15, 2026',
  },
} satisfies TemplateEntry
