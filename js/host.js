import { supabase } from './supabaseClient.js';
import { buildGuestUrl, escapeHtml, relativeTime } from './common.js';
import { applyTranslations, getLanguage, initI18n, t } from './i18n.js';

const loginView = document.querySelector('#hostLoginView');
const dashboardView = document.querySelector('#hostDashboardView');
const loginForm = document.querySelector('#hostLoginForm');
const loginEmail = document.querySelector('#hostLoginEmail');
const loginPassword = document.querySelector('#hostLoginPassword');
const createAccountButton = document.querySelector('#hostCreateAccount');
const loginNotice = document.querySelector('#hostLoginNotice');
const hostNotice = document.querySelector('#hostNotice');
const logoutButton = document.querySelector('#hostLogout');
const enableAlertsButton = document.querySelector('#hostEnableAlerts');
const identity = document.querySelector('#hostIdentity');
const eventSelect = document.querySelector('#hostEventSelect');
const eventName = document.querySelector('#hostEventName');
const readyList = document.querySelector('#hostReadyList');
const queueList = document.querySelector('#hostQueueList');
const readyCount = document.querySelector('#hostReadyCount');
const queueCount = document.querySelector('#hostQueueCount');
const songRequestLink = document.querySelector('#hostSongRequestLink');
const karaokeRequestLink = document.querySelector('#hostKaraokeRequestLink');

let session = null;
let assignments = [];
let activeAssignment = null;
let requests = [];
let hostCalls = new Map();
let realtimeChannel = null;
let announcedReady = new Set();
let noticeTimer = null;
let audioContext = null;

initI18n();

function showLoginNotice(message, type = 'error') {
  loginNotice.textContent = message;
  loginNotice.className = `notice ${type}`;
}

function showHostNotice(message, type = '') {
  if (noticeTimer) clearTimeout(noticeTimer);
  hostNotice.textContent = message;
  hostNotice.className = `notice ${type}`.trim();
  hostNotice.classList.remove('hidden');
  noticeTimer = setTimeout(() => hostNotice.classList.add('hidden'), 3500);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginNotice.classList.add('hidden');
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showLoginNotice(error.message);
  session = data.session;
  await enterHostDashboard();
});

createAccountButton.addEventListener('click', async () => {
  loginNotice.classList.add('hidden');
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || password.length < 6) {
    return showLoginNotice(t('host.accountFieldsRequired'));
  }
  createAccountButton.disabled = true;
  const { data, error } = await supabase.auth.signUp({ email, password });
  createAccountButton.disabled = false;
  if (error) return showLoginNotice(error.message);
  if (data.session) {
    session = data.session;
    await enterHostDashboard();
  } else {
    showLoginNotice(t('host.checkEmail'), 'success');
  }
});

logoutButton.addEventListener('click', async () => {
  teardownRealtime();
  await supabase.auth.signOut();
  location.reload();
});

async function enterHostDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  identity.textContent = session?.user?.email || '';
  await loadAssignments();
}

async function loadAssignments() {
  const { data, error } = await supabase
    .from('event_hosts')
    .select('id,event_id,host_email,display_name,event_name,event_slug,created_at')
    .order('created_at', { ascending: false });

  if (error) {
    eventName.textContent = t('host.setupRequired');
    readyList.innerHTML = `<div class="empty-state">${escapeHtml(t('host.setupRequired'))}</div>`;
    queueList.innerHTML = '';
    return;
  }

  assignments = data || [];
  if (!assignments.length) {
    activeAssignment = null;
    eventSelect.innerHTML = '';
    eventName.textContent = t('host.noEvent');
    readyList.innerHTML = `<div class="empty-state">${escapeHtml(t('host.notAssigned'))}</div>`;
    queueList.innerHTML = `<div class="empty-state">${escapeHtml(t('host.notAssigned'))}</div>`;
    readyCount.textContent = '0';
    queueCount.textContent = '0';
    songRequestLink.removeAttribute('href');
    karaokeRequestLink.removeAttribute('href');
    teardownRealtime();
    return;
  }

  eventSelect.innerHTML = assignments
    .map(item => `<option value="${item.id}">${escapeHtml(item.event_name)}</option>`)
    .join('');

  const previous = activeAssignment?.id;
  activeAssignment = assignments.find(item => item.id === previous) || assignments[0];
  eventSelect.value = activeAssignment.id;
  await activateAssignment(activeAssignment.id);
}

eventSelect.addEventListener('change', () => activateAssignment(eventSelect.value));

async function activateAssignment(assignmentId) {
  activeAssignment = assignments.find(item => item.id === assignmentId) || null;
  if (!activeAssignment) return;
  eventName.textContent = activeAssignment.event_name;
  songRequestLink.href = buildGuestUrl(activeAssignment.event_slug, 'song');
  karaokeRequestLink.href = buildGuestUrl(activeAssignment.event_slug, 'karaoke');
  await Promise.all([loadRequests(), loadHostCalls()]);
  seedReadyAnnouncements();
  subscribeRealtime();
}

async function loadRequests() {
  if (!activeAssignment) return;
  const { data, error } = await supabase
    .from('song_requests')
    .select('id,event_id,request_type,artist,song,requester_name,status,sort_order,created_at,updated_at')
    .eq('event_id', activeAssignment.event_id)
    .in('status', ['pending', 'accepted', 'playing', 'cant_find'])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    showHostNotice(error.message, 'error');
    return;
  }
  requests = data || [];
  renderHostQueues();
}

async function loadHostCalls() {
  if (!activeAssignment) return;
  const { data } = await supabase
    .from('host_calls')
    .select('request_id,called_at,host_email')
    .eq('event_id', activeAssignment.event_id);

  hostCalls = new Map((data || []).map(row => [row.request_id, row]));
  renderHostQueues();
}

function renderHostQueues() {
  if (!activeAssignment) return;
  const ready = requests.filter(row => row.status === 'playing');
  const upcoming = requests.filter(row => ['accepted', 'pending', 'cant_find'].includes(row.status));

  readyCount.textContent = ready.length;
  queueCount.textContent = upcoming.length;

  readyList.innerHTML = ready.length
    ? ready.map(renderReadyCard).join('')
    : `<div class="empty-state">${escapeHtml(t('host.noneReady'))}</div>`;

  queueList.innerHTML = upcoming.length
    ? upcoming.map(renderQueueCard).join('')
    : `<div class="empty-state">${escapeHtml(t('host.queueEmpty'))}</div>`;

  readyList.querySelectorAll('[data-host-call]').forEach(button => {
    button.addEventListener('click', () => markCalled(button.dataset.hostCall));
  });
}

function requesterLabel(row) {
  return row.requester_name?.trim() || t('host.nameMissing');
}

function typeLabel(row) {
  return row.request_type === 'karaoke' ? t('host.karaoke') : t('host.song');
}

function renderReadyCard(row) {
  const call = hostCalls.get(row.id);
  return `
    <article class="host-call-card ready">
      <div class="host-call-top">
        <span class="host-type-badge">${escapeHtml(typeLabel(row))}</span>
        ${call ? `<span class="host-called-badge">✓ ${escapeHtml(t('host.called'))}</span>` : ''}
      </div>
      <h3>${escapeHtml(requesterLabel(row))}</h3>
      <p class="host-song-line">${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</p>
      <p class="muted">${escapeHtml(t('host.readySince'))} ${escapeHtml(relativeTime(row.updated_at || row.created_at, getLanguage()))}</p>
      ${call
        ? `<p class="muted">${escapeHtml(t('host.calledBy', { email: call.host_email }))}</p>`
        : `<button class="primary-button host-called-button" type="button" data-host-call="${row.id}">${escapeHtml(t('host.markCalled'))}</button>`}
    </article>`;
}

function renderQueueCard(row) {
  const statusText = row.status === 'accepted'
    ? t('status.accepted')
    : row.status === 'cant_find'
      ? t('status.cant_find')
      : t('status.pending');
  return `
    <article class="host-call-card">
      <div class="host-call-top">
        <span class="host-type-badge">${escapeHtml(typeLabel(row))}</span>
        <span class="status-pill ${row.status}">${escapeHtml(statusText)}</span>
      </div>
      <h3>${escapeHtml(requesterLabel(row))}</h3>
      <p class="host-song-line">${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</p>
    </article>`;
}

async function markCalled(requestId) {
  if (!activeAssignment || !session?.user?.email) return;
  const payload = {
    request_id: requestId,
    event_id: activeAssignment.event_id,
    host_email: session.user.email.toLowerCase(),
  };
  const { error } = await supabase.from('host_calls').insert(payload);
  if (error && error.code !== '23505') {
    showHostNotice(error.message, 'error');
    return;
  }
  await loadHostCalls();
  showHostNotice(t('host.calledSaved'), 'success');
}

function seedReadyAnnouncements() {
  announcedReady = new Set(requests.filter(row => row.status === 'playing').map(row => row.id));
}

function subscribeRealtime() {
  teardownRealtime();
  if (!activeAssignment) return;

  realtimeChannel = supabase
    .channel(`dropmysong-host-${activeAssignment.event_id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'song_requests',
      filter: `event_id=eq.${activeAssignment.event_id}`,
    }, async payload => {
      const row = payload.new;
      if (row?.status === 'playing' && !announcedReady.has(row.id)) {
        announcedReady.add(row.id);
        announceReady(row);
      }
      await loadRequests();
    })
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

enableAlertsButton.addEventListener('click', async () => {
  primeAudio();
  if (!('Notification' in window)) {
    return showHostNotice(t('host.alertsUnsupported'), 'error');
  }
  const permission = await Notification.requestPermission();
  showHostNotice(permission === 'granted' ? t('host.alertsEnabled') : t('notice.notificationDenied'), permission === 'granted' ? 'success' : 'error');
});

function primeAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch {
    audioContext = null;
  }
}

function playHostAlert() {
  if (!audioContext) return;
  try {
    const start = audioContext.currentTime;
    [0, .18].forEach((offset, index) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = index ? 880 : 660;
      gain.gain.setValueAtTime(.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(.15, start + offset + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .14);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(start + offset);
      osc.stop(start + offset + .16);
    });
  } catch {}
}

async function announceReady(row) {
  playHostAlert();
  if (navigator.vibrate) navigator.vibrate([250, 100, 450]);
  showHostNotice(t('host.callPersonNow', { name: requesterLabel(row) }), 'success');

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const registration = await navigator.serviceWorker?.ready;
      const title = t('host.callPersonNow', { name: requesterLabel(row) });
      const body = `${row.artist} — ${row.song}`;
      if (registration) {
        await registration.showNotification(title, {
          body,
          icon: './assets/icon-192.png',
          badge: './assets/icon-192.png',
          tag: `host-ready-${row.id}`,
          renotify: true,
        });
      } else {
        new Notification(title, { body });
      }
    } catch {}
  }
}

window.addEventListener('dropmysong:languagechange', () => {
  applyTranslations();
  if (activeAssignment) {
    eventName.textContent = activeAssignment.event_name;
    renderHostQueues();
  }
});

window.addEventListener('beforeunload', teardownRealtime);

const { data: sessionData } = await supabase.auth.getSession();
session = sessionData.session;
if (session) await enterHostDashboard();
