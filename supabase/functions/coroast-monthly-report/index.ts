import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

// Monthly co-roasting billing summary.
// Triggered by pg_cron on the last day of the month (06:00 America/Vancouver)
// and manually from the billing page ("Email report" button).

const GST_RATE = 0.05
const PST_RATE = 0.07
const BILLABLE_STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW']
const TZ = 'America/Vancouver'

function vancouverParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function timeToMinutes(t: string) {
  const [h, m] = (t ?? '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !supabaseAnonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  // ---- Authorization: service_role (cron) or signed-in ADMIN ----
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  const isServiceRole = !!bearer && bearer === serviceKey
  if (!isServiceRole) {
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: roleRows } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
    if (!(roleRows ?? []).some((r: { role: string }) => r.role === 'ADMIN')) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const manual = body.manual === true
  const now = vancouverParts()

  // Cron fires hourly on the 28th-31st; only act on the true month-end at 06:00 local.
  if (!manual) {
    const isLastDay = now.day === daysInMonth(now.year, now.month)
    if (!isLastDay || now.hour !== 6) {
      return new Response(JSON.stringify({ skipped: 'not_month_end_6am' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Which month to report on
  const requestedMonth = typeof body.month === 'string' ? (body.month as string) : null
  const [year, month] = requestedMonth
    ? requestedMonth.split('-').map(Number)
    : [now.year, now.month]
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`

  // ---- Gather data ----
  const [{ data: accounts }, { data: periods }, { data: bookings }] = await Promise.all([
    admin
      .from('accounts')
      .select('id, account_name, coroast_tier, is_active, programs')
      .contains('programs', ['COROASTING'])
      .eq('is_active', true)
      .order('account_name'),
    admin
      .from('coroast_billing_periods')
      .select('*')
      .gte('period_start', periodStart)
      .lte('period_start', periodEnd),
    admin
      .from('coroast_bookings')
      .select('id, account_id, duration_hours, start_time, end_time, status')
      .gte('booking_date', periodStart)
      .lte('booking_date', periodEnd)
      .in('status', BILLABLE_STATUSES),
  ])

  const periodIds = (periods ?? []).map((p: any) => p.id)
  const [{ data: storage }, { data: extras }, { data: invoices }, { data: tierRates }] =
    await Promise.all([
      periodIds.length
        ? admin.from('coroast_storage_allocations').select('*').in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as any[] }),
      periodIds.length
        ? admin
            .from('coroast_billing_extras')
            .select('billing_period_id, description, qty, unit_price, apply_gst, apply_pst')
            .in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as any[] }),
      periodIds.length
        ? admin.from('coroast_invoices').select('*').in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as any[] }),
      admin.from('coroast_tier_rates').select('*'),
    ])

  const hoursByAccount = new Map<string, number>()
  for (const bk of bookings ?? []) {
    const dh = Number((bk as any).duration_hours)
    const hours =
      !isNaN(dh) && dh > 0
        ? dh
        : Math.max(0, (timeToMinutes((bk as any).end_time) - timeToMinutes((bk as any).start_time)) / 60)
    hoursByAccount.set(bk.account_id, (hoursByAccount.get(bk.account_id) ?? 0) + hours)
  }

  const rateFor = (tier: string) =>
    (tierRates ?? []).find((r: any) => r.tier === tier) ?? null

  const rows = (accounts ?? []).map((a: any) => {
    const tier = a.coroast_tier ?? 'MEMBER'
    const bp = (periods ?? []).find((p: any) => p.account_id === a.id)
    const fallback = rateFor(tier)

    const includedHours = Number(
      bp?.included_hours ?? fallback?.included_hours ?? 0,
    )
    const overageRate = Number(
      bp?.overage_rate_per_hr ?? fallback?.overage_rate_per_hr ?? 0,
    )
    const baseFee = Number(
      bp?.prorated_base_fee ?? bp?.base_fee ?? fallback?.base_fee ?? 0,
    )

    const invoice = bp
      ? (invoices ?? []).find((inv: any) => inv.billing_period_id === bp.id)
      : null

    let usedHours: number
    let overageHours: number
    let overageCharge: number
    if (invoice) {
      usedHours = Number(invoice.used_hours ?? 0)
      overageHours = Number(invoice.overage_hours ?? 0)
      overageCharge = Number(invoice.overage_charge ?? 0)
    } else {
      usedHours = hoursByAccount.get(a.id) ?? 0
      overageHours = Math.max(0, usedHours - includedHours)
      overageCharge = overageHours * overageRate
    }

    const alloc = (storage ?? []).find(
      (s: any) => s.billing_period_id === bp?.id && s.account_id === a.id,
    )
    const storageCharge =
      Number(alloc?.paid_pallets ?? 0) * Number(alloc?.rate_per_add_pallet ?? 0)

    let extrasSubtotal = 0
    let extrasGst = 0
    let extrasPst = 0
    for (const ex of (extras ?? []).filter((e: any) => e.billing_period_id === bp?.id)) {
      const lineTotal = Number((ex as any).qty) * Number((ex as any).unit_price)
      extrasSubtotal += lineTotal
      if ((ex as any).apply_gst) extrasGst += lineTotal * GST_RATE
      if ((ex as any).apply_pst) extrasPst += lineTotal * PST_RATE
    }

    const coreSubtotal = baseFee + overageCharge + storageCharge
    const subtotal = coreSubtotal + extrasSubtotal
    const gst = coreSubtotal * GST_RATE + extrasGst
    const grandTotal = subtotal + gst + extrasPst

    return {
      accountName: a.account_name,
      tier,
      includedHours,
      usedHours,
      overageHours,
      overageRate,
      baseFee,
      overageCharge,
      storageCharge,
      extrasSubtotal,
      gst,
      grandTotal,
      prorationNote: bp?.proration_note ?? null,
      invoiceRecorded: !!invoice,
    }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      baseFees: acc.baseFees + r.baseFee,
      overageCharges: acc.overageCharges + r.overageCharge,
      storageCharges: acc.storageCharges + r.storageCharge,
      extras: acc.extras + r.extrasSubtotal,
      gst: acc.gst + r.gst,
      grandTotal: acc.grandTotal + r.grandTotal,
    }),
    { baseFees: 0, overageCharges: 0, storageCharges: 0, extras: 0, gst: 0, grandTotal: 0 },
  )

  // ---- Recipients: every active ADMIN user ----
  const { data: adminRoles } = await admin.from('user_roles').select('user_id').eq('role', 'ADMIN')
  const adminIds = [...new Set((adminRoles ?? []).map((r: any) => r.user_id))]
  let recipients: string[] = []
  if (adminIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, email, is_active')
      .in('user_id', adminIds)
    recipients = [
      ...new Set(
        (profiles ?? [])
          .filter((p: any) => p.is_active !== false && !!p.email)
          .map((p: any) => String(p.email).toLowerCase()),
      ),
    ]
  }

  if (recipients.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No active admin recipients found', rows: rows.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const label = monthLabel(year, month)
  const generatedAt = new Date().toLocaleString('en-CA', { timeZone: TZ })
  const sendUrl = `${supabaseUrl}/functions/v1/send-transactional-email`
  const results: { email: string; ok: boolean; detail?: string }[] = []

  for (const email of recipients) {
    const idemSuffix = manual ? `-manual-${Date.now()}` : ''
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        templateName: 'coroast_monthly_billing_report',
        recipientEmail: email,
        idempotencyKey: `coroast-billing-${year}-${String(month).padStart(2, '0')}-${email}${idemSuffix}`,
        templateData: { monthLabel: label, rows, totals, generatedAt },
      }),
    })
    const detail = res.ok ? undefined : await res.text()
    if (!res.ok) console.error(`coroast-monthly-report: send failed for ${email}`, res.status, detail)
    results.push({ email, ok: res.ok, detail })
  }

  return new Response(
    JSON.stringify({
      success: results.every((r) => r.ok),
      month: `${year}-${String(month).padStart(2, '0')}`,
      members: rows.length,
      overageAccounts: rows.filter((r) => r.overageHours > 0).length,
      grandTotal: totals.grandTotal,
      recipients: results,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
