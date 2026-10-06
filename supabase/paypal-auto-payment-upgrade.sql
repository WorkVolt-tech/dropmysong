-- Drop My Song - automatic PayPal confirmation
-- Run once in the Drop My Song Supabase SQL editor.
-- Existing PayPal/Interac requests are not changed.

ALTER TABLE public.song_requests
ADD COLUMN IF NOT EXISTS paypal_order_id text;

ALTER TABLE public.song_requests
ADD COLUMN IF NOT EXISTS paypal_capture_id text;

CREATE INDEX IF NOT EXISTS song_requests_paypal_order_idx
ON public.song_requests (paypal_order_id)
WHERE paypal_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS song_requests_paypal_capture_unique_idx
ON public.song_requests (paypal_capture_id)
WHERE paypal_capture_id IS NOT NULL;

COMMENT ON COLUMN public.song_requests.paypal_order_id IS
'PayPal Orders v2 order ID used for automatic checkout confirmation.';

COMMENT ON COLUMN public.song_requests.paypal_capture_id IS
'Completed PayPal capture ID used to prevent duplicate confirmation.';
