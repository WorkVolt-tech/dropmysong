import { supabase } from './supabaseClient.js';

const params = new URLSearchParams(window.location.search);
const eventId = params.get('event') || '';

const eventName = document.querySelector('#karaokeEventName');
const notice = document.querySelector('#karaokeTvNotice');
const iframe = document.querySelector('#karaokeYoutubePlayer');
const empty = document.querySelector('#karaokeVideoEmpty');
const singerName = document.querySelector('#karaokeSingerName');
const songTitle = document.querySelector('#karaokeSongTitle');
const videoHint = document.querySelector('#karaokeVideoHint');
const nextSinger = document.querySelector('#karaokeNextSinger');
const nextSong = document.querySelector('#karaokeNextSong');
const fullscreenButton = document.querySelector('#karaokeFullscreen');

let currentVideoId = '';
let realtimeChannel = null;
let pollingTimer = null;

function showNotice(text, type = 'error') {
  notice.textContent = text;
  notice.className = `notice ${type}`;
}

function hideNotice() {
  notice.classList.add('hidden');
}

function youtubeVideoId(value = '') {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return '';
    if (url.pathname === '/watch') return url.searchParams.get('v') || '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
    return '';
  } catch {
    return '';
  }
}

function stopVideo() {
  currentVideoId = '';
  iframe.src = '';
  iframe.classList.add('hidden');
  empty.classList.remove('hidden');
}

function loadVideo(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) {
    stopVideo();
    return false;
  }
  if (videoId === currentVideoId) return true;
  currentVideoId = videoId;
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`;
  iframe.classList.remove('hidden');
  empty.classList.add('hidden');
  return true;
}

async function loadEvent() {
  if (!eventId) {
    showNotice('Missing event. Open Karaoke TV from the DJ Dashboard.');
    return false;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    showNotice('Sign in to the DJ Dashboard first, then open Karaoke TV again.');
    return false;
  }

  const { data, error } = await supabase
    .from('events')
    .select('id,name')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !data) {
    showNotice(error?.message || 'Event not found.');
    return false;
  }

  eventName.textContent = data.name;
  hideNotice();
  return true;
}

async function refreshStage() {
  const { data, error } = await supabase
    .from('song_requests')
    .select('id,artist,song,requester_name,status,sort_order,created_at,song_url,karaoke_video_url')
    .eq('event_id', eventId)
    .eq('request_type', 'karaoke')
    .in('status', ['accepted', 'playing'])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (/karaoke_video_url/i.test(error.message || '')) {
      showNotice('Run the YouTube karaoke player database upgrade in Supabase first.');
    } else {
      showNotice(error.message || 'Could not load the karaoke queue.');
    }
    return;
  }

  hideNotice();
  const rows = data || [];
  const current = rows.find(row => row.status === 'playing') || null;
  const upcoming = rows.filter(row => row.status === 'accepted');
  const next = upcoming[0] || null;

  if (!current) {
    singerName.textContent = '—';
    songTitle.textContent = 'Waiting for a karaoke request…';
    videoHint.textContent = '';
    stopVideo();
  } else {
    singerName.textContent = current.requester_name || 'Singer';
    songTitle.textContent = `${current.artist} — ${current.song}`;
    const source = current.karaoke_video_url || current.song_url || '';
    const playable = loadVideo(source);
    videoHint.textContent = playable
      ? 'YouTube karaoke video loaded.'
      : 'No YouTube karaoke video is assigned yet. Set one from the DJ Dashboard.';
  }

  nextSinger.textContent = next?.requester_name || '—';
  nextSong.textContent = next ? `${next.artist} — ${next.song}` : 'Queue is waiting.';
}

function startRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel(`dropmysong-karaoke-tv-${eventId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'song_requests',
      filter: `event_id=eq.${eventId}`,
    }, () => refreshStage())
    .subscribe();

  pollingTimer = setInterval(refreshStage, 5000);
}

fullscreenButton.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    showNotice('Fullscreen was blocked by the browser. Use the browser fullscreen control instead.');
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
});

window.addEventListener('beforeunload', () => {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  if (pollingTimer) clearInterval(pollingTimer);
});

if (await loadEvent()) {
  await refreshStage();
  startRealtime();
}
