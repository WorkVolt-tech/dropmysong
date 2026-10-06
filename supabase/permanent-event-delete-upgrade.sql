-- Drop My Song - permanent event deletion
-- Run this once in the Drop My Song Supabase SQL editor.
-- It creates an owner-only RPC that permanently removes an event and all known related data.

CREATE OR REPLACE FUNCTION public.delete_owned_event(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS '
  DELETE FROM public.push_subscriptions ps
  USING public.song_requests sr, public.events e
  WHERE ps.request_id = sr.id
    AND sr.event_id = p_event_id
    AND e.id = p_event_id
    AND e.owner_id = auth.uid();

  DELETE FROM public.host_calls hc
  USING public.events e
  WHERE hc.event_id = p_event_id
    AND e.id = p_event_id
    AND e.owner_id = auth.uid();

  DELETE FROM public.song_requests sr
  USING public.events e
  WHERE sr.event_id = p_event_id
    AND e.id = p_event_id
    AND e.owner_id = auth.uid();

  DELETE FROM public.host_invites hi
  USING public.events e
  WHERE hi.event_id = p_event_id
    AND e.id = p_event_id
    AND e.owner_id = auth.uid();

  DELETE FROM public.event_hosts eh
  USING public.events e
  WHERE eh.event_id = p_event_id
    AND e.id = p_event_id
    AND e.owner_id = auth.uid();

  DELETE FROM public.events e
  WHERE e.id = p_event_id
    AND e.owner_id = auth.uid()
  RETURNING e.id;
';

REVOKE ALL ON FUNCTION public.delete_owned_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_owned_event(uuid) TO authenticated;
