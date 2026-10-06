-- Drop My Song - Public recent-played list
-- Run this once in the Supabase SQL editor.
-- This view intentionally exposes ONLY the event id, artist, song and played time.
-- Requester names, messages, payment data and guest tokens are NOT included.

CREATE OR REPLACE VIEW public.dropmysong_recent_played AS
SELECT
  id,
  event_id,
  artist,
  song,
  played_at
FROM public.song_requests
WHERE status = 'played'
  AND coalesce(request_type, 'song') <> 'karaoke'
  AND played_at IS NOT NULL;

REVOKE ALL ON public.dropmysong_recent_played FROM PUBLIC;
GRANT SELECT ON public.dropmysong_recent_played TO anon, authenticated;
