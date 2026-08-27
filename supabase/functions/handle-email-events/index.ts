import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type Reason = 'bounce' | 'complaint' | 'unsubscribe'
type LogStatus = 'bounced' | 'complained' | 'suppressed'

async function record(
  recipient: string,
  reason: Reason,
  logStatus: LogStatus,
  message: string,
  eventId: string,
) {
  const email = recipient.toLowerCase()

  const { error: suppressError } = await admin
    .from('suppressed_emails')
    .upsert({ email, reason, metadata: null }, { onConflict: 'email' })
  if (suppressError) {
    console.error('suppressed_emails upsert failed', {
      event_id: eventId,
      code: suppressError.code,
      message: suppressError.message,
    })
    throw new Error('suppression write failed')
  }

  const { error: logError } = await admin.from('email_send_log').insert({
    message_id: null,
    template_name: 'system',
    recipient_email: email,
    status: logStatus,
    error_message: message,
  })
  if (logError) {
    console.error('email_send_log insert failed', {
      event_id: eventId,
      code: logError.code,
      message: logError.message,
    })
    throw new Error('log write failed')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await record(
        event.data.recipient,
        'bounce',
        'bounced',
        'Recipient address bounced — suppressed from future sends',
        event.event_id,
      )
    },
    'email.complaint': async (event) => {
      await record(
        event.data.recipient,
        'complaint',
        'complained',
        'Recipient marked the email as spam — suppressed from future sends',
        event.event_id,
      )
    },
    'email.unsubscribed': async (event) => {
      await record(
        event.data.recipient,
        'unsubscribe',
        'suppressed',
        'Recipient unsubscribed — suppressed from future sends',
        event.event_id,
      )
    },
  },
})

Deno.serve((req) => handler(req))
