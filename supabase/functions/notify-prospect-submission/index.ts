import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SITE_URL = Deno.env.get('SITE_URL') || 'https://homeislandcoffeepartners.lovable.app'
const SITE_NAME = 'Home Island Coffee Partners'
const FROM_ADDRESS = `${SITE_NAME} <noreply@notify.homeislandcoffee.com>`
const SENDER_DOMAIN = 'notify.homeislandcoffee.com'
const NOTIFY_RECIPIENTS = ['ted@homeislandcoffee.com', 'aaron@homeislandcoffee.com']

const TIER_LABELS: Record<string, string> = {
  MEMBER: 'Member',
  GROWTH: 'Growth',
  PRODUCTION: 'Production',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function buildEmailHtml(sub: Record<string, any>, businessName: string, prospectUrl: string): string {
  const tier = TIER_LABELS[sub.selected_tier] ?? sub.selected_tier ?? '—'
  const rows = [
    ['Company', sub.company_name || businessName],
    ['Contact', sub.contact_name || '—'],
    ['Email', sub.contact_email || '—'],
    ['Phone', sub.contact_phone || '—'],
    ['Tier interest', tier],
    ['Monthly volume', sub.estimated_monthly_kg ? `${sub.estimated_monthly_kg} kg/month` : '—'],
    ['Address', [sub.billing_address_line1, sub.billing_address_line2, sub.billing_city, sub.billing_province, sub.billing_postal_code].filter(Boolean).join(', ') || '—'],
    ['Notes', sub.notes || '—'],
    ['Submitted', new Date(sub.submitted_at).toLocaleString('en-CA', { timeZone: 'America/Vancouver' })],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;font-weight:600;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#0B3E5E;margin:0 0 16px">New Expression of Interest</h2>
  <p><strong>${sub.company_name || businessName}</strong> has expressed interest in the <strong>${tier}</strong> tier.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">${rows}</table>
  <p><a href="${prospectUrl}" style="color:#0B3E5E">View prospect in JIM →</a></p>
</body>
</html>`
}

function buildEmailText(sub: Record<string, any>, businessName: string, prospectUrl: string): string {
  const tier = TIER_LABELS[sub.selected_tier] ?? sub.selected_tier ?? '—'
  return `New Expression of Interest

${sub.company_name || businessName} has expressed interest in the ${tier} tier.

Contact: ${sub.contact_name || '—'}
Email: ${sub.contact_email || '—'}
Phone: ${sub.contact_phone || '—'}
Monthly volume: ${sub.estimated_monthly_kg ? `${sub.estimated_monthly_kg} kg/month` : '—'}
Address: ${[sub.billing_address_line1, sub.billing_address_line2, sub.billing_city, sub.billing_province, sub.billing_postal_code].filter(Boolean).join(', ') || '—'}
Notes: ${sub.notes || '—'}
Submitted: ${new Date(sub.submitted_at).toLocaleString('en-CA', { timeZone: 'America/Vancouver' })}

View prospect: ${prospectUrl}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { submission_id } = await req.json()
    if (!submission_id) return json({ ok: false, error: 'submission_id required' }, 422)

    const { data: sub, error: subErr } = await adminClient
      .from('coroast_prospect_submissions')
      .select('*, prospects(business_name)')
      .eq('id', submission_id)
      .single()
    if (subErr || !sub) return json({ ok: false, error: 'Submission not found' }, 404)

    const businessName = (sub as any).prospects?.business_name ?? 'Unknown'
    const prospectUrl = `${SITE_URL}/prospects/${sub.prospect_id}`
    const subject = `${sub.company_name || businessName} expressed interest in the ${TIER_LABELS[sub.selected_tier] ?? sub.selected_tier} tier`
    const html = buildEmailHtml(sub, businessName, prospectUrl)
    const text = buildEmailText(sub, businessName, prospectUrl)
    const now = new Date().toISOString()

    for (const recipient of NOTIFY_RECIPIENTS) {
      const messageId = crypto.randomUUID()
      await adminClient.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'prospect_submission_notify',
        recipient_email: recipient,
        status: 'pending',
      })
      await adminClient.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          message_id: messageId,
          to: recipient,
          from: FROM_ADDRESS,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: 'prospect_submission_notify',
          queued_at: now,
        },
      })
    }

    console.log('[notify-prospect-submission] Notified team for submission', submission_id)
    return json({ ok: true })
  } catch (err) {
    console.error('[notify-prospect-submission] Unexpected:', err)
    return json({ ok: false, error: String(err) }, 500)
  }
})
