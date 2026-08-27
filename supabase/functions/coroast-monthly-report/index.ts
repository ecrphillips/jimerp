import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts'

// Monthly co-roasting billing summary.
// Triggered by pg_cron on the last day of the month (06:00 America/Vancouver)
// and manually from the billing page ("Email report" button).

const GST_RATE = 0.05
const PST_RATE = 0.07
const BILLABLE_STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW']
const TZ = 'America/Vancouver'
const TIER_RATES_SETTINGS_KEY = 'coroast_tier_rates'

type TierRate = {
  base: number
  includedHours: number
  overageRate: number
  includedPallets: number
  storageRate: number
}

type AccountRow = {
  id: string
  account_name: string
  coroast_tier?: string | null
  coroast_custom_base_fee?: number | null
  coroast_custom_included_hours?: number | null
  coroast_custom_overage_rate?: number | null
  coroast_custom_included_pallets?: number | null
  coroast_custom_storage_rate?: number | null
}

type TierRateDbRow = {
  tier?: string | null
  base_fee?: number | string | null
  included_hours?: number | string | null
  overage_rate_per_hr?: number | string | null
}

type BillingPeriodRow = {
  id: string
  account_id: string | null
  included_hours: number | string | null
  overage_rate_per_hr: number | string | null
  base_fee: number | string | null
  prorated_base_fee: number | string | null
  proration_note: string | null
  is_closed: boolean | null
}

type BookingRow = {
  account_id: string
  duration_hours: number | string | null
  start_time: string | null
  end_time: string | null
}

type StorageRow = {
  billing_period_id: string | null
  account_id: string | null
  paid_pallets: number | string | null
  rate_per_add_pallet: number | string | null
}

type ExtraRow = {
  billing_period_id: string | null
  qty: number | string | null
  unit_price: number | string | null
  apply_gst: boolean | null
  apply_pst: boolean | null
}

type InvoiceRow = {
  billing_period_id: string | null
  used_hours: number | string | null
  overage_hours: number | string | null
}

type AdminRoleRow = { user_id: string | null }
type ProfileRow = { email: string | null; is_active: boolean | null }

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

function numOr(v: unknown, fallback: number) {
  const n = Number(v)
  return v == null || !Number.isFinite(n) ? fallback : n
}

function mergeTierRates(dbRows: TierRateDbRow[] = [], settingsValue: unknown): Record<string, TierRate> {
  const rates: Record<string, TierRate> = {}

  for (const r of dbRows) {
    const tier = String(r.tier ?? '')
    if (!tier) continue
    rates[tier] = {
      base: Number(r.base_fee ?? 0),
      includedHours: Number(r.included_hours ?? 0),
      overageRate: Number(r.overage_rate_per_hr ?? 0),
      includedPallets: 0,
      storageRate: 0,
    }
  }

  if (settingsValue && typeof settingsValue === 'object') {
    for (const [tier, value] of Object.entries(settingsValue as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const raw = value as Partial<TierRate>
      const current = rates[tier] ?? rates.MEMBER ?? {
        base: 0,
        includedHours: 0,
        overageRate: 0,
        includedPallets: 0,
        storageRate: 0,
      }
      rates[tier] = {
        base: numOr(raw.base, current.base),
        includedHours: numOr(raw.includedHours, current.includedHours),
        overageRate: numOr(raw.overageRate, current.overageRate),
        includedPallets: numOr(raw.includedPallets, current.includedPallets),
        storageRate: numOr(raw.storageRate, current.storageRate),
      }
    }
  }

  return rates
}

function accountRates(account: AccountRow, globalRates: Record<string, TierRate>): TierRate {
  const tier = account.coroast_tier ?? 'MEMBER'
  const fallback = globalRates[tier] ?? globalRates.MEMBER ?? {
    base: 0,
    includedHours: 0,
    overageRate: 0,
    includedPallets: 0,
    storageRate: 0,
  }
  return {
    base: numOr(account.coroast_custom_base_fee, fallback.base),
    includedHours: numOr(account.coroast_custom_included_hours, fallback.includedHours),
    overageRate: numOr(account.coroast_custom_overage_rate, fallback.overageRate),
    includedPallets: numOr(account.coroast_custom_included_pallets, fallback.includedPallets),
    storageRate: numOr(account.coroast_custom_storage_rate, fallback.storageRate),
  }
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
      .select('id, account_name, coroast_tier, is_active, programs, coroast_custom_base_fee, coroast_custom_included_hours, coroast_custom_overage_rate, coroast_custom_included_pallets, coroast_custom_storage_rate')
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

  const accountRows = (accounts ?? []) as AccountRow[]
  const periodRows = (periods ?? []) as BillingPeriodRow[]
  const bookingRows = (bookings ?? []) as BookingRow[]
  const periodIds = periodRows.map((p) => p.id)
  const [{ data: storage }, { data: extras }, { data: invoices }, { data: tierRates }] =
    await Promise.all([
      periodIds.length
        ? admin.from('coroast_storage_allocations').select('*').in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as StorageRow[] }),
      periodIds.length
        ? admin
            .from('coroast_billing_extras')
            .select('billing_period_id, description, qty, unit_price, apply_gst, apply_pst')
            .in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as ExtraRow[] }),
      periodIds.length
        ? admin.from('coroast_invoices').select('*').in('billing_period_id', periodIds)
        : Promise.resolve({ data: [] as InvoiceRow[] }),
      admin.from('coroast_tier_rates').select('*'),
    ])

  const storageRows = (storage ?? []) as StorageRow[]
  const extraRows = (extras ?? []) as ExtraRow[]
  const invoiceRows = (invoices ?? []) as InvoiceRow[]

  const { data: settingsRow } = await admin
    .from('app_settings')
    .select('value_json')
    .eq('key', TIER_RATES_SETTINGS_KEY)
    .maybeSingle()
  const globalRates = mergeTierRates((tierRates ?? []) as TierRateDbRow[], settingsRow?.value_json ?? null)

  const hoursByAccount = new Map<string, number>()
  for (const bk of bookingRows) {
    const dh = Number(bk.duration_hours)
    const hours =
      !isNaN(dh) && dh > 0
        ? dh
        : Math.max(0, (timeToMinutes(bk.end_time ?? '0:0') - timeToMinutes(bk.start_time ?? '0:0')) / 60)
    hoursByAccount.set(bk.account_id, (hoursByAccount.get(bk.account_id) ?? 0) + hours)
  }

  const rows = accountRows.map((a) => {
    const tier = a.coroast_tier ?? 'MEMBER'
    const bp = periodRows.find((p) => p.account_id === a.id)
    const rates = accountRates(a, globalRates)

    const includedHours = Number(
      bp?.included_hours ?? rates.includedHours,
    )
    const overageRate = rates.overageRate
    const baseFee = Number(
      bp?.prorated_base_fee ?? bp?.base_fee ?? rates.base,
    )

    const invoice = bp
      ? invoiceRows.find((inv) => inv.billing_period_id === bp.id)
      : null

    let usedHours: number
    let overageHours: number
    let overageCharge: number
    if (bp?.is_closed && invoice) {
      usedHours = Number(invoice.used_hours ?? 0)
      overageHours = Number(invoice.overage_hours ?? 0)
      overageCharge = overageHours * overageRate
    } else {
      usedHours = hoursByAccount.get(a.id) ?? 0
      overageHours = Math.max(0, usedHours - includedHours)
      overageCharge = overageHours * overageRate
    }

    const alloc = storageRows.find(
      (s) => s.billing_period_id === bp?.id && s.account_id === a.id,
    )
    const storageCharge =
      Number(alloc?.paid_pallets ?? 0) * Number(alloc?.rate_per_add_pallet ?? 0)

    let extrasSubtotal = 0
    let extrasGst = 0
    let extrasPst = 0
    for (const ex of extraRows.filter((e) => e.billing_period_id === bp?.id)) {
      const lineTotal = Number(ex.qty) * Number(ex.unit_price)
      extrasSubtotal += lineTotal
      if (ex.apply_gst) extrasGst += lineTotal * GST_RATE
      if (ex.apply_pst) extrasPst += lineTotal * PST_RATE
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
  const adminIds = [...new Set(((adminRoles ?? []) as AdminRoleRow[]).map((r) => r.user_id).filter((id): id is string => !!id))]
  let recipients: string[] = []
  if (adminIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, email, is_active')
      .in('user_id', adminIds)
    recipients = [
      ...new Set(
        (profiles ?? [])
          .filter((p: ProfileRow) => p.is_active !== false && !!p.email)
          .map((p: ProfileRow) => String(p.email).toLowerCase()),
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
  const results: { email: string; ok: boolean; detail?: string }[] = []

  for (const email of recipients) {
    const idemSuffix = manual ? `-manual-${Date.now()}` : ''
    try {
      const result = await sendTemplateEmail('coroast_monthly_billing_report', email, {
        templateData: { monthLabel: label, rows, totals, generatedAt },
        idempotencyKey: `coroast-billing-${year}-${String(month).padStart(2, '0')}-${email}${idemSuffix}`,
      })
      if (result.sent) {
        results.push({ email, ok: true })
      } else {
        console.log(`coroast-monthly-report: skipped ${email} (${result.reason})`)
        results.push({ email, ok: true, detail: result.reason })
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error(`coroast-monthly-report: send failed for ${email}`, detail)
      results.push({ email, ok: false, detail })
    }
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
