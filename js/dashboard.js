import { supabase } from './supabaseClient.js';
import { ETRANSFER_EMAIL } from './config.js';
import { appBaseUrl, buildGuestUrl, escapeHtml, relativeTime, slugify } from './common.js';
import { applyTranslations, getLanguage, initI18n, t } from './i18n.js';
import { hydrateLinkPreviews } from './linkPreview.js';

const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const loginForm = document.querySelector('#loginForm');
const loginNotice = document.querySelector('#loginNotice');
const dashboardNotice = document.querySelector('#dashboardNotice');
const logoutButton = document.querySelector('#logoutButton');
const dashboardTitle = document.querySelector('#dashboardTitle');
const requestList = document.querySelector('#requestList');
const requestSearch = document.querySelector('#requestSearch');
const statusFilter = document.querySelector('#statusFilter');
const karaokeList = document.querySelector('#karaokeList');
const karaokeSearch = document.querySelector('#karaokeSearch');
const karaokeStatusFilter = document.querySelector('#karaokeStatusFilter');
const requestCount = document.querySelector('#requestCount');
const activeEventName = document.querySelector('#activeEventName');
const requestsToggle = document.querySelector('#requestsToggle');
const karaokeToggle = document.querySelector('#karaokeToggle');
const tipsToggle = document.querySelector('#tipsToggle');
const nowPlayingTitle = document.querySelector('#nowPlayingTitle');
const nowPlayingArtist = document.querySelector('#nowPlayingArtist');
const nextUpList = document.querySelector('#nextUpList');
const nextUpCount = document.querySelector('#nextUpCount');
const karaokeReadyList = document.querySelector('#karaokeReadyList');
const karaokeNextList = document.querySelector('#karaokeNextList');
const karaokeNextCount = document.querySelector('#karaokeNextCount');
const eventLinkBox = document.querySelector('#eventLinkBox');
const karaokeLinkBox = document.querySelector('#karaokeLinkBox');
const copyEventLink = document.querySelector('#copyEventLink');
const copyKaraokeLink = document.querySelector('#copyKaraokeLink');
const songQr = document.querySelector('#songQr');
const karaokeQr = document.querySelector('#karaokeQr');
const playedList = document.querySelector('#playedList');
const playedCount = document.querySelector('#playedCount');
const karaokePlayedList = document.querySelector('#karaokePlayedList');
const karaokePlayedCount = document.querySelector('#karaokePlayedCount');
const eventForm = document.querySelector('#eventForm');
const eventsList = document.querySelector('#eventsList');
const paymentSettingsForm = document.querySelector('#paymentSettingsForm');
const paymentSettingsEventName = document.querySelector('#paymentSettingsEventName');
const requireTipSetting = document.querySelector('#requireTipSetting');
const tipOptionInputs = [...document.querySelectorAll('.tip-option-input')];
const paypalConfiguredValue = document.querySelector('#paypalConfiguredValue');
const etransferConfiguredValue = document.querySelector('#etransferConfiguredValue');
const hostAccessEventName = document.querySelector('#hostAccessEventName');
const generateHostQr = document.querySelector('#generateHostQr');
const regenerateHostQr = document.querySelector('#regenerateHostQr');
const copyHostInviteLink = document.querySelector('#copyHostInviteLink');
const hostInviteQrWrap = document.querySelector('#hostInviteQrWrap');
const hostInviteQr = document.querySelector('#hostInviteQr');
const hostInviteLink = document.querySelector('#hostInviteLink');
const qrModal = document.querySelector('#qrModal');
const closeQrModal = document.querySelector('#closeQrModal');
const qrModalEventName = document.querySelector('#qrModalEventName');
const qrModalCode = document.querySelector('#qrModalCode');
const qrModalLink = document.querySelector('#qrModalLink');
const qrInactiveWarning = document.querySelector('#qrInactiveWarning');
const copyQrModalLink = document.querySelector('#copyQrModalLink');
const analyticsEventSelect = document.querySelector('#analyticsEventSelect');
const exportAnalyticsCsv = document.querySelector('#exportAnalyticsCsv');
const analyticsEmpty = document.querySelector('#analyticsEmpty');
const analyticsContent = document.querySelector('#analyticsContent');
const analyticsTotalRequests = document.querySelector('#analyticsTotalRequests');
const analyticsTotalBreakdown = document.querySelector('#analyticsTotalBreakdown');
const analyticsPlayed = document.querySelector('#analyticsPlayed');
const analyticsCompletionRate = document.querySelector('#analyticsCompletionRate');
const analyticsConfirmedTips = document.querySelector('#analyticsConfirmedTips');
const analyticsPendingTips = document.querySelector('#analyticsPendingTips');
const analyticsRejected = document.querySelector('#analyticsRejected');
const analyticsRejectedBreakdown = document.querySelector('#analyticsRejectedBreakdown');
const analyticsTrackCount = document.querySelector('#analyticsTrackCount');
const analyticsTopTracks = document.querySelector('#analyticsTopTracks');
const analyticsArtistCount = document.querySelector('#analyticsArtistCount');
const analyticsTopArtists = document.querySelector('#analyticsTopArtists');
const analyticsStatusMix = document.querySelector('#analyticsStatusMix');
const analyticsRecentPlayed = document.querySelector('#analyticsRecentPlayed');
const archivedEventCount = document.querySelector('#archivedEventCount');
const archivedEventsList = document.querySelector('#archivedEventsList');

let session = null;
let events = [];
let activeEvent = null;
let requests = [];
let realtimeChannel = null;
let currentTab = 'queue';
let modalEvent = null;
let noticeTimer = null;
let hostInviteUrl = '';
let hostInviteEventId = null;
let queueReorderInProgress = false;
let analyticsEventId = null;
let analyticsRows = [];
let archiveSupported = true;

initI18n();

function showLoginNotice(text, type = 'error') {
  loginNotice.textContent = text;
  loginNotice.className = `notice ${type}`;
}

function showDashboardNotice(text, type = '') {
  if (noticeTimer) clearTimeout(noticeTimer);
  dashboardNotice.textContent = text;
  dashboardNotice.className = `notice ${type}`.trim();
  dashboardNotice.classList.remove('hidden');
  noticeTimer = setTimeout(() => dashboardNotice.classList.add('hidden'), 3500);
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
  setTab(currentTab);
}

async function loadEvents(preferredEventId = null) {
  const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false });
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }
  events = data || [];
  archiveSupported = !events.length || Object.prototype.hasOwnProperty.call(events[0], 'archived_at');

  const availableEvents = events.filter(item => !item.archived_at);
  const preferred = preferredEventId ? availableEvents.find(item => item.id === preferredEventId) : null;
  const target = preferred
    || availableEvents.find(item => item.id === activeEvent?.id)
    || availableEvents.find(item => item.is_active)
    || availableEvents[0]
    || null;

  renderEvents();
  renderAnalyticsEventOptions();
  renderArchivedEvents();
  await activateEvent(target?.id || null);
}

async function activateEvent(eventId) {
  activeEvent = events.find(item => item.id === eventId) || null;
  renderEvents();

  if (!activeEvent) {
    requests = [];
    activeEventName.textContent = t('dashboard.noActiveEvent');
    requestList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.createToStart'))}</div>`;
    karaokeList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.createToStart'))}</div>`;
    eventLinkBox.textContent = t('dashboard.createOrSelect');
    karaokeLinkBox.textContent = t('dashboard.createOrSelect');
    requestsToggle.checked = false;
    karaokeToggle.checked = false;
    tipsToggle.checked = false;
    syncPaymentSettingsForm();
    clearHostInviteQr();
    syncHostAccessPanel();
    teardownRealtime();
    clearQr(songQr);
    clearQr(karaokeQr);
    renderAll();
    return;
  }

  activeEventName.textContent = `${activeEvent.name}${activeEvent.is_active ? '' : ` · ${t('dashboard.inactive')}`}`;
  requestsToggle.checked = !!activeEvent.requests_enabled;
  karaokeToggle.checked = activeEvent.karaoke_enabled !== false;
  tipsToggle.checked = !!activeEvent.tips_enabled;
  syncPaymentSettingsForm();
  clearHostInviteQr();
  syncHostAccessPanel();
  renderEventLinksAndQr();
  await loadRequests();
  subscribeToRequests();
}

async function openEvent(eventId) {
  await activateEvent(eventId);
  setTab('queue');
  showDashboardNotice(t('dashboard.eventOpened'), 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  requests = (data || []).map(row => ({ ...row, request_type: row.request_type || 'song' }));
  if (currentTab === 'analytics' && analyticsEventId === activeEvent.id) {
    analyticsRows = [...requests];
    renderAnalytics();
  }
  renderAll();
}

function subscribeToRequests() {
  teardownRealtime();
  if (!activeEvent) return;
  realtimeChannel = supabase
    .channel(`dropmysong-dashboard-${activeEvent.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'song_requests',
      filter: `event_id=eq.${activeEvent.id}`,
    }, () => {
      if (queueReorderInProgress) {
        return;
      }
      loadRequests();
    })
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function songRequests() {
  return requests.filter(row => row.request_type !== 'karaoke');
}

function karaokeRequests() {
  return requests.filter(row => row.request_type === 'karaoke');
}

function activeCount(rows) {
  return rows.filter(row => ['pending', 'accepted', 'playing', 'cant_find'].includes(row.status)).length;
}

function renderAll() {
  renderSongRequests();
  renderKaraokeRequests();
  renderSongSideRail();
  renderKaraokeSideRail();
  renderHistory();
  updateDashboardHeader();
  if (currentTab === 'analytics') {
    renderAnalyticsEventOptions();
    loadAnalytics(analyticsEventSelect.value || analyticsEventId || activeEvent?.id || events[0]?.id || null);
  }
}

function filterRows(rows, query, filter) {
  const q = query.trim().toLowerCase();
  const activeStatuses = new Set(['pending', 'accepted', 'playing', 'cant_find']);
  return rows.filter(row => {
    const statusOk = filter === 'all' || (filter === 'active' ? activeStatuses.has(row.status) : row.status === filter);
    const haystack = `${row.artist} ${row.song} ${row.requester_name || ''}`.toLowerCase();
    return statusOk && (!q || haystack.includes(q));
  });
}

function renderSongRequests() {
  const rows = songRequests();
  const list = filterRows(rows, requestSearch.value, statusFilter.value);
  if (!list.length) {
    requestList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.noMatches'))}</div>`;
    return;
  }
  const canReorder = !requestSearch.value.trim() && statusFilter.value === 'active';
  requestList.innerHTML = list.map((row, index) => requestCard(row, index, 'song', canReorder)).join('');
  bindRequestActions(requestList, 'song', canReorder);
  hydrateLinkPreviews(requestList, { compact: true, openLabel: t('dashboard.openSongLink') });
}

function renderKaraokeRequests() {
  const rows = karaokeRequests();
  const list = filterRows(rows, karaokeSearch.value, karaokeStatusFilter.value);
  if (!list.length) {
    karaokeList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.noKaraokeMatches'))}</div>`;
    return;
  }
  const canReorder = !karaokeSearch.value.trim() && karaokeStatusFilter.value === 'active';
  karaokeList.innerHTML = list.map((row, index) => requestCard(row, index, 'karaoke', canReorder)).join('');
  bindRequestActions(karaokeList, 'karaoke', canReorder);
  hydrateLinkPreviews(karaokeList, { compact: true, openLabel: t('dashboard.openSongLink') });
}

function bindRequestActions(container, type, canReorder = false) {
  container.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => updateStatus(button.dataset.id, button.dataset.action));
  });
  container.querySelectorAll('[data-confirm-payment]').forEach(button => {
    button.addEventListener('click', () => confirmPayment(button.dataset.confirmPayment));
  });
  container.querySelectorAll('[data-move-request]').forEach(button => {
    button.addEventListener('click', () => moveRequest(button.dataset.id, type, Number(button.dataset.moveRequest)));
  });
  if (canReorder) enableDragReordering(container, type);
}

function requestCard(row, index, type, canReorder = false) {
  const source = type === 'karaoke' ? karaokeRequests() : songRequests();
  const duplicateCount = source.filter(other =>
    other.id !== row.id &&
    other.status !== 'rejected' &&
    `${other.artist}`.trim().toLowerCase() === `${row.artist}`.trim().toLowerCase() &&
    `${other.song}`.trim().toLowerCase() === `${row.song}`.trim().toLowerCase()
  ).length;

  const preview = row.song_url
    ? `<div class="request-media-preview" data-song-preview-url="${escapeHtml(row.song_url)}" data-preview-compact="true" data-preview-title="${escapeHtml(row.song)}" data-preview-subtitle="${escapeHtml(row.artist)}" data-preview-open-label="${escapeHtml(t('dashboard.openSongLink'))}"></div>`
    : '';
  const paymentPending = Number(row.tip_amount || 0) > 0 && row.payment_status === 'pending';
  const paymentConfirmed = Number(row.tip_amount || 0) > 0 && row.payment_status === 'confirmed';
  const methodLabel = row.payment_method === 'etransfer' ? t('dashboard.etransfer') : row.payment_method === 'paypal' ? 'PayPal' : '';
  const personPrefix = type === 'karaoke' ? '🎤 ' : '👤 ';
  const personBadge = row.requester_name
    ? `<span class="request-meta-chip person">${personPrefix}${escapeHtml(row.requester_name)}</span>`
    : '';
  const tipBadge = row.tip_amount
    ? `<span class="request-meta-chip tip">♥ ${Number(row.tip_amount).toFixed(2)}</span>`
    : '';
  const paymentBadge = paymentPending
    ? `<span class="request-meta-chip payment pending">⏳ ${escapeHtml(t('dashboard.paymentPending'))}${methodLabel ? ` · ${escapeHtml(methodLabel)}` : ''}</span>`
    : paymentConfirmed
      ? `<span class="request-meta-chip payment confirmed">✓ ${escapeHtml(t('dashboard.paymentConfirmed'))}</span>`
      : '';
  const duplicateBadge = duplicateCount
    ? `<span class="request-meta-chip duplicate">🔥 ${duplicateCount + 1} ${escapeHtml(t('dashboard.requestsPlural'))}</span>`
    : '';
  const statusLabel = type === 'karaoke'
    ? t(`status.karaoke.${row.status}Label`)
    : t(`status.${row.status}`);

  let actions = '';
  if (paymentPending && ['pending', 'cant_find'].includes(row.status)) {
    actions = `
      <div class="payment-confirmation-box">
        <div>
          <strong>${escapeHtml(t('dashboard.awaitingPayment'))}</strong>
          <p>${escapeHtml(t('dashboard.paymentDetail', { amount: Number(row.tip_amount).toFixed(2), method: methodLabel || t('dashboard.payment') }))}${row.payment_sender_name ? ` · ${escapeHtml(t('dashboard.sender'))}: ${escapeHtml(row.payment_sender_name)}` : ''}</p>
        </div>
        <button class="action-button success" data-confirm-payment="${row.id}">${escapeHtml(t('dashboard.confirmPayment'))}</button>
      </div>
      <div class="request-actions two">
        <button class="action-button danger" data-action="rejected" data-id="${row.id}">${escapeHtml(t('dashboard.reject'))}</button>
        <button class="action-button" data-action="cant_find" data-id="${row.id}">${escapeHtml(t('dashboard.cantFind'))}</button>
      </div>`;
  } else if (row.status === 'pending' || row.status === 'cant_find') {
    actions = `
      <div class="request-actions">
        <button class="action-button primary" data-action="accepted" data-id="${row.id}">${escapeHtml(t('dashboard.accept'))}</button>
        <button class="action-button danger" data-action="rejected" data-id="${row.id}">${escapeHtml(t('dashboard.reject'))}</button>
        <button class="action-button" data-action="cant_find" data-id="${row.id}">${escapeHtml(t('dashboard.cantFind'))}</button>
      </div>`;
  } else if (row.status === 'accepted') {
    actions = type === 'karaoke'
      ? `<div class="request-actions two">
          <button class="action-button primary karaoke-call" data-action="playing" data-id="${row.id}">${escapeHtml(t('dashboard.callSinger'))}</button>
          <button class="action-button success" data-action="played" data-id="${row.id}">${escapeHtml(t('dashboard.completed'))}</button>
        </div>`
      : `<div class="request-actions two">
          <button class="action-button primary" data-action="playing" data-id="${row.id}">${escapeHtml(t('dashboard.playing'))}</button>
          <button class="action-button success" data-action="played" data-id="${row.id}">${escapeHtml(t('dashboard.markPlayed'))}</button>
        </div>`;
  } else if (row.status === 'playing') {
    actions = `
      <div class="request-actions two">
        <button class="action-button success" data-action="played" data-id="${row.id}">${escapeHtml(type === 'karaoke' ? t('dashboard.completed') : t('dashboard.markPlayed'))}</button>
        <button class="action-button" data-action="accepted" data-id="${row.id}">${escapeHtml(t('dashboard.backQueue'))}</button>
      </div>`;
  }

  const reorderTools = canReorder ? `
    <div class="queue-order-tools" title="${escapeHtml(t('dashboard.dragToReorder'))}">
      <span class="drag-handle" aria-hidden="true">⋮⋮</span>
      <button type="button" class="queue-move-button" data-move-request="-1" data-id="${row.id}" aria-label="${escapeHtml(t('dashboard.moveUp'))}">↑</button>
      <button type="button" class="queue-move-button" data-move-request="1" data-id="${row.id}" aria-label="${escapeHtml(t('dashboard.moveDown'))}">↓</button>
    </div>` : '';

  return `
    <article class="request-card ${index === 0 ? 'highlight' : ''} ${type === 'karaoke' ? 'karaoke-card' : ''}" data-request-id="${row.id}" data-request-type="${type}" draggable="${canReorder ? 'true' : 'false'}">
      ${reorderTools}
      <div class="request-card-layout ${preview ? 'has-preview' : ''}">
        ${preview}
        <div class="request-card-body">
          <div class="request-card-head">
            <div class="request-card-title-block">
              <div class="request-card-kicker">
                <span class="request-number">#${index + 1}</span>
                <span class="status-pill ${row.status}">${escapeHtml(statusLabel)}</span>
                <span class="request-time">${escapeHtml(relativeTime(row.created_at, getLanguage()))}</span>
              </div>
              <p class="request-artist">${escapeHtml(row.artist)}</p>
              <h3>${escapeHtml(row.song)}</h3>
              <div class="request-meta">${personBadge}${tipBadge}${paymentBadge}${duplicateBadge}</div>
            </div>
          </div>
          ${row.message ? `<p class="request-note">“${escapeHtml(row.message)}”</p>` : ''}
          ${actions}
        </div>
      </div>
    </article>`;
}

function activeQueueRows(type) {
  const activeStatuses = new Set(['pending', 'accepted', 'playing', 'cant_find']);
  const source = type === 'karaoke' ? karaokeRequests() : songRequests();
  return source.filter(row => activeStatuses.has(row.status));
}

async function saveQueueOrder(type, orderedIds) {
  if (!activeEvent || !orderedIds.length) return;
  queueReorderInProgress = true;
  try {
    for (let index = 0; index < orderedIds.length; index += 1) {
      const { error } = await supabase
        .from('song_requests')
        .update({ sort_order: index + 1 })
        .eq('id', orderedIds[index])
        .eq('event_id', activeEvent.id);
      if (error) throw error;
    }
    showDashboardNotice(t('dashboard.queueOrderSaved'), 'success');
  } catch (error) {
    showDashboardNotice(error?.message || t('dashboard.queueOrderFailed'), 'error');
  } finally {
    queueReorderInProgress = false;
    await loadRequests();
    }
}

async function moveRequest(id, type, direction) {
  const rows = activeQueueRows(type);
  const index = rows.findIndex(row => row.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  await saveQueueOrder(type, rows.map(row => row.id));
}

function enableDragReordering(container, type) {
  let dragged = null;

  container.querySelectorAll('.request-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', event => {
      if (event.target.closest('button, a, input, textarea, select')) {
        event.preventDefault();
        return;
      }
      dragged = card;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.requestId || '');
    });

    card.addEventListener('dragend', async () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.request-card').forEach(item => item.classList.remove('drag-over'));
      if (!dragged) return;
      dragged = null;
      const orderedIds = [...container.querySelectorAll('.request-card[data-request-id]')].map(item => item.dataset.requestId);
      await saveQueueOrder(type, orderedIds);
    });
  });

  container.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault();
    const target = event.target.closest('.request-card[data-request-id]');
    if (!target || target === dragged) return;
    container.querySelectorAll('.request-card').forEach(item => item.classList.remove('drag-over'));
    target.classList.add('drag-over');
    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragged, after ? target.nextSibling : target);
  });
}

async function sendKaraokePush(row) {
  if (!row?.id || (row.request_type || 'song') !== 'karaoke') return;
  try {
    const { error } = await supabase.functions.invoke('karaoke-ready-push', {
      body: { request_id: row.id },
    });
    if (error) throw error;
  } catch (error) {
    console.warn('Drop My Song push notification failed:', error);
    showDashboardNotice(t('dashboard.pushDeliveryFailed'), 'error');
  }
}

async function updateStatus(id, status) {
  const row = requests.find(item => item.id === id);
  if (!row) return;

  if (row.payment_status === 'pending' && ['accepted', 'playing', 'played'].includes(status)) {
    showDashboardNotice(t('dashboard.confirmPaymentFirst'), 'error');
    return;
  }

  const payload = { status, updated_at: new Date().toISOString() };
  if (status === 'played') payload.played_at = new Date().toISOString();
  if (status !== 'played' && row.status === 'played') payload.played_at = null;

  const { error } = await supabase.from('song_requests').update(payload).eq('id', id);
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }

  await broadcastGuestStatus(row, status);
  if ((row.request_type || 'song') === 'karaoke' && status === 'playing') {
    await sendKaraokePush(row);
  }
  await loadRequests();
}

async function confirmPayment(id) {
  const row = requests.find(item => item.id === id);
  if (!row) return;
  const { error } = await supabase.from('song_requests').update({
    payment_status: 'confirmed',
    payment_confirmed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }
  await broadcastPaymentStatus(row, 'confirmed');
  showDashboardNotice(t('dashboard.paymentConfirmedNotice'), 'success');
  await loadRequests();
}

async function broadcastPaymentStatus(row, paymentStatus) {
  if (!row?.guest_token) return;
  const channel = supabase.channel(`dropmysong-request-${row.id}-${row.guest_token}`);
  try {
    await channel.send({
      type: 'broadcast',
      event: 'payment-update',
      payload: { request_id: row.id, payment_status: paymentStatus, updated_at: new Date().toISOString() },
    });
  } catch (error) {
    console.warn('DropMySong payment broadcast failed.', error);
  } finally {
    supabase.removeChannel(channel);
  }
}

async function broadcastGuestStatus(row, status) {
  if (!row?.guest_token) return;
  const channel = supabase.channel(`dropmysong-request-${row.id}-${row.guest_token}`);
  try {
    await channel.send({
      type: 'broadcast',
      event: 'status-update',
      payload: {
        request_id: row.id,
        request_type: row.request_type || 'song',
        status,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn('DropMySong guest broadcast failed; polling will still update the guest.', error);
  } finally {
    supabase.removeChannel(channel);
  }
}

function renderSongSideRail() {
  const rows = songRequests();
  const playing = rows.find(row => row.status === 'playing');
  nowPlayingTitle.textContent = playing?.song || t('dashboard.nothingYet');
  nowPlayingArtist.textContent = playing?.artist || t('dashboard.markPlaying');

  const next = rows.filter(row => row.status === 'accepted').slice(0, 8);
  nextUpCount.textContent = next.length;
  nextUpList.innerHTML = next.length
    ? next.map((row, index) => `<div class="mini-item queue-mini-item"><span class="mini-rank">${index + 1}</span><div><strong>${escapeHtml(row.song)}</strong><span class="muted">${escapeHtml(row.artist)}</span></div></div>`).join('')
    : `<div class="empty-state">${escapeHtml(t('dashboard.noAccepted'))}</div>`;
}

function renderKaraokeSideRail() {
  const rows = karaokeRequests();
  const ready = rows.filter(row => row.status === 'playing');
  karaokeReadyList.innerHTML = ready.length
    ? ready.map(row => `<div class="mini-item karaoke-ready-mini"><strong>🎤 ${escapeHtml(row.requester_name || t('request.singer'))}</strong><span>${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</span></div>`).join('')
    : `<div class="empty-state">${escapeHtml(t('dashboard.noSingerCalled'))}</div>`;

  const next = rows.filter(row => row.status === 'accepted').slice(0, 8);
  karaokeNextCount.textContent = next.length;
  karaokeNextList.innerHTML = next.length
    ? next.map((row, index) => `<div class="mini-item queue-mini-item"><span class="mini-rank">${index + 1}</span><div><strong>${escapeHtml(row.requester_name || t('request.singer'))}</strong><span class="muted">${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</span></div></div>`).join('')
    : `<div class="empty-state">${escapeHtml(t('dashboard.noKaraokeAccepted'))}</div>`;
}

function renderHistory() {
  const songs = songRequests()
    .filter(row => row.status === 'played')
    .sort((a, b) => new Date(b.played_at || b.updated_at) - new Date(a.played_at || a.updated_at));
  const karaoke = karaokeRequests()
    .filter(row => row.status === 'played')
    .sort((a, b) => new Date(b.played_at || b.updated_at) - new Date(a.played_at || a.updated_at));

  playedCount.textContent = songs.length;
  karaokePlayedCount.textContent = karaoke.length;

  playedList.innerHTML = songs.length
    ? songs.map(row => `<div class="played-item"><strong>✓ ${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</strong><span class="muted">${escapeHtml(row.requester_name || t('request.guest'))}</span></div>`).join('')
    : `<div class="empty-state">${escapeHtml(t('dashboard.noPlayed'))}</div>`;

  karaokePlayedList.innerHTML = karaoke.length
    ? karaoke.map(row => `<div class="played-item"><strong>🎤 ${escapeHtml(row.requester_name || t('request.singer'))}</strong><span class="muted">${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</span></div>`).join('')
    : `<div class="empty-state">${escapeHtml(t('dashboard.noKaraokeHistory'))}</div>`;
}

requestSearch.addEventListener('input', renderSongRequests);
statusFilter.addEventListener('change', renderSongRequests);
karaokeSearch.addEventListener('input', renderKaraokeRequests);
karaokeStatusFilter.addEventListener('change', renderKaraokeRequests);

requestsToggle.addEventListener('change', () => updateEventSetting('requests_enabled', requestsToggle.checked, t('dashboard.requests')));
karaokeToggle.addEventListener('change', () => updateEventSetting('karaoke_enabled', karaokeToggle.checked, t('dashboard.karaoke')));
tipsToggle.addEventListener('change', async () => {
  await updateEventSetting('tips_enabled', tipsToggle.checked, t('dashboard.tipsRequired'));
  requireTipSetting.checked = tipsToggle.checked;
});

async function updateEventSetting(field, value, label) {
  if (!activeEvent) return;
  const { error } = await supabase.from('events').update({ [field]: value }).eq('id', activeEvent.id);
  if (error) {
    showDashboardNotice(error.message, 'error');
    if (field === 'requests_enabled') requestsToggle.checked = !value;
    if (field === 'karaoke_enabled') karaokeToggle.checked = !value;
    if (field === 'tips_enabled') tipsToggle.checked = !value;
    return;
  }
  activeEvent[field] = value;
  events = events.map(item => item.id === activeEvent.id ? { ...item, [field]: value } : item);
  if (field === 'tips_enabled') requireTipSetting.checked = value;
  showDashboardNotice(t(value ? 'dashboard.settingEnabled' : 'dashboard.settingDisabled', { name: label }), 'success');
}

function normalizeTipOptions(value) {
  const list = Array.isArray(value) ? value : [2, 5, 10, 20];
  const cleaned = list.map(Number).filter(amount => Number.isFinite(amount) && amount > 0).slice(0, 4);
  while (cleaned.length < 4) cleaned.push([2, 5, 10, 20][cleaned.length]);
  return cleaned;
}

function syncPaymentSettingsForm() {
  const disabled = !activeEvent;
  paymentSettingsForm.querySelectorAll('input,button').forEach(control => { control.disabled = disabled; });
  paymentSettingsEventName.textContent = activeEvent ? activeEvent.name : t('dashboard.selectEventForPayments');
  if (!activeEvent) return;

  requireTipSetting.checked = !!activeEvent.tips_enabled;
  const options = normalizeTipOptions(activeEvent.tip_options);
  tipOptionInputs.forEach((input, index) => { input.value = options[index]; });
  paypalConfiguredValue.textContent = t('dashboard.paypalAutomatic');
  etransferConfiguredValue.textContent = ETRANSFER_EMAIL;
}

paymentSettingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeEvent) return;

  const tipOptions = tipOptionInputs.map(input => Number(input.value)).filter(amount => Number.isFinite(amount) && amount > 0);
  if (tipOptions.length !== 4) {
    showDashboardNotice(t('dashboard.fourTipAmountsRequired'), 'error');
    return;
  }

  const tipsRequired = requireTipSetting.checked;

  const payload = {
    tips_enabled: tipsRequired,
    tip_options: tipOptions,
  };

  const { error } = await supabase.from('events').update(payload).eq('id', activeEvent.id);
  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }

  activeEvent = { ...activeEvent, ...payload };
  events = events.map(item => item.id === activeEvent.id ? { ...item, ...payload } : item);
  tipsToggle.checked = tipsRequired;
  syncPaymentSettingsForm();
  showDashboardNotice(t('dashboard.paymentSettingsSaved'), 'success');
});

function syncHostAccessPanel() {
  const disabled = !activeEvent;
  generateHostQr.disabled = disabled;
  regenerateHostQr.disabled = disabled;
  copyHostInviteLink.disabled = !hostInviteUrl;
  hostAccessEventName.textContent = activeEvent ? activeEvent.name : t('dashboard.selectEventForHost');
}

function clearHostInviteQr() {
  hostInviteUrl = '';
  hostInviteEventId = null;
  hostInviteLink.textContent = '';
  hostInviteQr.innerHTML = '';
  hostInviteQrWrap.classList.add('hidden');
  if (copyHostInviteLink) copyHostInviteLink.disabled = true;
}

function randomHostInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function renderHostInviteQr(url) {
  hostInviteQr.innerHTML = '';
  hostInviteLink.textContent = url;
  hostInviteQrWrap.classList.remove('hidden');
  if (window.QRCode) {
    new window.QRCode(hostInviteQr, {
      text: url,
      width: 180,
      height: 180,
      colorDark: '#05070b',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    hostInviteQr.innerHTML = `<div class="empty-state">${escapeHtml(url)}</div>`;
  }
  copyHostInviteLink.disabled = false;
}

async function createHostQrInvite() {
  if (!activeEvent) {
    showDashboardNotice(t('dashboard.selectEventForHost'), 'error');
    return;
  }

  generateHostQr.disabled = true;
  regenerateHostQr.disabled = true;

  const token = randomHostInviteToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: deleteError } = await supabase
    .from('host_invites')
    .delete()
    .eq('event_id', activeEvent.id);

  if (deleteError) {
    generateHostQr.disabled = false;
    regenerateHostQr.disabled = false;
    showDashboardNotice(deleteError.message || t('dashboard.hostInviteCreateFailed'), 'error');
    return;
  }

  const { error } = await supabase.from('host_invites').insert({
    event_id: activeEvent.id,
    token_hash: tokenHash,
    event_name: activeEvent.name,
    event_slug: activeEvent.slug,
    created_by: session?.user?.id || null,
    expires_at: expiresAt,
  });

  generateHostQr.disabled = false;
  regenerateHostQr.disabled = false;

  if (error) {
    showDashboardNotice(error.message || t('dashboard.hostInviteCreateFailed'), 'error');
    return;
  }

  const url = new URL('host.html', appBaseUrl());
  url.searchParams.set('invite', token);
  hostInviteUrl = url.toString();
  hostInviteEventId = activeEvent.id;
  renderHostInviteQr(hostInviteUrl);
  showDashboardNotice(t('dashboard.hostInviteCreated'), 'success');
}

generateHostQr.addEventListener('click', createHostQrInvite);
regenerateHostQr.addEventListener('click', createHostQrInvite);

copyHostInviteLink.addEventListener('click', async () => {
  if (!hostInviteUrl || hostInviteEventId !== activeEvent?.id) return;
  await copyText(hostInviteUrl);
  showDashboardNotice(t('dashboard.hostInviteLinkCopied'), 'success');
});

copyEventLink.addEventListener('click', async () => {
  if (!activeEvent) return;
  await copyText(eventLinkBox.textContent);
  showDashboardNotice(t('dashboard.linkCopied'), 'success');
});

copyKaraokeLink.addEventListener('click', async () => {
  if (!activeEvent) return;
  await copyText(karaokeLinkBox.textContent);
  showDashboardNotice(t('dashboard.linkCopied'), 'success');
});

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

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

  const { data, error } = await supabase.from('events').insert({
    owner_id: ownerId,
    name,
    slug,
    event_date: eventDate,
    requests_enabled: true,
    karaoke_enabled: true,
    tips_enabled: false,
    is_active: events.filter(item => !item.archived_at).length === 0,
  }).select('id').single();

  if (error) return showDashboardNotice(error.message, 'error');
  eventForm.reset();
  showDashboardNotice(t('dashboard.eventCreated'), 'success');
  await loadEvents(data?.id || null);
  setTab('events');
});

function renderEvents() {
  const visibleEvents = events.filter(event => !event.archived_at);
  if (!visibleEvents.length) {
    eventsList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.createToStart'))}</div>`;
    return;
  }
  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  eventsList.innerHTML = visibleEvents.map(event => `
    <div class="event-item ${activeEvent?.id === event.id ? 'selected' : ''}">
      <div>
        <div class="event-title-line">
          <strong>${escapeHtml(event.name)}</strong>
          <span class="event-state ${event.is_active ? 'active' : ''}">${escapeHtml(t(event.is_active ? 'dashboard.active' : 'dashboard.inactive'))}</span>
        </div>
        <small>${event.event_date ? escapeHtml(new Date(event.event_date + 'T00:00:00').toLocaleDateString(locale)) : escapeHtml(t('dashboard.noDate'))} · /?event=${escapeHtml(event.slug)}</small>
      </div>
      <div class="event-actions">
        <button class="secondary-button" data-select-event="${event.id}">${escapeHtml(t('dashboard.open'))}</button>
        <button class="secondary-button" data-show-qr="${event.id}">${escapeHtml(t('dashboard.qr'))}</button>
        ${event.is_active ? '' : `<button class="ghost-button" data-activate-event="${event.id}">${escapeHtml(t('dashboard.makeActive'))}</button>`}
        ${archiveSupported ? `<button class="ghost-button archive-event-button" data-archive-event="${event.id}">${escapeHtml(t('analytics.archiveEvent'))}</button>` : ''}
      </div>
    </div>`).join('');

  eventsList.querySelectorAll('[data-select-event]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.selectEvent)));
  eventsList.querySelectorAll('[data-show-qr]').forEach(button => button.addEventListener('click', () => openQrModal(button.dataset.showQr)));
  eventsList.querySelectorAll('[data-activate-event]').forEach(button => button.addEventListener('click', () => makeEventActive(button.dataset.activateEvent)));
  eventsList.querySelectorAll('[data-archive-event]').forEach(button => button.addEventListener('click', () => archiveEvent(button.dataset.archiveEvent)));
}

async function archiveEvent(id) {
  if (!archiveSupported) {
    showDashboardNotice(t('analytics.archiveSetupRequired'), 'error');
    return;
  }

  const event = events.find(item => item.id === id);
  if (!event) return;
  if (!window.confirm(t('analytics.archiveConfirm', { name: event.name }))) return;

  const { error } = await supabase.from('events').update({
    archived_at: new Date().toISOString(),
    is_active: false,
    requests_enabled: false,
    karaoke_enabled: false,
  }).eq('id', id);

  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }

  // Revoke any still-valid host QR for an archived event.
  await supabase.from('host_invites').delete().eq('event_id', id);

  showDashboardNotice(t('analytics.eventArchived'), 'success');
  if (analyticsEventId === id) analyticsRows = [];
  await loadEvents();
  if (currentTab === 'analytics') await loadAnalytics();
}

async function restoreArchivedEvent(id) {
  if (!archiveSupported) return;
  const { error } = await supabase.from('events').update({
    archived_at: null,
  }).eq('id', id);

  if (error) {
    showDashboardNotice(error.message, 'error');
    return;
  }

  showDashboardNotice(t('analytics.eventRestored'), 'success');
  await loadEvents(id);
  setTab('events');
}

function renderAnalyticsEventOptions() {
  if (!analyticsEventSelect) return;

  if (!events.length) {
    analyticsEventSelect.innerHTML = '';
    analyticsEventId = null;
    return;
  }

  if (!analyticsEventId || !events.some(event => event.id === analyticsEventId)) {
    analyticsEventId = activeEvent?.id || events.find(event => event.is_active && !event.archived_at)?.id || events[0]?.id || null;
  }

  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  analyticsEventSelect.innerHTML = events.map(event => {
    const date = event.event_date
      ? new Date(event.event_date + 'T00:00:00').toLocaleDateString(locale)
      : t('dashboard.noDate');
    const archived = event.archived_at ? ` · ${t('analytics.archived')}` : '';
    return `<option value="${event.id}">${escapeHtml(event.name)} · ${escapeHtml(date)}${escapeHtml(archived)}</option>`;
  }).join('');

  if (analyticsEventId) analyticsEventSelect.value = analyticsEventId;
}

async function loadAnalytics(eventId = null) {
  if (!analyticsEventSelect) return;

  const targetId = eventId || analyticsEventSelect.value || analyticsEventId || activeEvent?.id || events[0]?.id || null;
  analyticsEventId = targetId;

  if (!targetId) {
    analyticsRows = [];
    renderAnalytics();
    return;
  }

  analyticsEventSelect.value = targetId;
  exportAnalyticsCsv.disabled = true;

  const { data, error } = await supabase
    .from('song_requests')
    .select('id,event_id,request_type,artist,song,requester_name,status,tip_amount,payment_status,created_at,updated_at,played_at')
    .eq('event_id', targetId)
    .order('created_at', { ascending: true });

  exportAnalyticsCsv.disabled = false;

  if (error) {
    analyticsRows = [];
    showDashboardNotice(error.message, 'error');
    renderAnalytics();
    return;
  }

  analyticsRows = (data || []).map(row => ({ ...row, request_type: row.request_type || 'song' }));
  renderAnalytics();
  updateDashboardHeader();
}

function money(amount) {
  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function groupAnalytics(rows, keyFn) {
  const map = new Map();
  rows.forEach(row => {
    const rawKey = keyFn(row);
    if (!rawKey) return;
    const key = rawKey.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.rows.push(row);
    } else {
      map.set(key, { key: rawKey, count: 1, rows: [row] });
    }
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function renderAnalytics() {
  if (!analyticsContent || !analyticsEmpty) return;

  const event = events.find(item => item.id === analyticsEventId) || null;
  analyticsEmpty.classList.toggle('hidden', !!event);
  analyticsContent.classList.toggle('hidden', !event);
  exportAnalyticsCsv.disabled = !event || !analyticsRows.some(row => row.status === 'played');

  if (!event) {
    archivedEventCount.textContent = events.filter(item => item.archived_at).length;
    renderArchivedEvents();
    return;
  }

  const rows = analyticsRows;
  const songs = rows.filter(row => row.request_type !== 'karaoke');
  const karaoke = rows.filter(row => row.request_type === 'karaoke');
  const played = rows.filter(row => row.status === 'played');
  const rejected = rows.filter(row => row.status === 'rejected');
  const cantFind = rows.filter(row => row.status === 'cant_find');
  const confirmedTips = rows
    .filter(row => row.payment_status === 'confirmed')
    .reduce((sum, row) => sum + Number(row.tip_amount || 0), 0);
  const pendingTips = rows
    .filter(row => row.payment_status === 'pending')
    .reduce((sum, row) => sum + Number(row.tip_amount || 0), 0);
  const completion = rows.length ? Math.round((played.length / rows.length) * 100) : 0;

  analyticsTotalRequests.textContent = rows.length;
  analyticsTotalBreakdown.textContent = t('analytics.songKaraokeBreakdown', { songs: songs.length, karaoke: karaoke.length });
  analyticsPlayed.textContent = played.length;
  analyticsCompletionRate.textContent = t('analytics.completionRate', { rate: completion });
  analyticsConfirmedTips.textContent = money(confirmedTips);
  analyticsPendingTips.textContent = t('analytics.pendingTips', { amount: money(pendingTips) });
  analyticsRejected.textContent = rejected.length + cantFind.length;
  analyticsRejectedBreakdown.textContent = t('analytics.rejectedBreakdown', { rejected: rejected.length, cantFind: cantFind.length });

  const tracks = groupAnalytics(rows, row => `${row.artist || ''} — ${row.song || ''}`).slice(0, 6);
  analyticsTrackCount.textContent = new Set(rows.map(row => `${row.artist || ''}|${row.song || ''}`.toLowerCase())).size;
  analyticsTopTracks.innerHTML = tracks.length
    ? tracks.map((item, index) => {
        const row = item.rows[0];
        const type = item.rows.some(track => track.request_type === 'karaoke') && item.rows.some(track => track.request_type !== 'karaoke')
          ? t('analytics.mixed')
          : row.request_type === 'karaoke' ? t('host.karaoke') : t('host.song');
        return `
          <div class="analytics-rank-item">
            <span class="analytics-rank-number">${index + 1}</span>
            <div>
              <strong>${escapeHtml(row.song)}</strong>
              <small>${escapeHtml(row.artist)} · ${escapeHtml(type)}</small>
            </div>
            <span class="analytics-rank-count">×${item.count}</span>
          </div>`;
      }).join('')
    : `<div class="empty-state compact">${escapeHtml(t('analytics.noRequests'))}</div>`;

  const artists = groupAnalytics(rows, row => row.artist || '').slice(0, 6);
  analyticsArtistCount.textContent = new Set(rows.map(row => String(row.artist || '').trim().toLowerCase()).filter(Boolean)).size;
  analyticsTopArtists.innerHTML = artists.length
    ? artists.map((item, index) => `
        <div class="analytics-rank-item">
          <span class="analytics-rank-number">${index + 1}</span>
          <div><strong>${escapeHtml(item.key)}</strong><small>${escapeHtml(t('analytics.requestsCount', { count: item.count }))}</small></div>
          <span class="analytics-rank-count">×${item.count}</span>
        </div>`).join('')
    : `<div class="empty-state compact">${escapeHtml(t('analytics.noRequests'))}</div>`;

  const statuses = ['played', 'playing', 'accepted', 'pending', 'cant_find', 'rejected'];
  analyticsStatusMix.innerHTML = statuses.map(status => {
    const count = rows.filter(row => row.status === status).length;
    const percent = rows.length ? Math.round((count / rows.length) * 100) : 0;
    return `
      <div class="analytics-status-row">
        <div><strong>${escapeHtml(t(`status.${status}`))}</strong><span>${count}</span></div>
        <div class="analytics-status-track"><i class="status-${status}" style="width:${percent}%"></i></div>
      </div>`;
  }).join('');

  const recent = played
    .slice()
    .sort((a, b) => new Date(b.played_at || b.updated_at) - new Date(a.played_at || a.updated_at))
    .slice(0, 8);

  analyticsRecentPlayed.innerHTML = recent.length
    ? recent.map((row, index) => `
        <div class="analytics-rank-item">
          <span class="analytics-rank-number">✓</span>
          <div>
            <strong>${escapeHtml(row.song)}</strong>
            <small>${escapeHtml(row.artist)} · ${escapeHtml(row.request_type === 'karaoke' ? t('host.karaoke') : t('host.song'))}</small>
          </div>
          <span class="analytics-played-time">${escapeHtml(relativeTime(row.played_at || row.updated_at, getLanguage()))}</span>
        </div>`).join('')
    : `<div class="empty-state compact">${escapeHtml(t('analytics.nonePlayed'))}</div>`;

  renderArchivedEvents();
}

function renderArchivedEvents() {
  if (!archivedEventsList) return;

  if (!archiveSupported) {
    archivedEventCount.textContent = '—';
    archivedEventsList.innerHTML = `<div class="empty-state">${escapeHtml(t('analytics.archiveSetupRequired'))}</div>`;
    return;
  }

  const archived = events
    .filter(event => event.archived_at)
    .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));

  archivedEventCount.textContent = archived.length;

  if (!archived.length) {
    archivedEventsList.innerHTML = `<div class="empty-state compact">${escapeHtml(t('analytics.noArchivedEvents'))}</div>`;
    return;
  }

  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  archivedEventsList.innerHTML = archived.map(event => {
    const eventDate = event.event_date
      ? new Date(event.event_date + 'T00:00:00').toLocaleDateString(locale)
      : t('dashboard.noDate');
    const archivedDate = new Date(event.archived_at).toLocaleDateString(locale);
    return `
      <article class="archive-item">
        <div>
          <strong>${escapeHtml(event.name)}</strong>
          <small>${escapeHtml(eventDate)} · ${escapeHtml(t('analytics.archivedOn', { date: archivedDate }))}</small>
        </div>
        <div class="archive-actions">
          <button class="secondary-button" type="button" data-analytics-event="${event.id}">${escapeHtml(t('analytics.viewAnalytics'))}</button>
          <button class="ghost-button" type="button" data-restore-event="${event.id}">${escapeHtml(t('analytics.restoreEvent'))}</button>
          <button class="ghost-button delete-event-button" type="button" data-delete-event="${event.id}">${escapeHtml(t('analytics.deletePermanently'))}</button>
        </div>
      </article>`;
  }).join('');

  archivedEventsList.querySelectorAll('[data-analytics-event]').forEach(button => {
    button.addEventListener('click', async () => {
      analyticsEventId = button.dataset.analyticsEvent;
      renderAnalyticsEventOptions();
      await loadAnalytics(analyticsEventId);
      document.querySelector('#analyticsTab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  archivedEventsList.querySelectorAll('[data-restore-event]').forEach(button => {
    button.addEventListener('click', () => restoreArchivedEvent(button.dataset.restoreEvent));
  });

  archivedEventsList.querySelectorAll('[data-delete-event]').forEach(button => {
    button.addEventListener('click', () => permanentlyDeleteEvent(button.dataset.deleteEvent));
  });
}

async function permanentlyDeleteEvent(id) {
  const event = events.find(item => item.id === id && item.archived_at);
  if (!event) return;

  const confirmation = window.prompt(t('analytics.deleteConfirm', { name: event.name }));
  if (confirmation === null) return;
  if (confirmation.trim() !== event.name) {
    showDashboardNotice(t('analytics.deleteNameMismatch'), 'error');
    return;
  }

  const { data, error } = await supabase.rpc('delete_owned_event', {
    p_event_id: event.id,
  });

  if (error) {
    const message = error.message?.includes('delete_owned_event')
      ? t('analytics.deleteSetupRequired')
      : error.message;
    showDashboardNotice(message || t('analytics.deleteFailed'), 'error');
    return;
  }

  if (!data) {
    showDashboardNotice(t('analytics.deleteFailed'), 'error');
    return;
  }

  if (analyticsEventId === event.id) {
    analyticsEventId = null;
    analyticsRows = [];
  }

  showDashboardNotice(t('analytics.eventDeleted'), 'success');
  await loadEvents();
  renderAnalyticsEventOptions();
  renderArchivedEvents();
  if (currentTab === 'analytics') await loadAnalytics();
}

analyticsEventSelect.addEventListener('change', () => {
  analyticsEventId = analyticsEventSelect.value || null;
  loadAnalytics(analyticsEventId);
});

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

exportAnalyticsCsv.addEventListener('click', () => {
  const event = events.find(item => item.id === analyticsEventId);
  if (!event) return;

  const playedRows = analyticsRows
    .filter(row => row.status === 'played')
    .slice()
    .sort((a, b) => new Date(a.played_at || a.updated_at) - new Date(b.played_at || b.updated_at));

  if (!playedRows.length) {
    showDashboardNotice(t('analytics.nonePlayed'), 'error');
    return;
  }

  const header = ['#', 'Type', 'Artist', 'Song', 'Requested By', 'Played At', 'Tip', 'Payment Status'];
  const body = playedRows.map((row, index) => [
    index + 1,
    row.request_type === 'karaoke' ? 'Karaoke' : 'Song',
    row.artist,
    row.song,
    row.requester_name || '',
    row.played_at || row.updated_at || '',
    Number(row.tip_amount || 0).toFixed(2),
    row.payment_status || '',
  ]);

  const csv = [header, ...body].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.slug || slugify(event.name) || 'drop-my-song-event'}-played.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showDashboardNotice(t('analytics.exported'), 'success');
});

async function makeEventActive(id) {
  const { error: clearError } = await supabase.from('events').update({ is_active: false }).neq('id', id);
  if (clearError) return showDashboardNotice(clearError.message, 'error');
  const { error } = await supabase.from('events').update({ is_active: true }).eq('id', id);
  if (error) return showDashboardNotice(error.message, 'error');
  await loadEvents(id);
}

function setTab(tab) {
  currentTab = ['queue', 'karaoke', 'played', 'analytics', 'events'].includes(tab) ? tab : 'queue';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.tab === currentTab));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  document.querySelector(`#${currentTab}Tab`)?.classList.remove('hidden');
  updateDashboardHeader();
  if (currentTab === 'analytics') {
    renderAnalyticsEventOptions();
    loadAnalytics(analyticsEventSelect.value || analyticsEventId || activeEvent?.id || events[0]?.id || null);
  }
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

function updateDashboardHeader() {
  const titles = {
    queue: t('dashboard.songRequests'),
    karaoke: t('dashboard.karaokeRequests'),
    played: t('dashboard.playedTitle'),
    analytics: t('analytics.title'),
    events: t('dashboard.eventsTitle'),
  };
  dashboardTitle.textContent = titles[currentTab];
  const count = currentTab === 'queue'
    ? activeCount(songRequests())
    : currentTab === 'karaoke'
      ? activeCount(karaokeRequests())
      : currentTab === 'played'
        ? songRequests().filter(row => row.status === 'played').length + karaokeRequests().filter(row => row.status === 'played').length
        : currentTab === 'analytics'
          ? analyticsRows.length
          : events.filter(event => !event.archived_at).length;
  requestCount.textContent = count;
}

function renderEventLinksAndQr() {
  if (!activeEvent) return;
  const guestUrl = buildGuestUrl(activeEvent.slug);
  eventLinkBox.textContent = guestUrl;
  karaokeLinkBox.textContent = guestUrl;
  renderQrCode(songQr, guestUrl);
  renderQrCode(karaokeQr, guestUrl);
}

function clearQr(container) {
  if (container) container.innerHTML = '';
}

function renderQrCode(container, url) {
  if (!container) return;
  container.innerHTML = '';
  if (!url) return;
  if (window.QRCode) {
    new window.QRCode(container, {
      text: url,
      width: container.classList.contains('large') ? 260 : 180,
      height: container.classList.contains('large') ? 260 : 180,
      colorDark: '#05070b',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    container.innerHTML = `<div class="empty-state">${escapeHtml(url)}</div>`;
  }
}

function openQrModal(eventId) {
  modalEvent = events.find(item => item.id === eventId) || null;
  if (!modalEvent) return;
  qrModal.classList.remove('hidden');
  renderQrModal();
}

function renderQrModal() {
  if (!modalEvent) return;
  qrModalEventName.textContent = modalEvent.name;
  const url = buildGuestUrl(modalEvent.slug);
  qrModalLink.textContent = url;
  qrInactiveWarning.classList.toggle('hidden', !!modalEvent.is_active);
  renderQrCode(qrModalCode, url);
}

closeQrModal.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModal.addEventListener('click', event => {
  if (event.target === qrModal) qrModal.classList.add('hidden');
});
copyQrModalLink.addEventListener('click', async () => {
  await copyText(qrModalLink.textContent);
  showDashboardNotice(t('dashboard.linkCopied'), 'success');
});

window.addEventListener('dropmysong:languagechange', () => {
  applyTranslations();
  renderEvents();
  renderAnalyticsEventOptions();
  renderArchivedEvents();
  renderAnalytics();
  renderAll();
  syncPaymentSettingsForm();
  syncHostAccessPanel();
  renderEventLinksAndQr();
  if (modalEvent && !qrModal.classList.contains('hidden')) renderQrModal();
  if (activeEvent) activeEventName.textContent = `${activeEvent.name}${activeEvent.is_active ? '' : ` · ${t('dashboard.inactive')}`}`;
  else activeEventName.textContent = t('dashboard.noActiveEvent');
});

window.addEventListener('beforeunload', teardownRealtime);

const { data: sessionData } = await supabase.auth.getSession();
session = sessionData.session;
if (session) await enterDashboard();
