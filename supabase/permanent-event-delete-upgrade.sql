-- Drop My Song - permanent event deletion
-- Run this once in the Drop My Song Supabase SQL editor.
-- This creates an owner-only RPC. It permanently removes the event, requests,
-- karaoke history, payment/tip data stored on requests, host calls/invites,
-- and push subscriptions tied to those requests.
-- Optional host/push tables are handled safely if they are not installed.

CREATE OR REPLACE FUNCTION public.delete_owned_event(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.events
    WHERE id = p_event_id
      AND owner_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  IF to_regclass(''public.push_subscriptions'') IS NOT NULL THEN
    EXECUTE ''DELETE FROM public.push_subscriptions
             WHERE request_id IN (
               SELECT id FROM public.song_requests WHERE event_id = $1
             )''
    USING p_event_id;
  END IF;

  IF to_regclass(''public.host_calls'') IS NOT NULL THEN
    EXECUTE ''DELETE FROM public.host_calls WHERE event_id = $1''
    USING p_event_id;
  END IF;

  DELETE FROM public.song_requests
  WHERE event_id = p_event_id;

  IF to_regclass(''public.host_invites'') IS NOT NULL THEN
    EXECUTE ''DELETE FROM public.host_invites WHERE event_id = $1''
    USING p_event_id;
  END IF;

  IF to_regclass(''public.event_hosts'') IS NOT NULL THEN
    EXECUTE ''DELETE FROM public.event_hosts WHERE event_id = $1''
    USING p_event_id;
  END IF;

  DELETE FROM public.events
  WHERE id = p_event_id
    AND owner_id = auth.uid();

  RETURN p_event_id;
END;
';

REVOKE ALL ON FUNCTION public.delete_owned_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_owned_event(uuid) TO authenticated;
