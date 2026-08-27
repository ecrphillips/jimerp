// Shared notification fan-out helper for edge functions.
// Routes a given event to:
//   1. per-user EMAIL preferences (user_notification_preferences + enabled=true)
//   2. shared mailbox (app_settings.notification_routes.<EVENT>, when enabled)
//
// Emails are sent synchronously through Lovable's managed email API. Delivery,
// retries, rate limits, suppression and the unsubscribe footer/page are handled
// by Lovable — this module only builds content and records outcomes in
// public.email_send_log.
//
// In-app delivery is intentionally NOT handled here — callers continue to
// insert their domain-specific notification rows (order_notifications,
// booking notifications, etc.) which drive realtime UI toasts.
//
// deno-lint-ignore-file no-explicit-any

import { EmailAPIError, sendLovableEmail } from 'npm:@lovable.dev/email-js@0.1.0';

export type NotificationEventType =
  | 'ORDER_SUBMITTED'
  | 'ORDER_CONFIRMED'
  | 'BOOKING_CREATED'
  | 'BOOKING_CANCELLED';

const FROM_DISPLAY = 'Home Island Coffee Partners <noreply@notify.homeislandcoffee.com>';
// SENDER_DOMAIN is the verified delegated sender subdomain — never the root domain.
export const SENDER_DOMAIN = 'notify.homeislandcoffee.com';

export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

export interface FanOutOptions {
  eventType: NotificationEventType;
  label: string;
  buildEmail: (recipient: string) => EmailContent;
  /** When true, also email ADMIN/OPS users whose EMAIL pref is on. */
  includePerUserEmails?: boolean;
  /** When true, also email the shared mailbox configured for the event. */
  includeSharedMailbox?: boolean;
}

interface FanOutResult {
  per_user_recipients: string[];
  shared_recipients: string[];
  enqueued: number;
  errors: string[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Order line item rendering (shared across order email functions)
// ---------------------------------------------------------------------------

export interface OrderLineItemRow {
  product_name: string;
  bag_size_g: number | null;
  quantity_units: number;
}

export function formatBagSize(grams: number | null | undefined): string {
  if (grams == null) return '—';
  return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
}

export function renderOrderItemsText(items: OrderLineItemRow[]): string {
  if (items.length === 0) return '  (no line items)';
  const header = ['Item', 'Bag Size', 'Quantity'];
  const rows = items.map((li) => [
    li.product_name,
    formatBagSize(li.bag_size_g),
    String(li.quantity_units),
  ]);
  const all = [header, ...rows];
  const widths = [0, 1, 2].map((c) => Math.max(...all.map((r) => r[c].length)));
  return all.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n');
}

export function renderOrderItemsHtml(items: OrderLineItemRow[]): string {
  if (items.length === 0) {
    return `<tr><td colspan="3" style="padding:6px 0;color:#666;">(no line items)</td></tr>`;
  }
  const headerRow =
    `<tr>` +
    `<th align="left" style="padding:4px 12px 4px 0;border-bottom:1px solid #ddd;font-size:13px;">Item</th>` +
    `<th align="left" style="padding:4px 12px 4px 0;border-bottom:1px solid #ddd;font-size:13px;">Bag Size</th>` +
    `<th align="right" style="padding:4px 0;border-bottom:1px solid #ddd;font-size:13px;">Quantity</th>` +
    `</tr>`;
  const bodyRows = items
    .map(
      (li) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;">${escapeHtml(li.product_name)}</td>` +
        `<td style="padding:4px 12px 4px 0;">${escapeHtml(formatBagSize(li.bag_size_g))}</td>` +
        `<td style="padding:4px 0;text-align:right;">${li.quantity_units}</td>` +
        `</tr>`,
    )
    .join('');
  return headerRow + bodyRows;
}

// ---------------------------------------------------------------------------
// Managed send
// ---------------------------------------------------------------------------

export interface SendNotificationEmailResult {
  ok: boolean;
  message_id: string;
  suppressed?: boolean;
  error?: string;
}

/** Append a send-outcome row to public.email_send_log (never blocks the send result). */
async function logSend(
  adminClient: any,
  row: {
    message_id: string | null;
    template_name: string;
    recipient_email: string;
    status: 'sent' | 'suppressed' | 'failed';
    error_message?: string;
  },
): Promise<void> {
  const { error } = await adminClient.from('email_send_log').insert(row);
  if (error) {
    console.error('[notifications] email_send_log insert failed:', error.code, error.message);
  }
}

/**
 * Send one hand-authored notification email through Lovable's managed email API.
 * Suppression is enforced server-side by Lovable; a suppressed recipient is an
 * expected outcome, not an error.
 */
export async function sendNotificationEmail(
  adminClient: any,
  recipient: string,
  label: string,
  content: EmailContent,
  idempotencyKey?: string,
): Promise<SendNotificationEmailResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  const messageId = idempotencyKey ?? crypto.randomUUID();

  if (!apiKey) {
    const error = 'LOVABLE_API_KEY is not configured';
    console.error('[notifications]', error);
    await logSend(adminClient, {
      message_id: null,
      template_name: label,
      recipient_email: recipient,
      status: 'failed',
      error_message: error,
    });
    return { ok: false, message_id: messageId, error };
  }

  try {
    await sendLovableEmail(
      {
        to: recipient,
        from: FROM_DISPLAY,
        sender_domain: SENDER_DOMAIN,
        subject: content.subject,
        html: content.html ?? undefined,
        text: content.text,
        purpose: 'transactional',
        label,
        idempotency_key: messageId,
      },
      { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') },
    );
  } catch (err) {
    if (err instanceof EmailAPIError && err.code === 'recipient_suppressed') {
      await logSend(adminClient, {
        message_id: null,
        template_name: label,
        recipient_email: recipient,
        status: 'suppressed',
      });
      return { ok: false, message_id: messageId, suppressed: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notifications] send failed:', label, msg);
    await logSend(adminClient, {
      message_id: null,
      template_name: label,
      recipient_email: recipient,
      status: 'failed',
      error_message: msg.slice(0, 1000),
    });
    return { ok: false, message_id: messageId, error: msg };
  }

  await logSend(adminClient, {
    message_id: null,
    template_name: label,
    recipient_email: recipient,
    status: 'sent',
  });
  return { ok: true, message_id: messageId };
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

export async function fanOutNotification(
  adminClient: any,
  opts: FanOutOptions,
): Promise<FanOutResult> {
  const result: FanOutResult = {
    per_user_recipients: [],
    shared_recipients: [],
    enqueued: 0,
    errors: [],
  };

  const recipients = new Set<string>();

  // ---- per-user EMAIL preferences ----
  if (opts.includePerUserEmails !== false) {
    const { data: prefs, error: prefsError } = await adminClient
      .from('user_notification_preferences')
      .select('user_id')
      .eq('event_type', opts.eventType)
      .eq('channel', 'EMAIL')
      .eq('enabled', true);

    if (prefsError) {
      result.errors.push(`prefs query failed: ${prefsError.message}`);
    } else if (prefs && prefs.length > 0) {
      const userIds = prefs.map((p: any) => p.user_id);
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('user_id, email')
        .in('user_id', userIds);

      for (const p of profiles ?? []) {
        if (p?.email) {
          result.per_user_recipients.push(p.email);
          recipients.add(p.email.toLowerCase());
        }
      }
    }
  }

  // ---- shared mailbox ----
  if (opts.includeSharedMailbox !== false) {
    const key = `notification_routes.${opts.eventType}`;
    const { data: setting, error: settingError } = await adminClient
      .from('app_settings')
      .select('value_json')
      .eq('key', key)
      .maybeSingle();

    if (settingError) {
      result.errors.push(`route query failed: ${settingError.message}`);
    } else if (setting?.value_json?.enabled && setting.value_json.shared_email) {
      const shared = String(setting.value_json.shared_email);
      if (!recipients.has(shared.toLowerCase())) {
        result.shared_recipients.push(shared);
        recipients.add(shared.toLowerCase());
      }
    }
  }

  // ---- send (suppression is enforced by Lovable at send time) ----
  for (const recipient of recipients) {
    const content = opts.buildEmail(recipient);
    const { ok, suppressed, error } = await sendNotificationEmail(
      adminClient,
      recipient,
      opts.label,
      content,
    );
    if (ok) result.enqueued += 1;
    else if (error) result.errors.push(`${recipient}: ${error}`);
    else if (suppressed) console.log('[notifications] recipient suppressed for', opts.label);
  }

  return result;
}
