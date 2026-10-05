import { supabase } from './supabaseClient.js';
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
const paypalEnabledSetting = document.querySelector('#paypalEnabledSetting');
const paypalMeSetting = document.querySelector('#paypalMeSetting');
const etransferEnabledSetting = document.querySelector('#etransferEnabledSetting');
const etransferEmailSetting = document.querySelector('#etransferEmailSetting');
const qrModal = document.querySelector('#qrModal');
const closeQrModal = document.querySelector('#closeQrModal');
const qrModalEventName = document.querySelector('#qrModalEventName');
const qrModalCode = document.querySelector('#qrModalCode');
const qrModalLink = document.querySelector('#qrModalLink');
const qrInactiveWarning = document.querySelector('#qrInactiveWarning');
const copyQrModalLink = document.querySelector('#copyQrModalLink');

let session = null;
let events = [];
let activeEvent = null;
let requests = [];
let realtimeChannel = null;
let currentTab = 'queue';
let modalEvent = null;
let noticeTimer = null;

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
  const target = preferredEventId
    ? events.find(item => item.id === preferredEventId)
    : events.find(item => item.id === activeEvent?.id) || events.find(item => item.is_active) || events[0] || null;
  renderEvents();
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
    }, () => loadRequests())
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
  requestList.innerHTML = list.map((row, index) => requestCard(row, index, 'song')).join('');
  bindRequestActions(requestList);
  hydrateLinkPreviews(requestList, { compact: true, openLabel: t('dashboard.openSongLink') });
}

function renderKaraokeRequests() {
  const rows = karaokeRequests();
  const list = filterRows(rows, karaokeSearch.value, karaokeStatusFilter.value);
  if (!list.length) {
    karaokeList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.noKaraokeMatches'))}</div>`;
    return;
  }
  karaokeList.innerHTML = list.map((row, index) => requestCard(row, index, 'karaoke')).join('');
  bindRequestActions(karaokeList);
  hydrateLinkPreviews(karaokeList, { compact: true, openLabel: t('dashboard.openSongLink') });
}

function bindRequestActions(container) {
  container.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => updateStatus(button.dataset.id, button.dataset.action));
  });
  container.querySelectorAll('[data-confirm-payment]').forEach(button => {
    button.addEventListener('click', () => confirmPayment(button.dataset.confirmPayment));
  });
}

function requestCard(row, index, type) {
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
  const tip = row.tip_amount ? ` · ${escapeHtml(t('dashboard.tipSelected'))}: $${Number(row.tip_amount).toFixed(2)}` : '';
  const paymentPending = Number(row.tip_amount || 0) > 0 && row.payment_status === 'pending';
  const paymentConfirmed = Number(row.tip_amount || 0) > 0 && row.payment_status === 'confirmed';
  const methodLabel = row.payment_method === 'etransfer' ? t('dashboard.etransfer') : row.payment_method === 'paypal' ? 'PayPal' : '';
  const paymentMeta = paymentPending
    ? ` · ⏳ ${escapeHtml(t('dashboard.paymentPending'))}${methodLabel ? ` (${escapeHtml(methodLabel)})` : ''}`
    : paymentConfirmed ? ` · ✓ ${escapeHtml(t('dashboard.paymentConfirmed'))}` : '';
  const duplicate = duplicateCount ? ` · 🔥 ${duplicateCount + 1} ${escapeHtml(t('dashboard.requestsPlural'))}` : '';
  const personPrefix = type === 'karaoke' ? '🎤 ' : '';
  const person = row.requester_name ? ` · ${personPrefix}${escapeHtml(row.requester_name)}` : '';
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

  return `
    <article class="request-card ${index === 0 ? 'highlight' : ''} ${type === 'karaoke' ? 'karaoke-card' : ''}">
      <div class="request-card-layout ${preview ? 'has-preview' : ''}">
        ${preview}
        <div class="request-card-body">
          <div class="request-card-head">
            <div>
              <span class="status-pill ${row.status}">${escapeHtml(statusLabel)}</span>
              <h3>${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</h3>
              <div class="request-meta">${escapeHtml(relativeTime(row.created_at, getLanguage()))}${person}${tip}${paymentMeta}${duplicate}</div>
            </div>
          </div>
          ${row.message ? `<p class="request-note">${escapeHtml(row.message)}</p>` : ''}
          ${actions}
        </div>
      </div>
    </article>`;
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
    ? next.map((row, index) => `<div class="mini-item"><strong>${index + 1}. ${escapeHtml(row.song)}</strong><span class="muted">${escapeHtml(row.artist)}</span></div>`).join('')
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
    ? next.map((row, index) => `<div class="mini-item"><strong>${index + 1}. ${escapeHtml(row.requester_name || t('request.singer'))}</strong><span class="muted">${escapeHtml(row.artist)} — ${escapeHtml(row.song)}</span></div>`).join('')
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
  if (tipsToggle.checked && activeEvent && !activeEvent.paypal_enabled && !activeEvent.etransfer_enabled) {
    tipsToggle.checked = false;
    showDashboardNotice(t('dashboard.enablePaymentFirst'), 'error');
    return;
  }
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
  paypalEnabledSetting.checked = !!activeEvent.paypal_enabled;
  paypalMeSetting.value = activeEvent.paypal_me_url || '';
  etransferEnabledSetting.checked = !!activeEvent.etransfer_enabled;
  etransferEmailSetting.value = activeEvent.etransfer_email || '';
}

paymentSettingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeEvent) return;

  const tipOptions = tipOptionInputs.map(input => Number(input.value)).filter(amount => Number.isFinite(amount) && amount > 0);
  if (tipOptions.length !== 4) {
    showDashboardNotice(t('dashboard.fourTipAmountsRequired'), 'error');
    return;
  }

  const paypalEnabled = paypalEnabledSetting.checked;
  const paypalMeUrl = paypalMeSetting.value.trim();
  const etransferEnabled = etransferEnabledSetting.checked;
  const etransferEmail = etransferEmailSetting.value.trim();
  const tipsRequired = requireTipSetting.checked;

  if (paypalEnabled && !/^https:\/\/(www\.)?paypal\.me\/[A-Za-z0-9._-]+\/?$/i.test(paypalMeUrl)) {
    showDashboardNotice(t('dashboard.validPaypalLinkRequired'), 'error');
    return;
  }
  if (etransferEnabled && !etransferEmail) {
    showDashboardNotice(t('dashboard.etransferEmailRequired'), 'error');
    return;
  }
  if (tipsRequired && !paypalEnabled && !etransferEnabled) {
    showDashboardNotice(t('dashboard.enablePaymentFirst'), 'error');
    return;
  }

  const payload = {
    tips_enabled: tipsRequired,
    tip_options: tipOptions,
    paypal_enabled: paypalEnabled,
    paypal_me_url: paypalEnabled ? paypalMeUrl : null,
    etransfer_enabled: etransferEnabled,
    etransfer_email: etransferEnabled ? etransferEmail : null,
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
    is_active: events.length === 0,
  }).select('id').single();

  if (error) return showDashboardNotice(error.message, 'error');
  eventForm.reset();
  showDashboardNotice(t('dashboard.eventCreated'), 'success');
  await loadEvents(data?.id || null);
  setTab('events');
});

function renderEvents() {
  if (!events.length) {
    eventsList.innerHTML = `<div class="empty-state">${escapeHtml(t('dashboard.createToStart'))}</div>`;
    return;
  }
  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  eventsList.innerHTML = events.map(event => `
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
      </div>
    </div>`).join('');

  eventsList.querySelectorAll('[data-select-event]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.selectEvent)));
  eventsList.querySelectorAll('[data-show-qr]').forEach(button => button.addEventListener('click', () => openQrModal(button.dataset.showQr)));
  eventsList.querySelectorAll('[data-activate-event]').forEach(button => button.addEventListener('click', () => makeEventActive(button.dataset.activateEvent)));
}

async function makeEventActive(id) {
  const { error: clearError } = await supabase.from('events').update({ is_active: false }).neq('id', id);
  if (clearError) return showDashboardNotice(clearError.message, 'error');
  const { error } = await supabase.from('events').update({ is_active: true }).eq('id', id);
  if (error) return showDashboardNotice(error.message, 'error');
  await loadEvents(id);
}

function setTab(tab) {
  currentTab = ['queue', 'karaoke', 'played', 'events'].includes(tab) ? tab : 'queue';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.tab === currentTab));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  document.querySelector(`#${currentTab}Tab`)?.classList.remove('hidden');
  updateDashboardHeader();
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

function updateDashboardHeader() {
  const titles = {
    queue: t('dashboard.songRequests'),
    karaoke: t('dashboard.karaokeRequests'),
    played: t('dashboard.playedTitle'),
    events: t('dashboard.eventsTitle'),
  };
  dashboardTitle.textContent = titles[currentTab];
  const count = currentTab === 'queue'
    ? activeCount(songRequests())
    : currentTab === 'karaoke'
      ? activeCount(karaokeRequests())
      : currentTab === 'played'
        ? songRequests().filter(row => row.status === 'played').length + karaokeRequests().filter(row => row.status === 'played').length
        : events.length;
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
  renderAll();
  syncPaymentSettingsForm();
  renderEventLinksAndQr();
  if (modalEvent && !qrModal.classList.contains('hidden')) renderQrModal();
  if (activeEvent) activeEventName.textContent = `${activeEvent.name}${activeEvent.is_active ? '' : ` · ${t('dashboard.inactive')}`}`;
  else activeEventName.textContent = t('dashboard.noActiveEvent');
});

window.addEventListener('beforeunload', teardownRealtime);

const { data: sessionData } = await supabase.auth.getSession();
session = sessionData.session;
if (session) await enterDashboard();
