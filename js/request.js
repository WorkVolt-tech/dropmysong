import { supabase } from './supabaseClient.js';
import { escapeHtml, getOrCreateGuestToken, isHttpUrl } from './common.js';
import { applyTranslations, getLanguage, initI18n, t } from './i18n.js';

const params = new URLSearchParams(location.search);
const eventSlug = params.get('event');
const guestToken = getOrCreateGuestToken();

const form = document.querySelector('#requestForm');
const eventBanner = document.querySelector('#eventBanner');
const notice = document.querySelector('#guestNotice');
const tipsPanel = document.querySelector('#tipsPanel');
const tipAmount = document.querySelector('#tipAmount');
const submitButton = document.querySelector('#submitButton');
const statusPanel = document.querySelector('#statusPanel');
const statusSong = document.querySelector('#statusSong');
const statusBadge = document.querySelector('#statusBadge');
const statusText = document.querySelector('#statusText');
const cantFindHelp = document.querySelector('#cantFindHelp');
const helpSongUrl = document.querySelector('#helpSongUrl');
const saveHelpLink = document.querySelector('#saveHelpLink');
const message = document.querySelector('#message');
const messageCount = document.querySelector('#messageCount');
const requesterName = document.querySelector('#requesterName');
const requesterLabelText = document.querySelector('#requesterLabelText');
const requesterOptional = document.querySelector('#requesterOptional');
const requesterRequired = document.querySelector('#requesterRequired');
const heroEyebrow = document.querySelector('#heroEyebrow');
const heroTitle = document.querySelector('#heroTitle');
const heroSubtitle = document.querySelector('#heroSubtitle');
const requestModeButtons = [...document.querySelectorAll('[data-request-type]')];
const enableAlertsButton = document.querySelector('#enableAlertsButton');
const liveIndicator = document.querySelector('#liveIndicator');
const karaokeReadyAlert = document.querySelector('#karaokeReadyAlert');
const karaokeReadySong = document.querySelector('#karaokeReadySong');
const readyAcknowledge = document.querySelector('#readyAcknowledge');

let requestType = params.get('type') === 'karaoke' ? 'karaoke' : 'song';
let publicEvent = null;
let currentRequest = null;
let pollTimer = null;
let requestRealtime = null;
let readyAnnouncementVersion = null;
let audioContext = null;

initI18n();
setRequestType(requestType, false);

message.addEventListener('input', () => {
  messageCount.textContent = message.value.length;
});

document.querySelectorAll('[data-tip]').forEach(button => {
  button.addEventListener('click', () => {
    const alreadyActive = button.classList.contains('active');
    document.querySelectorAll('[data-tip]').forEach(item => item.classList.remove('active'));
    tipAmount.value = alreadyActive ? '' : button.dataset.tip;
    if (!alreadyActive) button.classList.add('active');
  });
});

requestModeButtons.forEach(button => {
  button.addEventListener('click', () => setRequestType(button.dataset.requestType, true));
});

function showNotice(text, type = '') {
  notice.textContent = text;
  notice.className = `notice ${type}`.trim();
  notice.classList.remove('hidden');
}

function clearNotice() {
  notice.classList.add('hidden');
}

function setRequestType(type, updateUrl = true) {
  requestType = type === 'karaoke' ? 'karaoke' : 'song';
  requestModeButtons.forEach(button => button.classList.toggle('active', button.dataset.requestType === requestType));

  const karaoke = requestType === 'karaoke';
  heroEyebrow.textContent = t(karaoke ? 'guest.eyebrow.karaoke' : 'guest.eyebrow.song');
  heroTitle.textContent = t(karaoke ? 'guest.title.karaoke' : 'guest.title.song');
  heroSubtitle.textContent = t(karaoke ? 'guest.subtitle.karaoke' : 'guest.subtitle.song');
  requesterLabelText.textContent = t(karaoke ? 'guest.singerName' : 'guest.yourName');
  requesterName.placeholder = t(karaoke ? 'guest.singerPlaceholder' : 'guest.namePlaceholder');
  requesterName.required = karaoke;
  requesterOptional.classList.toggle('hidden', karaoke);
  requesterRequired.classList.toggle('hidden', !karaoke);
  message.placeholder = t(karaoke ? 'guest.karaokeMessagePlaceholder' : 'guest.messagePlaceholder');
  submitButton.textContent = t(karaoke ? 'guest.submit.karaoke' : 'guest.submit.song');

  if (updateUrl) {
    const url = new URL(location.href);
    if (karaoke) url.searchParams.set('type', 'karaoke');
    else url.searchParams.delete('type');
    history.replaceState({}, '', url);
  }

  syncAvailability();
}

function syncAvailability() {
  if (!publicEvent) return;
  clearNotice();
  const enabled = requestType === 'karaoke' ? publicEvent.karaoke_enabled : publicEvent.requests_enabled;
  if (!enabled) {
    showNotice(t(requestType === 'karaoke' ? 'notice.karaokePaused' : 'notice.songPaused'));
    form.classList.add('hidden');
  } else {
    form.classList.remove('hidden');
  }
  tipsPanel.classList.toggle('hidden', !publicEvent.tips_enabled);
}

async function loadEvent() {
  if (!eventSlug) {
    showNotice(t('notice.missingEvent'), 'error');
    form.classList.add('hidden');
    return;
  }

  const { data, error } = await supabase.rpc('get_public_event', { p_slug: eventSlug });
  if (error || !data?.length) {
    console.error(error);
    showNotice(t('notice.eventNotFound'), 'error');
    form.classList.add('hidden');
    return;
  }

  publicEvent = data[0];
  renderEventBanner();
  syncAvailability();
  restoreLastRequest();
}

function renderEventBanner() {
  if (!publicEvent) return;
  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  eventBanner.innerHTML = `<strong>${escapeHtml(publicEvent.name)}</strong>${publicEvent.event_date ? ` · ${escapeHtml(new Date(publicEvent.event_date + 'T00:00:00').toLocaleDateString(locale))}` : ''}`;
  eventBanner.classList.remove('hidden');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  primeAudio();

  const artist = document.querySelector('#artist').value.trim();
  const song = document.querySelector('#song').value.trim();
  const songUrl = document.querySelector('#songUrl').value.trim();
  const name = requesterName.value.trim();
  const note = message.value.trim();

  if (!artist || !song) {
    showNotice(t('notice.artistSongRequired'), 'error');
    return;
  }
  if (requestType === 'karaoke' && !name) {
    showNotice(t('notice.singerRequired'), 'error');
    return;
  }
  if (!isHttpUrl(songUrl)) {
    showNotice(t('notice.invalidLink'), 'error');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = t('guest.sending');

  const { data, error } = await supabase.rpc('submit_request_v2', {
    p_event_slug: eventSlug,
    p_request_type: requestType,
    p_artist: artist,
    p_song: song,
    p_song_url: songUrl || null,
    p_requester_name: name || null,
    p_message: note || null,
    p_tip_amount: tipAmount.value ? Number(tipAmount.value) : null,
    p_guest_token: guestToken,
  });

  submitButton.disabled = false;
  submitButton.textContent = t(requestType === 'karaoke' ? 'guest.submit.karaoke' : 'guest.submit.song');

  if (error || !data?.length) {
    console.error(error);
    showNotice(error?.message || t('notice.couldNotSubmit'), 'error');
    return;
  }

  currentRequest = { id: data[0].request_id, artist, song, request_type: requestType };
  localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
  form.reset();
  messageCount.textContent = '0';
  tipAmount.value = '';
  document.querySelectorAll('[data-tip]').forEach(item => item.classList.remove('active'));
  showNotice(t(requestType === 'karaoke' ? 'notice.karaokeSent' : 'notice.requestSent'), 'success');
  await refreshStatus();
  subscribeToRequestUpdates();
  startPolling();
});

async function refreshStatus() {
  if (!currentRequest) return;
  const { data, error } = await supabase.rpc('get_request_status_v2', {
    p_request_id: currentRequest.id,
    p_guest_token: guestToken,
  });
  if (error || !data?.length) return;

  const row = data[0];
  currentRequest = { ...currentRequest, ...row };
  localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
  renderCurrentStatus();

  if (row.request_type === 'karaoke' && row.status === 'playing' && readyAnnouncementVersion !== row.updated_at) {
    readyAnnouncementVersion = row.updated_at;
    announceKaraokeReady(row);
  }

  if (['played', 'rejected'].includes(row.status)) {
    stopPolling();
  }
}

function renderCurrentStatus() {
  if (!currentRequest?.status) return;
  const type = currentRequest.request_type || 'song';
  statusSong.textContent = `${currentRequest.artist} — ${currentRequest.song}`;
  statusBadge.textContent = type === 'karaoke' ? t(`status.karaoke.${currentRequest.status}Label`) : t(`status.${currentRequest.status}`);
  statusBadge.className = `status-pill ${currentRequest.status}`;
  statusText.textContent = t(`status.${type}.${currentRequest.status}`);
  statusPanel.classList.remove('hidden');
  cantFindHelp.classList.toggle('hidden', currentRequest.status !== 'cant_find');
  enableAlertsButton.classList.toggle('hidden', type !== 'karaoke' || !('Notification' in window) || Notification.permission === 'granted');
}

function restoreLastRequest() {
  const raw = localStorage.getItem(`dropmysong_last_${eventSlug}`);
  if (!raw) return;
  try {
    currentRequest = JSON.parse(raw);
    refreshStatus();
    subscribeToRequestUpdates();
    startPolling();
  } catch {
    localStorage.removeItem(`dropmysong_last_${eventSlug}`);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshStatus, 10000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function requestChannelName() {
  if (!currentRequest?.id) return null;
  return `dropmysong-request-${currentRequest.id}-${guestToken}`;
}

function subscribeToRequestUpdates() {
  teardownRequestRealtime();
  const channelName = requestChannelName();
  if (!channelName) return;

  requestRealtime = supabase
    .channel(channelName)
    .on('broadcast', { event: 'status-update' }, payload => {
      if (!payload?.payload || payload.payload.request_id !== currentRequest?.id) return;
      refreshStatus();
    })
    .subscribe(status => {
      liveIndicator.classList.toggle('online', status === 'SUBSCRIBED');
    });
}

function teardownRequestRealtime() {
  if (requestRealtime) supabase.removeChannel(requestRealtime);
  requestRealtime = null;
  liveIndicator.classList.remove('online');
}

saveHelpLink.addEventListener('click', async () => {
  const url = helpSongUrl.value.trim();
  if (!currentRequest || !isHttpUrl(url) || !url) {
    showNotice(t('notice.linkRequired'), 'error');
    return;
  }
  saveHelpLink.disabled = true;
  const { error } = await supabase.rpc('add_request_link', {
    p_request_id: currentRequest.id,
    p_guest_token: guestToken,
    p_song_url: url,
  });
  saveHelpLink.disabled = false;
  if (error) {
    showNotice(error.message || t('notice.couldNotSubmit'), 'error');
    return;
  }
  helpSongUrl.value = '';
  showNotice(t('notice.linkSaved'), 'success');
  await refreshStatus();
});

enableAlertsButton.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    enableAlertsButton.classList.add('hidden');
    showNotice(t('guest.alertsEnabled'), 'success');
  } else {
    showNotice(t('notice.notificationDenied'));
  }
});

readyAcknowledge.addEventListener('click', () => karaokeReadyAlert.classList.add('hidden'));

function primeAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch {
    audioContext = null;
  }
}

function playReadySound() {
  if (!audioContext) return;
  try {
    const start = audioContext.currentTime;
    [0, 0.22, 0.44].forEach((offset, index) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = index === 2 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.18);
    });
  } catch {
    // Visual alert remains available if audio is blocked.
  }
}

async function announceKaraokeReady(row) {
  karaokeReadySong.textContent = `${row.artist} — ${row.song}`;
  karaokeReadyAlert.classList.remove('hidden');
  playReadySound();
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (registration) {
        await registration.showNotification(t('guest.karaokeReadyTitle'), {
          body: `${row.artist} — ${row.song}. ${t('guest.karaokeReadyBody')}`,
          icon: './assets/icon-192.png',
          badge: './assets/icon-192.png',
          tag: `karaoke-${currentRequest.id}`,
          renotify: true,
        });
      } else {
        new Notification(t('guest.karaokeReadyTitle'), { body: `${row.artist} — ${row.song}` });
      }
    } catch {
      // In-app alert, vibration and sound remain available.
    }
  }
}

window.addEventListener('dropmysong:languagechange', () => {
  applyTranslations();
  setRequestType(requestType, false);
  renderEventBanner();
  renderCurrentStatus();
  if (!karaokeReadyAlert.classList.contains('hidden') && currentRequest) {
    karaokeReadySong.textContent = `${currentRequest.artist} — ${currentRequest.song}`;
  }
});

window.addEventListener('beforeunload', () => {
  teardownRequestRealtime();
  stopPolling();
});

loadEvent();
