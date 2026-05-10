-- Add dedicated email column to prospects
ALTER TABLE public.prospects ADD COLUMN prospect_email text;

-- Invitation table (one row per prospect, upsert on resend)
CREATE TABLE public.coroast_prospect_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid REFERENCES auth.users(id),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  resent_at    timestamptz,
  retired_at   timestamptz,
  CONSTRAINT one_invite_per_prospect UNIQUE (prospect_id)
);

CREATE INDEX idx_prospect_invitations_token ON public.coroast_prospect_invitations(token);

ALTER TABLE public.coroast_prospect_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_prospect_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon prospect invitations"
  ON public.coroast_prospect_invitations FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops manage prospect invitations"
  ON public.coroast_prospect_invitations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Submission table
CREATE TABLE public.coroast_prospect_submissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id         uuid NOT NULL REFERENCES public.coroast_prospect_invitations(id),
  prospect_id           uuid NOT NULL REFERENCES public.prospects(id),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  selected_tier         text CHECK (selected_tier IN ('MEMBER', 'GROWTH', 'PRODUCTION')),
  company_name          text,
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city          text,
  billing_province      text,
  billing_postal_code   text,
  estimated_monthly_kg  numeric,
  notes                 text,
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'CONVERTED')),
  reviewed_by           uuid REFERENCES auth.users(id),
  reviewed_at           timestamptz
);

CREATE INDEX idx_prospect_submissions_prospect ON public.coroast_prospect_submissions(prospect_id);
CREATE INDEX idx_prospect_submissions_status   ON public.coroast_prospect_submissions(status);

ALTER TABLE public.coroast_prospect_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_prospect_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon prospect submissions"
  ON public.coroast_prospect_submissions FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops manage prospect submissions"
  ON public.coroast_prospect_submissions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- RPC: validate token + return invitation context (anon-accessible)
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'invitation_id',  i.id,
    'prospect_id',    i.prospect_id,
    'expires_at',     i.expires_at,
    'retired_at',     i.retired_at,
    'business_name',  p.business_name,
    'contact_name',   p.contact_name,
    'has_submission', EXISTS (
      SELECT 1 FROM public.coroast_prospect_submissions s WHERE s.invitation_id = i.id
    )
  ) INTO v_result
  FROM public.coroast_prospect_invitations i
  JOIN public.prospects p ON p.id = i.prospect_id
  WHERE i.token = p_token;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;

-- RPC: submit expression of interest (anon-accessible, validates token)
CREATE OR REPLACE FUNCTION public.submit_prospect_interest(
  p_token                 text,
  p_selected_tier         text,
  p_company_name          text DEFAULT NULL,
  p_contact_name          text DEFAULT NULL,
  p_contact_email         text DEFAULT NULL,
  p_contact_phone         text DEFAULT NULL,
  p_billing_address_line1 text DEFAULT NULL,
  p_billing_address_line2 text DEFAULT NULL,
  p_billing_city          text DEFAULT NULL,
  p_billing_province      text DEFAULT NULL,
  p_billing_postal_code   text DEFAULT NULL,
  p_estimated_monthly_kg  numeric DEFAULT NULL,
  p_notes                 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv coroast_prospect_invitations;
  v_id  uuid;
BEGIN
  SELECT * INTO v_inv
  FROM public.coroast_prospect_invitations WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF v_inv.retired_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invitation_retired');
  END IF;
  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invitation_expired');
  END IF;
  IF p_selected_tier NOT IN ('MEMBER', 'GROWTH', 'PRODUCTION') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tier');
  END IF;

  INSERT INTO public.coroast_prospect_submissions (
    invitation_id, prospect_id, selected_tier,
    company_name, contact_name, contact_email, contact_phone,
    billing_address_line1, billing_address_line2, billing_city,
    billing_province, billing_postal_code, estimated_monthly_kg, notes
  ) VALUES (
    v_inv.id, v_inv.prospect_id, p_selected_tier,
    p_company_name, p_contact_name, p_contact_email, p_contact_phone,
    p_billing_address_line1, p_billing_address_line2, p_billing_city,
    p_billing_province, p_billing_postal_code, p_estimated_monthly_kg, p_notes
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_prospect_interest(text,text,text,text,text,text,text,text,text,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_prospect_interest(text,text,text,text,text,text,text,text,text,text,text,numeric,text) TO anon, authenticated;
