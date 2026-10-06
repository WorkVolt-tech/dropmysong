-- Drop My Song - Analytics + Event Archive upgrade
-- Run once in the Drop My Song Supabase SQL editor.
-- This does not delete or rewrite any existing event/request data.

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS events_owner_archived_idx
ON public.events (owner_id, archived_at, created_at DESC);

COMMENT ON COLUMN public.events.archived_at IS
'When set, the event is kept for analytics/history but hidden from the active Events list.';
