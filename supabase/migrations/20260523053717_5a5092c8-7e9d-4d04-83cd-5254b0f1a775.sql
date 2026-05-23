-- Clean up stale 'pending' rows in email_send_log that predate the
-- notify-order-event / notify-new-order html-payload fix. These rows
-- correspond to enqueue attempts whose payload was missing the required
-- `html` field, so the upstream worker logged them as failed under new
-- message_ids and these original 'pending' rows will never transition.
--
-- Mark them as 'dlq' with an explanatory error_message so they are
-- excluded from active dashboards but preserved for audit.

UPDATE public.email_send_log
SET status = 'dlq',
    error_message = COALESCE(error_message, '') ||
      CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END ||
      'Stale pending row cleaned up 2026-05-23: pre-dates html-payload fix'
WHERE status = 'pending'
  AND created_at < '2026-05-22'::timestamptz;
