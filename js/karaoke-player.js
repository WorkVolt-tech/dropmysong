import { supabase } from './supabaseClient.js';

const params = new URLSearchParams(window.location.search);
const eventId = params.get('event') || '';

const eventName = document.querySelector('#karaokeEventName');
const notice = document.querySelector('#karaokeTvNotice');
const playerElement = document.querySelector('#karaokeYoutubePlayer');
const fallbackPanel = document.querySelector('#karaokeYoutubeFallback');
const fallbackCopy = document.querySelector('#karaokeYoutubeFallbackCopy');
const openYoutubeFallback = document.querySelector('#openYoutubeFallback');
const empty = document.querySelector('#karaokeVideoEmpty');
const singerName = document.querySelector('#karaokeSingerName');
const songTitle = document.querySelector('#karaokeSongTitle');
const videoHint = document.querySelector('#karaokeVideoHint');
const nextSinger = document.querySelector('#karaokeNextSinger');
const nextSong = document.querySelector('#karaokeNextSong');
const fullscreenButton = document.querySelector('#karaokeFullscreen');

let currentVideoId = '';
let currentYoutubeUrl = '';
let youtubePlayer = null;
let youtubeApiReady = null;
let directYoutubeWindow = null;
let realtimeChannel = null;
let pollingTimer = null;
let currentRequestId = '';
let youtubePlayerReady = false;
let pendingPlayRequestId = '';
const karaokeControlChannel = 'BroadcastChannel' in window ? new BroadcastChannel('dropmysong-karaoke-control') : null;

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

function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiReady) return youtubeApiReady;

  youtubeApiReady = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') previousReady();
      resolve();
    };

    const existing = document.querySelector('script[data-dropmysong-youtube-api]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.dropmysongYoutubeApi = 'true';
      script.onerror = () => reject(new Error('Could not load the YouTube player API.'));
      document.head.appendChild(script);
    }
  });

  return youtubeApiReady;
}

function hideFallback() {
  fallbackPanel.classList.add('hidden');
}

function showFallback(message = 'The video owner does not allow playback inside other websites.') {
  fallbackCopy.textContent = message;
  fallbackPanel.classList.remove('hidden');
  empty.classList.add('hidden');
  playerElement.classList.add('hidden');
}

function closeDirectYoutubeWindow() {
  if (directYoutubeWindow && !directYoutubeWindow.closed) {
    try { directYoutubeWindow.close(); } catch {}
  }
  directYoutubeWindow = null;
}

function stopVideo() {
  currentVideoId = '';
  currentYoutubeUrl = '';
  currentRequestId = '';
  youtubePlayerReady = false;
  pendingPlayRequestId = '';
  hideFallback();
  closeDirectYoutubeWindow();
  try {
    youtubePlayer?.stopVideo?.();
    youtubePlayer?.destroy?.();
  } catch {}
  youtubePlayer = null;
  playerElement.innerHTML = '';
  playerElement.classList.add('hidden');
  empty.classList.remove('hidden');
}

async function loadVideo(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) {
    stopVideo();
    return false;
  }
  if (videoId === currentVideoId && youtubePlayer) return true;

  closeDirectYoutubeWindow();
  hideFallback();
  currentVideoId = videoId;
  currentYoutubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  empty.classList.add('hidden');
  playerElement.classList.remove('hidden');

  try {
    await loadYoutubeApi();
    try { youtubePlayer?.destroy?.(); } catch {}
    playerElement.innerHTML = '';

    youtubePlayer = new window.YT.Player(playerElement, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        rel: 0,
        playsinline: 1,
      },
      events: {
        onReady: event => {
          youtubePlayerReady = true;
          try { event.target.pauseVideo(); } catch {}
          if (pendingPlayRequestId && pendingPlayRequestId === currentRequestId) {
            pendingPlayRequestId = '';
            try { event.target.playVideo(); } catch {}
            videoHint.textContent = 'Karaoke is playing.';
          }
        },
        onError: event => {
          const code = Number(event.data);
          if (code === 101 || code === 150) {
            showFallback('The video owner disabled playback on other websites. Open the real YouTube page instead.');
          } else if (code === 100) {
            showFallback('This YouTube video is unavailable. Choose another video or open it directly on YouTube.');
          } else {
            showFallback('YouTube could not play this video inside Karaoke TV. You can open it directly on YouTube.');
          }
        },
      },
    });
    return true;
  } catch (error) {
    showFallback(error?.message || 'YouTube could not load inside Karaoke TV.');
    return true;
  }
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
    currentRequestId = current.id;
    const source = current.karaoke_video_url || current.song_url || '';
    const playable = await loadVideo(source);
    videoHint.textContent = playable
      ? 'Singer called — waiting for the DJ to press Start Karaoke.'
      : 'No YouTube karaoke video is assigned yet. Set one from the DJ Dashboard.';
  }

  nextSinger.textContent = next?.requester_name || '—';
  nextSong.textContent = next ? `${next.artist} — ${next.song}` : 'Queue is waiting.';
}

function handleKaraokeControl(message) {
  if (!message || !['play', 'pause', 'restart', 'stop'].includes(message.action)) return;
  if (message.event_id !== eventId || message.request_id !== currentRequestId) return;

  if (!youtubePlayerReady || !youtubePlayer) {
    if (message.action === 'play' || message.action === 'restart') {
      pendingPlayRequestId = message.request_id;
      videoHint.textContent = message.action === 'restart' ? 'Restarting karaoke…' : 'Starting karaoke…';
    }
    return;
  }

  try {
    if (message.action === 'play') {
      youtubePlayer.playVideo();
      videoHint.textContent = 'Karaoke is playing.';
      return;
    }

    if (message.action === 'pause') {
      youtubePlayer.pauseVideo();
      videoHint.textContent = 'Karaoke paused.';
      return;
    }

    if (message.action === 'restart') {
      youtubePlayer.seekTo(0, true);
      youtubePlayer.playVideo();
      videoHint.textContent = 'Karaoke restarted.';
      return;
    }

    if (message.action === 'stop') {
      youtubePlayer.pauseVideo();
      youtubePlayer.seekTo(0, true);
      videoHint.textContent = 'Karaoke stopped — ready to start again.';
    }
  } catch {
    if (message.action === 'play' || message.action === 'restart') {
      pendingPlayRequestId = message.request_id;
    }
  }
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

  karaokeControlChannel?.addEventListener('message', event => handleKaraokeControl(event.data));
  window.addEventListener('storage', event => {
    if (event.key !== 'dropmysong-karaoke-control' || !event.newValue) return;
    try { handleKaraokeControl(JSON.parse(event.newValue)); } catch {}
  });
}

openYoutubeFallback.addEventListener('click', () => {
  if (!currentYoutubeUrl) {
    showNotice('No YouTube video is assigned to the current singer.');
    return;
  }
  directYoutubeWindow = window.open(currentYoutubeUrl, 'dropmysong-youtube-direct');
  if (!directYoutubeWindow) {
    showNotice('The browser blocked the YouTube window. Allow pop-ups for Drop My Song and try again.');
    return;
  }
  showNotice('YouTube opened directly. Put that YouTube player fullscreen. Mark the singer Completed in the DJ Dashboard when finished.', 'success');
});

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
  closeDirectYoutubeWindow();
  try { karaokeControlChannel?.close(); } catch {}
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  if (pollingTimer) clearInterval(pollingTimer);
});

if (await loadEvent()) {
  await refreshStage();
  startRealtime();
}
