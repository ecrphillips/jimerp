// Shared notification fan-out helper for edge functions.
// Routes a given event to:
//   1. per-user EMAIL preferences (user_notification_preferences + enabled=true)
//   2. shared mailbox (app_settings.notification_routes.<EVENT>, when enabled)
//
// All transactional email enqueues MUST include an `unsubscribe_token` — the
// Lovable email API rejects payloads without one ("missing_unsubscribe" 400).
// This helper resolves a per-recipient token from public.email_unsubscribe_tokens
// (creating one on first send) and appends a "click here to unsubscribe" line
// to the text and html bodies.
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
  label: string;
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

// ---------------------------------------------------------------------------
// Unsubscribe token helpers
// ---------------------------------------------------------------------------

/**
 * Look up an unsubscribe token for the recipient email; create one if missing.
 * Email is the unique key in email_unsubscribe_tokens, so this is idempotent.
 */
export async function ensureUnsubscribeToken(
  adminClient: any,
  email: string,
): Promise<string> {
  const normalized = email.toLowerCase().trim();

  const { data: existing, error: selectErr } = await adminClient
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalized)
    .maybeSingle();

  if (selectErr) {
    console.error('[notifications] token lookup failed:', selectErr.message);
  }
  if (existing?.token) return existing.token;

  const newToken = crypto.randomUUID();
  const { error: insertErr } = await adminClient
    .from('email_unsubscribe_tokens')
    .insert({ token: newToken, email: normalized });

  if (insertErr) {
    // Likely a race: another concurrent enqueue inserted the row. Re-select.
    const { data: raced } = await adminClient
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalized)
      .maybeSingle();
    if (raced?.token) return raced.token;
    throw new Error(`Failed to create unsubscribe token: ${insertErr.message}`);
  }
  return newToken;
}

export function buildUnsubscribeUrl(token: string): string {
  const base =
    Deno.env.get('APP_PUBLIC_URL') ||
    Deno.env.get('SUPABASE_URL') ||
    'https://homeislandcoffeepartners.lovable.app';
  // If APP_PUBLIC_URL points at the app rather than Supabase, route through
  // the supabase functions URL directly to avoid needing a frontend handler.
  if (base.includes('supabase.co') || base.includes('supabase.in')) {
    return `${base.replace(/\/$/, '')}/functions/v1/unsubscribe?token=${encodeURIComponent(token)}`;
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/unsubscribe?token=${encodeURIComponent(token)}`;
  }
  return `${base.replace(/\/$/, '')}/functions/v1/unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline-able footer lines to append at the end of a transactional email body. */
export function unsubscribeFooter(token: string): { text: string; html: string } {
  const url = buildUnsubscribeUrl(token);
  return {
    text: `\n\nTo unsubscribe from these notifications, click here: ${url}`,
    html: `<p style="margin:24px 0 0 0;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:12px;">To unsubscribe from these notifications, <a href="${escapeHtml(url)}" style="color:#999;">click here</a>.</p>`,
  };
}

/** Append the unsubscribe footer to an existing EmailContent. */
export function withUnsubscribe(content: EmailContent, token: string): EmailContent {
  const footer = unsubscribeFooter(token);
  return {
    subject: content.subject,
    text: `${content.text}${footer.text}`,
    html: content.html ? content.html.replace(/<\/body>/i, `${footer.html}</body>`) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Enqueue + fan-out
// ---------------------------------------------------------------------------

async function enqueueOne(
  adminClient: any,
  recipient: string,
  label: string,
  content: EmailContent,
): Promise<{ ok: boolean; error?: string }> {
  let unsubscribeToken: string;
  try {
    unsubscribeToken = await ensureUnsubscribeToken(adminClient, recipient);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `unsubscribe token: ${msg}` };
  }

  const final = withUnsubscribe(content, unsubscribeToken);
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
      subject: final.subject,
      text: final.text,
      html: final.html,
      purpose: 'transactional',
      label,
      unsubscribe_token: unsubscribeToken,
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

  // ---- suppression filter ----
  let active = [...recipients];
  if (active.length > 0) {
    const { data: suppressed, error: suppErr } = await adminClient
      .from('suppressed_emails')
      .select('email')
      .in('email', active);
    if (suppErr) {
      result.errors.push(`suppression check failed: ${suppErr.message}`);
    } else if (suppressed && suppressed.length > 0) {
      const blocked = new Set(suppressed.map((s: any) => String(s.email).toLowerCase()));
      active = active.filter((r) => !blocked.has(r));
    }
  }

  // ---- enqueue ----
  for (const recipient of active) {
    const content = opts.buildEmail(recipient);
    const { ok, error } = await enqueueOne(adminClient, recipient, opts.label, content);
    if (ok) result.enqueued += 1;
    else if (error) result.errors.push(`${recipient}: ${error}`);
  }

  return result;
}
