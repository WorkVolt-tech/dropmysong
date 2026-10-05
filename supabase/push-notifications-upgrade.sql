-- Drop My Song — background karaoke push notifications.
-- Safe migration: no functions, no dollar-quoted blocks.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.song_requests(id) ON DELETE CASCADE,
  guest_token text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  page_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_request_idx
ON public.push_subscriptions(request_id, created_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guests register karaoke push" ON public.push_subscriptions;

REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT INSERT ON public.push_subscriptions TO anon, authenticated;

CREATE POLICY "Guests register karaoke push"
ON public.push_subscriptions
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(trim(guest_token)) BETWEEN 20 AND 80
  AND endpoint LIKE 'https://%'
  AND char_length(trim(p256dh)) > 20
  AND char_length(trim(auth)) > 8
  AND language IN ('en', 'fr')
);
