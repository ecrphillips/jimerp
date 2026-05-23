/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as orderSubmittedNotification } from './order-submitted.tsx'
import { template as orderConfirmedNotification } from './order-confirmed.tsx'
import { template as orderShippedNotification } from './order-shipped.tsx'
import { template as orderCancelledNotification } from './order-cancelled.tsx'
import { template as orderChangesRequestedNotification } from './order-changes-requested.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  order_submitted_notification: orderSubmittedNotification,
  order_confirmed_notification: orderConfirmedNotification,
  order_shipped_notification: orderShippedNotification,
  order_cancelled_notification: orderCancelledNotification,
  order_changes_requested_notification: orderChangesRequestedNotification,
}
