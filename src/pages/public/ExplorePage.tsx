import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ExploreLayout } from '@/components/layout/ExploreLayout';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import { ROASTER_THROUGHPUT_KG_PER_HR } from '@/lib/unitEconomics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Tier = 'MEMBER' | 'GROWTH' | 'PRODUCTION';
type LoadState = 'loading' | 'not_found' | 'expired' | 'retired' | 'ready';

interface InvitationData {
  invitation_id: string;
  prospect_id: string;
  expires_at: string;
  retired_at: string | null;
  business_name: string;
  contact_name: string | null;
  has_submission: boolean;
}

const TIER_ORDER: Tier[] = ['MEMBER', 'GROWTH', 'PRODUCTION'];

const TIER_EXTRA: Record<Tier, { storage: string; horizon: string }> = {
  MEMBER: { storage: 'No storage', horizon: 'Standard booking' },
  GROWTH: { storage: '1 pallet storage', horizon: 'Priority — up to 2 weeks ahead' },
  PRODUCTION: { storage: '2 pallets storage', horizon: 'First-access booking' },
};

const CANADIAN_PROVINCES = [
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
  'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia',
  'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec',
  'Saskatchewan', 'Yukon',
];

// Per-tier cost calculation — matches unitEconomics.ts logic
function calcTier(
  tier: Tier,
  monthlyKg: number,
  greenCostPerKg: number,
  packagingPerBag: number,
  bagsPerKg: number,
  wholesalePricePerBag: number,
  retailPricePerBag: number,
) {
  const t = TIER_RATES[tier];
  const roastHoursPerMonth = monthlyKg / ROASTER_THROUGHPUT_KG_PER_HR;
  const overageHours = Math.max(0, roastHoursPerMonth - t.includedHours);
  const facilityCostPerMonth = t.base + overageHours * t.overageRate;
  const facilityCostPerKg = monthlyKg > 0 ? facilityCostPerMonth / monthlyKg : 0;
  const kgPerBag = bagsPerKg > 0 ? 1 / bagsPerKg : 0;
  // 15% roast yield loss: need 1/0.85 green kg per roasted kg
  const greenPerBag = kgPerBag * (1 / 0.85) * greenCostPerKg;
  const facilityPerBag = facilityCostPerKg * kgPerBag;
  const cogPerBag = greenPerBag + packagingPerBag + facilityPerBag;
  const wholesaleMargin = wholesalePricePerBag > 0
    ? ((wholesalePricePerBag - cogPerBag) / wholesalePricePerBag) * 100
    : null;
  const retailMargin = retailPricePerBag > 0
    ? ((retailPricePerBag - cogPerBag) / retailPricePerBag) * 100
    : null;
  const monthlyBags = monthlyKg * bagsPerKg;
  const breakEvenKg = cogPerBag > 0 && wholesalePricePerBag > cogPerBag
    ? facilityCostPerMonth / ((wholesalePricePerBag - cogPerBag) * bagsPerKg)
    : null;
  return {
    tier,
    label: t.label,
    facilityCostPerMonth,
    facilityCostPerKg,
    cogPerBag,
    wholesaleMargin,
    retailMargin,
    monthlyBags,
    breakEvenKg,
  };
}

function fmt(n: number | null, prefix = '$', decimals = 2): string {
  if (n === null || !isFinite(n)) return '—';
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtPct(n: number | null): string {
  if (n === null || !isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export default function ExplorePage() {
  const { token } = useParams<{ token: string }>();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [invitation, setInvitation] = useState<InvitationData | null>(null);

  // Calculator inputs
  const [monthlyKg, setMonthlyKg] = useState('');
  const [greenCostPerKg, setGreenCostPerKg] = useState('');
  const [packagingPerBag, setPackagingPerBag] = useState('');
  const [bagsPerKg, setBagsPerKg] = useState('7');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [retailPrice, setRetailPrice] = useState('');

  // EOI form
  const [eoiTier, setEoiTier] = useState<Tier | ''>('');
  const [eoiCompany, setEoiCompany] = useState('');
  const [eoiName, setEoiName] = useState('');
  const [eoiEmail, setEoiEmail] = useState('');
  const [eoiPhone, setEoiPhone] = useState('');
  const [eoiAddr1, setEoiAddr1] = useState('');
  const [eoiAddr2, setEoiAddr2] = useState('');
  const [eoiCity, setEoiCity] = useState('');
  const [eoiProvince, setEoiProvince] = useState('');
  const [eoiPostal, setEoiPostal] = useState('');
  const [eoiNotes, setEoiNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) { setLoadState('not_found'); return; }
    supabase.rpc('get_invitation_by_token' as any, { p_token: token }).then(({ data, error }) => {
      if (error || !data) { setLoadState('not_found'); return; }
      const inv = data as InvitationData;
      if (inv.retired_at) { setLoadState('retired'); return; }
      if (new Date(inv.expires_at) < new Date()) { setLoadState('expired'); return; }
      setInvitation(inv);
      setEoiCompany(inv.business_name);
      setEoiName(inv.contact_name ?? '');
      setLoadState('ready');
    });
  }, [token]);

  const calcResults = useMemo(() => {
    const kg = parseFloat(monthlyKg);
    const green = parseFloat(greenCostPerKg);
    const pkg = parseFloat(packagingPerBag);
    const bpk = parseFloat(bagsPerKg);
    if (!kg || !green || !pkg || !bpk) return null;
    const ws = parseFloat(wholesalePrice) || 0;
    const rt = parseFloat(retailPrice) || 0;
    return TIER_ORDER.map(t => calcTier(t, kg, green, pkg, bpk, ws, rt));
  }, [monthlyKg, greenCostPerKg, packagingPerBag, bagsPerKg, wholesalePrice, retailPrice]);

  const handleTierCardClick = (tier: Tier) => {
    setEoiTier(tier);
    document.getElementById('eoi-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !eoiTier) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_prospect_interest' as any, {
        p_token: token,
        p_selected_tier: eoiTier,
        p_company_name: eoiCompany.trim() || null,
        p_contact_name: eoiName.trim() || null,
        p_contact_email: eoiEmail.trim() || null,
        p_contact_phone: eoiPhone.trim() || null,
        p_billing_address_line1: eoiAddr1.trim() || null,
        p_billing_address_line2: eoiAddr2.trim() || null,
        p_billing_city: eoiCity.trim() || null,
        p_billing_province: eoiProvince || null,
        p_billing_postal_code: eoiPostal.trim() || null,
        p_estimated_monthly_kg: parseFloat(monthlyKg) || null,
        p_notes: eoiNotes.trim() || null,
      });

      const res = data as { ok: boolean; error?: string; submission_id?: string } | null;
      if (error || !res?.ok) throw new Error(res?.error || 'Submission failed');

      // Notify team — fire and forget
      if (res.submission_id) {
        supabase.functions.invoke('notify-prospect-submission', {
          body: { submission_id: res.submission_id },
        }).catch(() => {});
      }

      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = invitation?.contact_name?.split(' ')[0] || invitation?.business_name || '';

  if (loadState === 'loading') {
    return (
      <ExploreLayout>
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-muted-foreground">
          Loading…
        </div>
      </ExploreLayout>
    );
  }

  if (loadState !== 'ready') {
    const messages: Record<Exclude<LoadState, 'loading' | 'ready'>, string> = {
      not_found: 'This link is not valid.',
      expired: 'This link has expired. Please reach out to us and we\'ll send a fresh one.',
      retired: 'This link is no longer active.',
    };
    return (
      <ExploreLayout>
        <div className="max-w-xl mx-auto px-4 py-24 text-center space-y-4">
          <p className="text-lg text-hi-navy font-medium">{messages[loadState]}</p>
          <p className="text-muted-foreground text-sm">
            Questions? Get in touch at{' '}
            <a href="mailto:hello@homeislandcoffee.com" className="text-hi-steel-blue underline">
              hello@homeislandcoffee.com
            </a>
          </p>
        </div>
      </ExploreLayout>
    );
  }

  return (
    <ExploreLayout>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-14">

        {/* Section 1 — Welcome */}
        <section className="bg-hi-navy text-hi-sand rounded-2xl p-8 space-y-3">
          <h1 className="text-2xl font-bold">
            {firstName ? `Hi ${firstName},` : 'Welcome.'}
          </h1>
          <p className="text-hi-sand/80 leading-relaxed">
            We're glad you're here. This is your space to explore the co-roasting programme and see how the numbers might work for your business. Take your time — there's no deadline and no obligation.
          </p>
        </section>

        {/* Section 2 — Tiers */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-hi-navy">The tiers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TIER_ORDER.map((tier) => {
              const t = TIER_RATES[tier];
              const extra = TIER_EXTRA[tier];
              return (
                <button
                  key={tier}
                  onClick={() => handleTierCardClick(tier)}
                  className="text-left border-2 rounded-xl p-5 space-y-3 hover:border-hi-steel-blue hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-hi-steel-blue bg-white"
                >
                  <div>
                    <p className="font-bold text-hi-navy text-lg">{t.label}</p>
                    <p className="text-2xl font-bold text-hi-steel-blue">${t.base}<span className="text-sm font-normal text-muted-foreground">/month</span></p>
                  </div>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>{t.includedHours} hrs included</li>
                    <li>${t.overageRate}/hr overage</li>
                    <li>{extra.storage}</li>
                    <li>{extra.horizon}</li>
                  </ul>
                  <p className="text-xs text-hi-steel-blue font-medium">Click to express interest →</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 3 — Calculator */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-hi-navy">Run your numbers</h2>
            <p className="text-sm text-muted-foreground mt-1">Enter your estimates and see how the costs compare across each tier.</p>
          </div>
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Monthly roast volume (kg)</Label>
                <Input type="number" min="0" value={monthlyKg} onChange={e => setMonthlyKg(e.target.value)} placeholder="e.g. 80" />
              </div>
              <div>
                <Label className="text-xs">Green coffee cost ($/kg)</Label>
                <Input type="number" min="0" value={greenCostPerKg} onChange={e => setGreenCostPerKg(e.target.value)} placeholder="e.g. 9.50" />
              </div>
              <div>
                <Label className="text-xs">Packaging cost ($/bag)</Label>
                <Input type="number" min="0" value={packagingPerBag} onChange={e => setPackagingPerBag(e.target.value)} placeholder="e.g. 1.20" />
              </div>
              <div>
                <Label className="text-xs">Bags per kg</Label>
                <Input type="number" min="1" value={bagsPerKg} onChange={e => setBagsPerKg(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Wholesale price ($/bag)</Label>
                <Input type="number" min="0" value={wholesalePrice} onChange={e => setWholesalePrice(e.target.value)} placeholder="optional" />
              </div>
              <div>
                <Label className="text-xs">Retail price ($/bag) <span className="text-muted-foreground">optional</span></Label>
                <Input type="number" min="0" value={retailPrice} onChange={e => setRetailPrice(e.target.value)} placeholder="optional" />
              </div>
            </div>

            {calcResults && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm mt-2">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4 text-muted-foreground font-medium w-48"></th>
                      {calcResults.map(r => (
                        <th key={r.tier} className="py-2 pr-4 font-semibold text-hi-navy">{r.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="py-2 pr-4 text-muted-foreground">Monthly facility cost</td>
                      {calcResults.map(r => <td key={r.tier} className="py-2 pr-4 font-medium">{fmt(r.facilityCostPerMonth)}</td>)}
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-muted-foreground">Facility cost / kg</td>
                      {calcResults.map(r => <td key={r.tier} className="py-2 pr-4">{fmt(r.facilityCostPerKg)}</td>)}
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-muted-foreground">Est. COGS / bag</td>
                      {calcResults.map(r => <td key={r.tier} className="py-2 pr-4">{fmt(r.cogPerBag)}</td>)}
                    </tr>
                    {wholesalePrice && (
                      <tr>
                        <td className="py-2 pr-4 text-muted-foreground">Gross margin (wholesale)</td>
                        {calcResults.map(r => <td key={r.tier} className="py-2 pr-4">{fmtPct(r.wholesaleMargin)}</td>)}
                      </tr>
                    )}
                    {retailPrice && (
                      <tr>
                        <td className="py-2 pr-4 text-muted-foreground">Gross margin (retail)</td>
                        {calcResults.map(r => <td key={r.tier} className="py-2 pr-4">{fmtPct(r.retailMargin)}</td>)}
                      </tr>
                    )}
                    {wholesalePrice && (
                      <tr>
                        <td className="py-2 pr-4 text-muted-foreground">Break-even (kg/month)</td>
                        {calcResults.map(r => <td key={r.tier} className="py-2 pr-4">{r.breakEvenKg ? r.breakEvenKg.toFixed(0) : '—'}</td>)}
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">Assumes 15% roast yield loss and 40 kg/hr throughput.</p>
              </div>
            )}
          </div>
        </section>

        {/* Section 4 — Express Interest */}
        <section id="eoi-section" className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-hi-navy">Tell us which tier feels like a fit</h2>
            <p className="text-sm text-muted-foreground mt-1">No commitment — just let us know where you're leaning and we'll be in touch to talk through next steps.</p>
          </div>

          {submitted ? (
            <div className="bg-white rounded-xl border p-8 text-center space-y-2">
              <p className="text-lg font-semibold text-hi-navy">Thanks{firstName ? `, ${firstName}` : ''}.</p>
              <p className="text-muted-foreground">We'll be in touch soon to talk through next steps.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-6 space-y-6">
              {/* Tier selector */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Which tier are you curious about?</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {TIER_ORDER.map((tier) => {
                    const t = TIER_RATES[tier];
                    const selected = eoiTier === tier;
                    return (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setEoiTier(tier)}
                        className={`text-left border-2 rounded-lg p-4 transition-all focus:outline-none ${
                          selected
                            ? 'border-hi-steel-blue bg-hi-steel-blue/5'
                            : 'border-border hover:border-hi-steel-blue/50'
                        }`}
                      >
                        <p className="font-semibold text-hi-navy">{t.label}</p>
                        <p className="text-sm text-muted-foreground">${t.base}/month</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Contact fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Company name *</Label>
                  <Input required value={eoiCompany} onChange={e => setEoiCompany(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Your name *</Label>
                  <Input required value={eoiName} onChange={e => setEoiName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Email *</Label>
                  <Input type="email" required value={eoiEmail} onChange={e => setEoiEmail(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Phone <span className="text-muted-foreground">(optional)</span></Label>
                  <Input type="tel" value={eoiPhone} onChange={e => setEoiPhone(e.target.value)} />
                </div>
              </div>

              {/* Billing address */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Billing address <span className="font-normal">(optional — for when you're ready)</span></p>
                <Input placeholder="Address line 1" value={eoiAddr1} onChange={e => setEoiAddr1(e.target.value)} />
                <Input placeholder="Address line 2" value={eoiAddr2} onChange={e => setEoiAddr2(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="City" value={eoiCity} onChange={e => setEoiCity(e.target.value)} />
                  <Select value={eoiProvince} onValueChange={setEoiProvince}>
                    <SelectTrigger>
                      <SelectValue placeholder="Province" />
                    </SelectTrigger>
                    <SelectContent>
                      {CANADIAN_PROVINCES.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input placeholder="Postal code" value={eoiPostal} onChange={e => setEoiPostal(e.target.value)} className="max-w-xs" />
              </div>

              {/* Notes */}
              <div>
                <Label className="text-xs">Anything else you'd like us to know? <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea
                  value={eoiNotes}
                  onChange={e => setEoiNotes(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="resize-none"
                  placeholder="Questions, context, timing — whatever feels relevant."
                />
                <p className="text-xs text-muted-foreground text-right mt-1">{eoiNotes.length}/500</p>
              </div>

              <Button
                type="submit"
                disabled={!eoiTier || !eoiName.trim() || !eoiEmail.trim() || submitting}
                className="bg-hi-navy text-hi-sand hover:bg-hi-steel-blue w-full md:w-auto"
              >
                {submitting ? 'Sending…' : 'Let us know you\'re interested'}
              </Button>
            </form>
          )}
        </section>

      </div>
    </ExploreLayout>
  );
}
