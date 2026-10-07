ALTER TABLE public.song_requests
ADD COLUMN IF NOT EXISTS karaoke_video_url text;

COMMENT ON COLUMN public.song_requests.karaoke_video_url IS
'YouTube karaoke video selected by the DJ for projector/TV playback.';
