-- F-014: Add WORKFLOW as an allowed feedback category.
-- Ops users (Chris/Laura/Aaron) primarily report workflow-shaped issues
-- (process friction, missing steps, handoff gaps) that don't cleanly fit
-- Bug / UX / Feature.

ALTER TABLE public.feedback_submissions
  DROP CONSTRAINT IF EXISTS feedback_submissions_category_check;

ALTER TABLE public.feedback_submissions
  ADD CONSTRAINT feedback_submissions_category_check
  CHECK (category IN ('BUG', 'WORKFLOW', 'UX_IMPROVEMENT', 'FEATURE_REQUEST', 'OTHER'));
