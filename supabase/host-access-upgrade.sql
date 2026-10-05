-- Drop My Song - Host access upgrade
-- Run this once in the Supabase SQL editor before using host.html.

CREATE TABLE IF NOT EXISTS public.event_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  host_email text NOT NULL,
  display_name text,
  event_name text NOT NULL,
  event_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, host_email)
);

ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DMS owners manage event hosts" ON public.event_hosts;
CREATE POLICY "DMS owners manage event hosts"
ON public.event_hosts
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_hosts.event_id
      AND e.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_hosts.event_id
      AND e.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "DMS hosts read own assignments" ON public.event_hosts;
CREATE POLICY "DMS hosts read own assignments"
ON public.event_hosts
FOR SELECT
TO authenticated
USING (
  lower(host_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

DROP POLICY IF EXISTS "DMS hosts read assigned requests" ON public.song_requests;
CREATE POLICY "DMS hosts read assigned requests"
ON public.song_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.event_hosts h
    WHERE h.event_id = song_requests.event_id
      AND lower(h.host_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

CREATE TABLE IF NOT EXISTS public.host_calls (
  request_id uuid PRIMARY KEY REFERENCES public.song_requests(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  host_email text NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.host_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DMS hosts read calls for assigned events" ON public.host_calls;
CREATE POLICY "DMS hosts read calls for assigned events"
ON public.host_calls
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.event_hosts h
    WHERE h.event_id = host_calls.event_id
      AND lower(h.host_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

DROP POLICY IF EXISTS "DMS hosts mark assigned requests called" ON public.host_calls;
CREATE POLICY "DMS hosts mark assigned requests called"
ON public.host_calls
FOR INSERT
TO authenticated
WITH CHECK (
  lower(host_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  AND EXISTS (
    SELECT 1
    FROM public.event_hosts h
    WHERE h.event_id = host_calls.event_id
      AND lower(h.host_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  AND EXISTS (
    SELECT 1
    FROM public.song_requests r
    WHERE r.id = host_calls.request_id
      AND r.event_id = host_calls.event_id
  )
);

DROP POLICY IF EXISTS "DMS owners read host calls" ON public.host_calls;
CREATE POLICY "DMS owners read host calls"
ON public.host_calls
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = host_calls.event_id
      AND e.owner_id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_hosts TO authenticated;
GRANT SELECT, INSERT ON public.host_calls TO authenticated;
GRANT SELECT ON public.song_requests TO authenticated;
