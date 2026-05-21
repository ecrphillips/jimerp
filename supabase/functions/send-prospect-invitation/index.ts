import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SITE_URL = Deno.env.get('SITE_URL') || 'https://homeislandcoffeepartners.lovable.app'
const SITE_NAME = 'Home Island Coffee Partners'
const FROM_ADDRESS = `${SITE_NAME} <noreply@notify.homeislandcoffee.com>`
const SENDER_DOMAIN = 'notify.homeislandcoffee.com'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function buildEmailHtml(firstName: string, exploreUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
  <p style="margin:0 0 8px"><img src="https://homeislandcoffee.com/icon.png" alt="" width="36" height="36"></p>
  <h2 style="color:#0B3E5E;margin:0 0 16px">Home Island Coffee Partners</h2>
  <p>Hi ${firstName},</p>
  <p>We'd love for you to explore what co-roasting with Home Island Coffee Partners looks like for your business. We've put together a private page just for you where you can look through our membership options, run some numbers, and let us know if any of it feels like a fit — no pressure, no commitment.</p>
  <p style="margin:24px 0">
    <a href="${exploreUrl}" style="background:#0B3E5E;color:#D2AC58;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600">
      Explore the programme →
    </a>
  </p>
  <p>This link is personal to you and will be active for 90 days. If you have any questions before then, just reply to this email and it'll reach us directly.</p>
  <p>Ted &amp; Aaron<br><em>Home Island Coffee Partners</em></p>
</body>
</html>`
}

function buildEmailText(firstName: string, exploreUrl: string): string {
  return `Hi ${firstName},

We'd love for you to explore what co-roasting with Home Island Coffee Partners looks like for your business. We've put together a private page just for you where you can look through our membership options, run some numbers, and let us know if any of it feels like a fit — no pressure, no commitment.

Your personal link (active for 90 days):
${exploreUrl}

If you have any questions, just reply to this email and it'll reach us directly.

Ted & Aaron
Home Island Coffee Partners`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Auth — require ADMIN or OPS
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Unauthorized' }, 401)

    const token = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !user) return json({ ok: false, error: 'Invalid token' }, 401)

    const { data: roleRow } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()
    if (!roleRow || !['ADMIN', 'OPS'].includes(roleRow.role)) {
      return json({ ok: false, error: 'Forbidden' }, 403)
    }

    const { prospect_id } = await req.json()
    if (!prospect_id) return json({ ok: false, error: 'prospect_id required' }, 422)

    // Fetch prospect
    const { data: prospect, error: pErr } = await adminClient
      .from('prospects')
      .select('id, business_name, contact_name, prospect_email, stream')
      .eq('id', prospect_id)
      .single()
    if (pErr || !prospect) return json({ ok: false, error: 'Prospect not found' }, 404)
    if (!prospect.prospect_email) {
      return json({ ok: false, error: 'no_email' }, 422)
    }
    if (!['CO_ROAST', 'BOTH'].includes(prospect.stream ?? '')) {
      return json({ ok: false, error: 'Prospect stream is not CO_ROAST or BOTH' }, 422)
    }

    // Upsert invitation — INSERT first time, UPDATE on resend
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    const { data: existing } = await adminClient
      .from('coroast_prospect_invitations')
      .select('id, token')
      .eq('prospect_id', prospect_id)
      .maybeSingle()

    let invitation: { id: string; token: string }

    if (existing) {
      const { data: updated, error: updErr } = await adminClient
        .from('coroast_prospect_invitations')
        .update({
          expires_at: expiresAt,
          resent_at: now,
          retired_at: null,
          invited_by: user.id,
        })
        .eq('id', existing.id)
        .select('id, token')
        .single()
      if (updErr || !updated) return json({ ok: false, error: 'Failed to update invitation' }, 500)
      invitation = updated
    } else {
      const { data: inserted, error: insErr } = await adminClient
        .from('coroast_prospect_invitations')
        .insert({ prospect_id, expires_at: expiresAt, invited_by: user.id })
        .select('id, token')
        .single()
      if (insErr || !inserted) return json({ ok: false, error: 'Failed to create invitation' }, 500)
      invitation = inserted
    }

    const exploreUrl = `${SITE_URL}/explore/${invitation.token}`
    const firstName = prospect.contact_name?.split(' ')[0] || prospect.business_name

    const subject = `You're invited to explore co-roasting with Home Island Coffee Partners`
    const html = buildEmailHtml(firstName, exploreUrl)
    const text = buildEmailText(firstName, exploreUrl)
    const messageId = crypto.randomUUID()

    // Log pending
    await adminClient.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'prospect_invitation',
      recipient_email: prospect.prospect_email,
      status: 'pending',
    })

    const { error: enqueueErr } = await adminClient.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: messageId,
        idempotency_key: messageId,
        to: prospect.prospect_email,
        from: FROM_ADDRESS,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: 'prospect_invitation',
        queued_at: now,
      },
    })

    if (enqueueErr) {
      console.error('[send-prospect-invitation] Enqueue failed:', enqueueErr.message)
      return json({ ok: false, error: 'Failed to enqueue email' }, 500)
    }

    console.log('[send-prospect-invitation] Sent to', prospect.prospect_email, 'url', exploreUrl)
    return json({ ok: true, invitation_id: invitation.id, explore_url: exploreUrl })
  } catch (err) {
    console.error('[send-prospect-invitation] Unexpected:', err)
    return json({ ok: false, error: String(err) }, 500)
  }
})
