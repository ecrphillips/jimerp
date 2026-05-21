// Shared notification fan-out helper for edge functions.
// Routes a given event to:
//   1. per-user EMAIL preferences (user_notification_preferences + enabled=true)
//   2. shared mailbox (app_settings.notification_routes.<EVENT>, when enabled)
//
// In-app delivery is intentionally NOT handled here — callers continue to
// insert their domain-specific notification rows (order_notifications,
// booking notifications, etc.) which drive realtime UI toasts.
//
// deno-lint-ignore-file no-explicit-any

export type NotificationEventType =
  | 'ORDER_SUBMITTED'
  | 'ORDER_CONFIRMED'
  | 'BOOKING_CREATED'
  | 'BOOKING_CANCELLED';

const FROM_DISPLAY = 'Home Island Manufacturing <noreply@homeislandcoffee.com>';
const FROM_DOMAIN = 'homeislandcoffee.com';

export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

export interface FanOutOptions {
  eventType: NotificationEventType;
  label: string; // template label for email_send_log
  buildEmail: (recipient: string) => EmailContent;
  /** When true, also enqueue email to ADMIN/OPS users whose EMAIL pref is on. */
  includePerUserEmails?: boolean;
  /** When true, also enqueue email to the shared mailbox configured for the event. */
  includeSharedMailbox?: boolean;
}

interface FanOutResult {
  per_user_recipients: string[];
  shared_recipients: string[];
  enqueued: number;
  errors: string[];
}

async function enqueueOne(
  adminClient: any,
  recipient: string,
  label: string,
  content: EmailContent,
): Promise<{ ok: boolean; error?: string }> {
  const messageId = crypto.randomUUID();

  const { data: logRow } = await adminClient
    .from('email_send_log')
    .insert({
      message_id: messageId,
      template_name: label,
      recipient_email: recipient,
      status: 'pending',
    })
    .select('id')
    .single();

  const { error } = await adminClient.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      idempotency_key: messageId,
      to: recipient,
      from: FROM_DISPLAY,
      sender_domain: FROM_DOMAIN,
      subject: content.subject,
      text: content.text,
      html: content.html,
      purpose: 'transactional',
      label,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) {
    if (logRow?.id) {
      await adminClient
        .from('email_send_log')
        .update({ status: 'failed', error_message: `Failed to enqueue: ${error.message}` })
        .eq('id', logRow.id);
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

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
      // Resolve emails via auth.users (service-role only has access via RPC or admin API).
      // Profiles table also stores email for app users; prefer it for simplicity.
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

  // ---- enqueue ----
  for (const recipient of recipients) {
    const content = opts.buildEmail(recipient);
    const { ok, error } = await enqueueOne(adminClient, recipient, opts.label, content);
    if (ok) result.enqueued += 1;
    else if (error) result.errors.push(`${recipient}: ${error}`);
  }

  return result;
}
