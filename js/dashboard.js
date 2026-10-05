import { supabase } from './supabaseClient.js';
import { STATUS_LABELS, appBaseUrl, escapeHtml, relativeTime, slugify } from './common.js';

const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const loginForm = document.querySelector('#loginForm');
const loginNotice = document.querySelector('#loginNotice');
const dashboardNotice = document.querySelector('#dashboardNotice');
const logoutButton = document.querySelector('#logoutButton');
const requestList = document.querySelector('#requestList');
const requestSearch = document.querySelector('#requestSearch');
const statusFilter = document.querySelector('#statusFilter');
const requestCount = document.querySelector('#requestCount');
const activeEventName = document.querySelector('#activeEventName');
const requestsToggle = document.querySelector('#requestsToggle');
const tipsToggle = document.querySelector('#tipsToggle');
const nowPlayingTitle = document.querySelector('#nowPlayingTitle');
const nowPlayingArtist = document.querySelector('#nowPlayingArtist');
const nextUpList = document.querySelector('#nextUpList');
const nextUpCount = document.querySelector('#nextUpCount');
const eventLinkBox = document.querySelector('#eventLinkBox');
const copyEventLink = document.querySelector('#copyEventLink');
const playedList = document.querySelector('#playedList');
const playedCount = document.querySelector('#playedCount');
const eventForm = document.querySelector('#eventForm');
const eventsList = document.querySelector('#eventsList');

let session = null;
let events = [];
let activeEvent = null;
let requests = [];
let realtimeChannel = null;

function showLoginNotice(text, type = 'error') {
  loginNotice.textContent = text;
  loginNotice.className = `notice ${type}`;
}
function showDashboardNotice(text, type = '') {
  dashboardNotice.textContent = text;
  dashboardNotice.className = `notice ${type}`;
  setTimeout(() => dashboardNotice.classList.add('hidden'), 3500);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginNotice.classList.add('hidden');
  const email = document.querySelector('#loginEmail').value.trim();
  const password = document.querySelector('#loginPassword').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showLoginNotice(error.message);
  session = data.session;
  await enterDashboard();
});

logoutButton.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

async function enterDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  await loadEvents();
}

async function loadEvents() {
  const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false });
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }
  events = data || [];
  activeEvent = events.find(item => item.is_active) || events[0] || null;
  renderEvents();
  await activateEvent(activeEvent?.id || null);
}

async function activateEvent(eventId) {
  activeEvent = events.find(item => item.id === eventId) || null;
  if (!activeEvent) {
    requests = [];
    activeEventName.textContent = 'No active event';
    requestList.innerHTML = '<div class="empty-state">Create an event to start receiving requests.</div>';
    renderSideRail();
    eventLinkBox.textContent = 'Create or select an event.';
    requestsToggle.checked = false;
    tipsToggle.checked = false;
    teardownRealtime();
    return;
  }

  activeEventName.textContent = activeEvent.name;
  requestsToggle.checked = !!activeEvent.requests_enabled;
  tipsToggle.checked = !!activeEvent.tips_enabled;
  const url = `${appBaseUrl()}index.html?event=${encodeURIComponent(activeEvent.slug)}`;
  eventLinkBox.textContent = url;
  await loadRequests();
  subscribeToRequests();
}

async function loadRequests() {
  if (!activeEvent) return;
  const { data, error } = await supabase
    .from('song_requests')
    .select('*')
    .eq('event_id', activeEvent.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }
  requests = data || [];
  renderAll();
}

function subscribeToRequests() {
  teardownRealtime();
  if (!activeEvent) return;
  realtimeChannel = supabase
    .channel(`requests-${activeEvent.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'song_requests', filter: `event_id=eq.${activeEvent.id}` }, () => loadRequests())
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function renderAll() {
  renderRequests();
  renderSideRail();
  renderPlayed();
}

function filteredRequests() {
  const q = requestSearch.value.trim().toLowerCase();
  const filter = statusFilter.value;
  const activeStatuses = new Set(['pending', 'accepted', 'playing', 'cant_find']);
  return requests.filter(row => {
    const statusOk = filter === 'all' || (filter === 'active' ? activeStatuses.has(row.status) : row.status === filter);
    const haystack = `${row.artist} ${row.song} ${row.requester_name || ''}`.toLowerCase();
    return statusOk && (!q || haystack.includes(q));
  });
}

function renderRequests() {
  const list = filteredRequests();
  requestCount.textContent = requests.filter(r => ['pending', 'accepted', 'playing', 'cant_find'].includes(r.status)).length;
  if (!list.length) {
    requestList.innerHTML = '<div class="empty-state">No requests match this view.</div>';
    return;
  }
  requestList.innerHTML = list.map((row, index) => requestCard(row, index)).join('');
  requestList.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => updateStatus(button.dataset.id, button.dataset.action));
  });
}

function requestCard(row, index) {
  const duplicateCount = requests.filter(other => other.id !== row.id && other.status !== 'rejected' && `${other.artist}`.trim().toLowerCase() === `${row.artist}`.trim().toLowerCase() && `${other.song}`.trim().toLowerCase() === `${row.song}`.trim().toLowerCase()).length;
  const link = row.song_url ? `<a class="request-link" href="${escapeHtml(row.song_url)}" target="_blank" rel="noopener">Open song link ↗</a>` : '';
  const tip = row.tip_amount ? ` · Tip selected: $${Number(row.tip_amount).toFixed(0)}` : '';
  const duplicate = duplicateCount ? ` · 🔥 ${duplicateCount + 1} requests` : '';

  let actions = '';
  if (row.status === 'pending' || row.status === 'cant_find') {
    actions = `
      <div class="request-actions">
        <button class="action-button primary" data-action="accepted" data-id="${row.id}">Accept</button>
        <button class="action-button danger" data-action="rejected" data-id="${row.id}">Reject</button>
        <button class="action-button" data-action="cant_find" data-id="${row.id}">Can't Find</button>
      </div>`;
  } else if (row.status === 'accepted') {
    actions = `
      <div class="request-actions two">
        <button class="action-button primary" data-action="playing" data-id="${row.id}">▶ Playing</button>
        <button class="action-button success" data-action="played" data-id="${row.id}">✓ Played</button>
      </div>`;
  } else if (row.status === 'playing') {
    actions = `
      <div class="request-actions two">
        <button class="action-button success" data-action="played" data-id="${row.id}">✓ Played</button>
        <button class="action-button" data-action="accepted" data-id="${row.id}">Back to Queue</button>
      </div>`;
  }

  return `
    <article class="request-card ${index === 0 ? 'highlight' : ''}">
      <div class="request-card-head">
        <div>
          <span class="status-pill ${row.status}">${escapeHtml(STATUS_LABELS[row.status] || row.status)}</span>
          <h3>${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</h3>
          <div class="request-meta">${escapeHtml(relativeTime(row.created_at))}${row.requester_name ? ` · ${escapeHtml(row.requester_name)}` : ''}${tip}${duplicate}</div>
        </div>
        ${link}
      </div>
      ${row.message ? `<p class="request-note">${escapeHtml(row.message)}</p>` : ''}
      ${actions}
    </article>`;
}

async function updateStatus(id, status) {
  const payload = { status, updated_at: new Date().toISOString() };
  if (status === 'played') payload.played_at = new Date().toISOString();
  const { error } = await supabase.from('song_requests').update(payload).eq('id', id);
  if (error) showDashboardNotice(error.message, 'error');
  else await loadRequests();
}

function renderSideRail() {
  const playing = requests.find(row => row.status === 'playing');
  nowPlayingTitle.textContent = playing?.song || 'Nothing yet';
  nowPlayingArtist.textContent = playing?.artist || 'Mark an accepted request as Playing.';

  const next = requests.filter(row => row.status === 'accepted').slice(0, 8);
  nextUpCount.textContent = next.length;
  nextUpList.innerHTML = next.length ? next.map((row, index) => `
    <div class="mini-item"><strong>${index + 1}. ${escapeHtml(row.song)}</strong><span class="muted">${escapeHtml(row.artist)}</span></div>
  `).join('') : '<div class="empty-state">No accepted requests yet.</div>';
}

function renderPlayed() {
  const played = requests.filter(row => row.status === 'played').sort((a, b) => new Date(b.played_at || b.updated_at) - new Date(a.played_at || a.updated_at));
  playedCount.textContent = played.length;
  playedList.innerHTML = played.length ? played.map(row => `
    <div class="played-item"><strong>✓ ${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</strong><span class="muted">${escapeHtml(row.requester_name || 'Guest')}</span></div>
  `).join('') : '<div class="empty-state">Nothing has been marked played yet.</div>';
}

requestSearch.addEventListener('input', renderRequests);
statusFilter.addEventListener('change', renderRequests);

requestsToggle.addEventListener('change', () => updateEventSetting('requests_enabled', requestsToggle.checked));
tipsToggle.addEventListener('change', () => updateEventSetting('tips_enabled', tipsToggle.checked));

async function updateEventSetting(field, value) {
  if (!activeEvent) return;
  const { error } = await supabase.from('events').update({ [field]: value }).eq('id', activeEvent.id);
  if (error) {
    showDashboardNotice(error.message, 'error');
    if (field === 'requests_enabled') requestsToggle.checked = !value;
    if (field === 'tips_enabled') tipsToggle.checked = !value;
    return;
  }
  activeEvent[field] = value;
  events = events.map(item => item.id === activeEvent.id ? { ...item, [field]: value } : item);
  showDashboardNotice(`${field === 'requests_enabled' ? 'Requests' : 'Tips'} ${value ? 'enabled' : 'disabled'}.`, 'success');
}

copyEventLink.addEventListener('click', async () => {
  if (!activeEvent) return;
  const text = eventLinkBox.textContent;
  await navigator.clipboard.writeText(text);
  showDashboardNotice('Guest request link copied.', 'success');
});

eventForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.querySelector('#eventName').value.trim();
  const eventDate = document.querySelector('#eventDate').value || null;
  const requestedSlug = document.querySelector('#eventSlug').value.trim();
  const slug = slugify(requestedSlug || name);
  if (!name || !slug) return;

  const { data: authData } = await supabase.auth.getUser();
  const ownerId = authData.user?.id;
  if (!ownerId) return showDashboardNotice('You must be signed in.', 'error');

  const { error } = await supabase.from('events').insert({
    owner_id: ownerId,
    name,
    slug,
    event_date: eventDate,
    requests_enabled: true,
    tips_enabled: false,
    is_active: events.length === 0,
  });
  if (error) return showDashboardNotice(error.message, 'error');
  eventForm.reset();
  showDashboardNotice('Event created.', 'success');
  await loadEvents();
});

function renderEvents() {
  if (!events.length) {
    eventsList.innerHTML = '<div class="empty-state">No events yet.</div>';
    return;
  }
  eventsList.innerHTML = events.map(event => `
    <div class="event-item">
      <div>
        <strong>${escapeHtml(event.name)} ${event.is_active ? '🟢' : ''}</strong>
        <small>${event.event_date ? escapeHtml(new Date(event.event_date + 'T00:00:00').toLocaleDateString()) : 'No date'} · /?event=${escapeHtml(event.slug)}</small>
      </div>
      <div class="event-actions">
        <button class="secondary-button" data-select-event="${event.id}">Open</button>
        ${event.is_active ? '' : `<button class="ghost-button" data-activate-event="${event.id}">Make Active</button>`}
      </div>
    </div>`).join('');

  eventsList.querySelectorAll('[data-select-event]').forEach(button => button.addEventListener('click', () => activateEvent(button.dataset.selectEvent)));
  eventsList.querySelectorAll('[data-activate-event]').forEach(button => button.addEventListener('click', () => makeEventActive(button.dataset.activateEvent)));
}

async function makeEventActive(id) {
  const { error: clearError } = await supabase.from('events').update({ is_active: false }).neq('id', id);
  if (clearError) return showDashboardNotice(clearError.message, 'error');
  const { error } = await supabase.from('events').update({ is_active: true }).eq('id', id);
  if (error) return showDashboardNotice(error.message, 'error');
  await loadEvents();
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
    document.querySelector(`#${button.dataset.tab}Tab`).classList.remove('hidden');
  });
});

const { data: sessionData } = await supabase.auth.getSession();
session = sessionData.session;
if (session) await enterDashboard();
