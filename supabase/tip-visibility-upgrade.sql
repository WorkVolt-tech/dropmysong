-- Drop My Song - guest tip visibility toggle
-- Run once in the Drop My Song Supabase SQL editor.
-- This separates "show tips" from the existing "tips required" setting.

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS tips_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.tips_visible IS
'Controls whether the guest request page shows the tips and payment section.';

CREATE OR REPLACE FUNCTION public.get_event_tip_visibility(p_event_id uuid)
RETURNS TABLE(tips_visible boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(e.tips_visible, true)
  FROM public.events e
  WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_tip_visibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_tip_visibility(uuid) TO anon, authenticated;
