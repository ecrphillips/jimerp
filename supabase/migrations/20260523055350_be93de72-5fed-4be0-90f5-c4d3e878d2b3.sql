UPDATE public.email_send_log
SET status = 'dlq',
    error_message = COALESCE(error_message, '') ||
      CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END ||
      'Stale pending row cleaned up 2026-05-23: pre-dates html-payload fix'
WHERE status = 'pending'
  AND created_at < '2026-05-22'::timestamptz;