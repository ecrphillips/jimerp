
-- Create feedback_submissions table
CREATE TABLE public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  category text NOT NULL CHECK (category IN ('BUG', 'UX_IMPROVEMENT', 'FEATURE_REQUEST', 'OTHER')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'BUILDING', 'DONE', 'WONT_DO')),
  admin_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_submissions FORCE ROW LEVEL SECURITY;

-- All authenticated users can insert their own feedback
CREATE POLICY "Users can insert own feedback"
  ON public.feedback_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Users can read their own submissions
CREATE POLICY "Users can read own feedback"
  ON public.feedback_submissions
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'ADMIN'));

-- Only admins can update (status, admin_note)
CREATE POLICY "Admins can update feedback"
  ON public.feedback_submissions
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

-- Anon gets nothing
CREATE POLICY "Anon no access"
  ON public.feedback_submissions
  FOR ALL
  TO anon
  USING (false);
