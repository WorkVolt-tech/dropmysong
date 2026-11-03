import { supabase } from './supabaseClient.js';
import { escapeHtml, getOrCreateGuestToken, isHttpUrl } from './common.js';
import { applyTranslations, getLanguage, initI18n, t } from './i18n.js';
import { getLinkPreview, renderLinkPreviewInto } from './linkPreview.js';
import { ETRANSFER_EMAIL, PAYPAL_ME_URL, SUPABASE_ANON_KEY, SUPABASE_URL, VAPID_PUBLIC_KEY } from './config.js';

const params = new URLSearchParams(location.search);
const eventSlug = params.get('event');
const embeddedForHost = params.get('embed') === 'host';
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
const songUrlInput = document.querySelector('#songUrl');
const artistInput = document.querySelector('#artist');
const songInput = document.querySelector('#song');
const songLinkPreview = document.querySelector('#songLinkPreview');
const statusLinkPreview = document.querySelector('#statusLinkPreview');
const tipButtons = document.querySelector('#tipButtons');
const tipRequirementCopy = document.querySelector('#tipRequirementCopy');
const tipRequiredBadge = document.querySelector('#tipRequiredBadge');
const paymentMethods = document.querySelector('#paymentMethods');
const paymentMethod = document.querySelector('#paymentMethod');
const paypalMethod = document.querySelector('#paypalMethod');
const etransferMethod = document.querySelector('#etransferMethod');
const paypalFields = document.querySelector('#paypalFields');
const etransferFields = document.querySelector('#etransferFields');
const etransferEmail = document.querySelector('#etransferEmail');
const paymentSenderName = document.querySelector('#paymentSenderName');
const paymentStatusPanel = document.querySelector('#paymentStatusPanel');
const paymentStatusTitle = document.querySelector('#paymentStatusTitle');
const paymentStatusText = document.querySelector('#paymentStatusText');
const paypalPayButton = document.querySelector('#paypalPayButton');
const recentPlayedPanel = document.querySelector('#recentPlayedPanel');
const recentPlayedList = document.querySelector('#recentPlayedList');

let requestType = params.get('type') === 'karaoke' ? 'karaoke' : 'song';
let publicEvent = null;
let currentRequest = null;
const guestRequestsKey = `dropmysong_requests_${eventSlug}`;
const activeGuestStatuses = new Set(['pending','cant_find','accepted','playing']);
const otherGuestRequests = document.querySelector('#otherGuestRequests');
let guestRequestTimer = null;
let alertRequestId = null;
let guestRequestsBusy = false;
const notifiedKaraokeVersions = new Map();
function notifyKaraokeCall(row) {
  if (!row?.id || row.request_type !== 'karaoke' || row.status !== 'playing') return;
  const version = row.updated_at || 'called';
  const key = `dropmysong_karaoke_called_${row.id}`;
  if (notifiedKaraokeVersions.get(row.id) === version) return;
  // Persist the displayed call so refreshing the guest page doesn't repeatedly interrupt them.
  let previous = '';
  try { previous = sessionStorage.getItem(key) || ''; } catch {}
  if (previous === version) { notifiedKaraokeVersions.set(row.id, version); return; }
  notifiedKaraokeVersions.set(row.id, version);
  try { sessionStorage.setItem(key, version); } catch {}
  announceKaraokeReady(row);
}


function savedGuestRequests() {
  try {
    const saved = JSON.parse(localStorage.getItem(guestRequestsKey) || '[]');
    return Array.isArray(saved) ? saved.filter(row => row?.id).slice(-40) : [];
  } catch { return []; }
}

function canGuestCancel(row) {
  return row && ['pending','cant_find','accepted'].includes(row.status || 'pending')
    && Number(row.tip_amount || 0) === 0;
}

async function cancelGuestRequest(row) {
  if (!canGuestCancel(row)) return;
  const fr = getLanguage() === 'fr';
  if (!window.confirm(fr ? 'Annuler cette demande ?' : 'Cancel this request?')) return;
  const { data, error } = await supabase.rpc('cancel_guest_request', {
    p_request_id: row.id, p_guest_token: guestToken,
  });
  if (error || !data) {
    showNotice(error?.message || (fr ? 'Annulation impossible. Vérifiez si la demande a déjà commencé ou si un paiement est associé.' : 'Cannot cancel. The request may have started or have a payment attached.'), 'error');
    await renderGuestRequests();
    if (currentRequest?.id === row.id) await refreshStatus();
    return;
  }
  const cancelled = { ...row, status:'rejected', updated_at:new Date().toISOString() };
  saveGuestRequest(cancelled);
  if (currentRequest?.id === row.id) {
    currentRequest = { ...currentRequest, ...cancelled };
    localStorage.setItem(`dropmysong_last_${eventSlug}`,JSON.stringify(currentRequest));
    renderCurrentStatus();
    stopPolling();
  }
  showNotice(fr ? 'Votre demande a été annulée.' : 'Your request was cancelled.', 'success');
  await renderGuestRequests();
}

const cancelCurrentButton = document.createElement('button');
cancelCurrentButton.type = 'button';
cancelCurrentButton.className = 'secondary-button';
cancelCurrentButton.style.cssText = 'width:100%;margin-top:12px';
cancelCurrentButton.addEventListener('click', () => cancelGuestRequest(currentRequest));
statusPanel.append(cancelCurrentButton);

function saveGuestRequest(row) {
  const rows = savedGuestRequests().filter(item => item.id !== row.id);
  rows.push(row);
  localStorage.setItem(guestRequestsKey, JSON.stringify(rows.slice(-40)));
}

async function renderGuestRequests() {
  if (!otherGuestRequests || guestRequestsBusy) return;
  guestRequestsBusy = true;
  try {
  const saved = savedGuestRequests();
  if (!saved.length) { otherGuestRequests.replaceChildren(); return; }
  const token = guestToken;
  const fetched = await Promise.all(saved.map(async item => {
    try {
      const { data, error } = await supabase.rpc('get_request_status', {
        p_request_id: item.id, p_guest_token: token,
      });
      if (error || !data?.[0]) return item;
      const updated = { ...item, ...data[0] };
      if (updated.payment_method === 'paypal' && updated.status === 'rejected') {
        const refund=await supabase.rpc('get_guest_refund_status',{p_request_id:item.id,p_guest_token:token});
        if (!refund.error && refund.data?.length) {
          updated.payment_status=refund.data[0].payment_status;
          updated.paypal_refund_state=refund.data[0].refund_state;
        }
      }
      if (updated.request_type === 'karaoke' && updated.status === 'playing') {
        const ack = await supabase.rpc('get_karaoke_arrival',{p_request_id:item.id,p_guest_token:token});
        if (!ack.error) updated.singer_confirmed_at=ack.data;
      }
      return updated;
    } catch { return item; }
  }));
  // Keep the complete local history, but show only requests still awaiting or being performed.
  localStorage.setItem(guestRequestsKey, JSON.stringify(fetched));
  // A guest can submit many karaoke requests. A call must alert them even if
  // that karaoke request is not the most recently submitted request.
  for (const item of fetched) {
    if (item.id !== currentRequest?.id) notifyKaraokeCall(item);
  }
  const other = fetched.filter(item => item.id !== currentRequest?.id && (
    activeGuestStatuses.has(item.status || 'pending') ||
    (item.status === 'rejected' && item.payment_method === 'paypal')
  ));
  otherGuestRequests.replaceChildren();
  for (const item of other) {
    const section = document.createElement('section');
    section.className = 'panel status-panel';
    section.style.marginBottom = '14px';
    const heading = document.createElement('p');
    heading.className = 'eyebrow';
    heading.textContent = item.request_type === 'karaoke' ? '🎤 KARAOKE REQUEST' : '♫ SONG REQUEST';
    const title = document.createElement('h3');
    title.textContent = `${item.artist || ''} — ${item.song || ''}`;
    const badge = document.createElement('span');
    badge.className = `status-pill ${item.status || 'pending'}`;
    badge.textContent = item.request_type === 'karaoke' && item.status === 'playing'
      ? (getLanguage() === 'fr' ? 'À TOI!' : 'YOU’RE UP!')
      : item.request_type === 'karaoke' && item.status === 'accepted'
        ? (getLanguage() === 'fr' ? 'Dans la file' : 'Queued')
        : (item.status || 'pending');
    const status = document.createElement('p');
    status.className = 'muted';
    status.textContent = item.status === 'playing' ? (item.request_type === 'karaoke'
      ? (getLanguage() === 'fr' ? '🎤 C’EST À TOI! Viens chanter maintenant.' : '🎤 YOU’RE UP! Come to the karaoke area now.')
      : 'Currently playing') :
      item.status === 'accepted' ? 'Approved — waiting in the queue' :
      item.status === 'cant_find' ? 'DJ needs help locating this version' :
      'Waiting for DJ approval';
    section.append(heading, title, badge, status);
    if (item.status === 'rejected' && item.payment_method === 'paypal') {
      const info=document.createElement('p');
      info.className='status-pill ' + (item.payment_status==='refunded'?'accepted':'pending');
      info.textContent=item.payment_status==='refunded'
        ? (getLanguage()==='fr'?'✓ Remboursé par PayPal':'✓ PayPal refunded')
        : item.payment_status==='refund_pending'
          ? (getLanguage()==='fr'?'Remboursement en cours':'Refund processing')
          : (getLanguage()==='fr'?'Demande refusée':'Request rejected');
      section.append(info);
    }
    if (item.request_type === 'karaoke' && item.status === 'playing' && item.singer_confirmed_at) {
      const ack=document.createElement('span');
      ack.className='status-pill accepted';
      ack.textContent=getLanguage()==='fr'?'✓ En route':'✓ On My Way';
      section.append(ack);
    }
    if (canGuestCancel(item)) {
      const button=document.createElement('button');
      button.className='secondary-button';
      button.type='button';
      button.style.cssText='margin-top:10px;width:100%';
      button.textContent=getLanguage()==='fr'?'Annuler la demande':'Cancel request';
      button.addEventListener('click',()=>cancelGuestRequest(item));
      section.append(button);
    }
    otherGuestRequests.append(section);
  }
  } finally { guestRequestsBusy = false; }
}

function startGuestRequestPolling() {
  if (guestRequestTimer) clearInterval(guestRequestTimer);
  renderGuestRequests();
  guestRequestTimer = setInterval(renderGuestRequests, 4000);
}

let pollTimer = null;
let requestRealtime = null;
let readyAnnouncementVersion = null;
let audioContext = null;
let linkPreviewTimer = null;
let previewSequence = 0;
let lastAutoArtist = '';
let lastAutoSong = '';
let availableTipOptions = [5, 10, 15, 20];
let recentPlayedRows = [];
let recentPlayedAvailable = false;
let recentPlayedTimer = null;
let paypalCheckoutBusy = false;
let pushRegisteredRequestId = localStorage.getItem(`dropmysong_push_request_${eventSlug}`) || null;

function mayReplaceAutoFilled(input, lastAutoValue) {
  const current = input.value.trim();
  return !current || (lastAutoValue && current === lastAutoValue);
}

function applyPreviewMetadata(preview) {
  if (!preview) return;
  if (preview.needsManualMetadata) {
    if (/^(Linked song|Artist not provided)$/i.test(artistInput.value.trim())) artistInput.value = '';
    if (/^(Linked song|watch|Song from link)$/i.test(songInput.value.trim())) songInput.value = '';
    showNotice(getLanguage()==='fr'
      ? 'Impossible de récupérer le titre YouTube. Veuillez saisir l’artiste et le titre manuellement.'
      : 'Could not retrieve the YouTube title. Please enter the artist and song manually.', 'error');
    return;
  }

  const detectedArtist = (preview.artistName || preview.subtitle || '').trim();
  const detectedSong = (preview.trackTitle || preview.title || '').trim();

  if (detectedArtist && mayReplaceAutoFilled(artistInput, lastAutoArtist)) {
    artistInput.value = detectedArtist.slice(0, 120);
    lastAutoArtist = artistInput.value.trim();
  }

  if (detectedSong && mayReplaceAutoFilled(songInput, lastAutoSong)) {
    songInput.value = detectedSong.slice(0, 160);
    lastAutoSong = songInput.value.trim();
  }
}

function scheduleSongLinkPreview() {
  clearTimeout(linkPreviewTimer);
  const value = songUrlInput.value.trim();

  if (!value) {
    songLinkPreview.innerHTML = '';
    songLinkPreview.classList.add('hidden');
    return;
  }

  const sequence = ++previewSequence;
  linkPreviewTimer = setTimeout(async () => {
    const preview = await renderLinkPreviewInto(songLinkPreview, value, {
      linked: true,
      fallbackTitle: songInput.value.trim(),
      fallbackSubtitle: artistInput.value.trim(),
    });

    if (sequence !== previewSequence) return;
    applyPreviewMetadata(preview);
  }, 320);
}

initI18n();
if (embeddedForHost) document.body.classList.add('embedded-host-request');
setRequestType(requestType, false);

message.addEventListener('input', () => {
  messageCount.textContent = message.value.length;
});

songUrlInput.addEventListener('input', scheduleSongLinkPreview);
artistInput.addEventListener('input', () => {
  if (artistInput.value.trim() !== lastAutoArtist) lastAutoArtist = '';
  if (songUrlInput.value.trim()) scheduleSongLinkPreview();
});
songInput.addEventListener('input', () => {
  if (songInput.value.trim() !== lastAutoSong) lastAutoSong = '';
  if (songUrlInput.value.trim()) scheduleSongLinkPreview();
});

tipButtons.addEventListener('click', event => {
  const button = event.target.closest('[data-tip]');
  if (!button) return;
  const alreadyActive = button.classList.contains('active');
  const required = publicEvent?.tips_visible !== false && !!publicEvent?.tips_enabled;
  tipButtons.querySelectorAll('[data-tip]').forEach(item => item.classList.remove('active'));
  if (alreadyActive && !required) {
    tipAmount.value = '';
  } else {
    tipAmount.value = button.dataset.tip;
    button.classList.add('active');
  }
  syncPaymentUi();
});

paymentMethods.addEventListener('click', event => {
  const button = event.target.closest('[data-payment-method]');
  if (!button || button.classList.contains('hidden')) return;
  paymentMethod.value = button.dataset.paymentMethod;
  paymentMethods.querySelectorAll('[data-payment-method]').forEach(item => item.classList.toggle('active', item === button));
  syncPaymentUi();
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

function normalizeTipOptions(value) {
  const list = Array.isArray(value) ? value : [5, 10, 15, 20];
  const cleaned = list.map(Number).filter(amount => Number.isFinite(amount) && amount > 0).slice(0, 4);
  return cleaned.length ? cleaned : [5, 10, 15, 20];
}

function renderTipOptions() {
  availableTipOptions = normalizeTipOptions(publicEvent?.tip_options);
  tipButtons.innerHTML = availableTipOptions.map(amount => `<button type="button" data-tip="${amount}">$${Number(amount).toLocaleString(getLanguage() === 'fr' ? 'fr-CA' : 'en-CA')}</button>`).join('');
  const selected = Number(tipAmount.value || 0);
  tipButtons.querySelectorAll('[data-tip]').forEach(button => button.classList.toggle('active', Number(button.dataset.tip) === selected));
}

function syncPaymentUi() {
  const visible = publicEvent?.tips_visible !== false;
  const required = visible && !!publicEvent?.tips_enabled;
  tipsPanel.classList.toggle('hidden', !visible);

  if (!visible) {
    tipAmount.value = '';
    paymentMethod.value = '';
    paymentSenderName.value = '';
    paymentMethods.classList.add('hidden');
    paypalFields.classList.add('hidden');
    etransferFields.classList.add('hidden');
    tipButtons.querySelectorAll('[data-tip]').forEach(button => {
      button.classList.remove('active');
      button.disabled = true;
    });
    paymentMethods.querySelectorAll('[data-payment-method]').forEach(button => button.classList.remove('active'));
    return;
  }
  tipRequirementCopy.textContent = t(required ? 'guest.tipCopyRequired' : 'guest.tipCopy');
  tipRequiredBadge.classList.toggle('hidden', !required);

  const hasProvider = !!publicEvent?.paypal_enabled || !!publicEvent?.etransfer_enabled;
  if (!hasProvider) {
    tipAmount.value = '';
    tipButtons.querySelectorAll('[data-tip]').forEach(button => {
      button.disabled = true;
      button.classList.remove('active');
    });
    tipRequirementCopy.textContent = t('guest.tipUnavailableCopy');
  } else {
    tipButtons.querySelectorAll('[data-tip]').forEach(button => { button.disabled = false; });
  }

  const hasTip = Number(tipAmount.value || 0) > 0;
  paymentMethods.classList.toggle('hidden', !hasTip || !hasProvider);

  paypalMethod.classList.toggle('hidden', !publicEvent?.paypal_enabled);
  etransferMethod.classList.toggle('hidden', !publicEvent?.etransfer_enabled);
  etransferEmail.textContent = publicEvent?.etransfer_email || '—';

  if (!hasTip) {
    paymentMethod.value = '';
    paymentMethods.querySelectorAll('[data-payment-method]').forEach(item => item.classList.remove('active'));
  }

  const selectedMethod = paymentMethod.value;
  paypalFields.classList.toggle('hidden', selectedMethod !== 'paypal');
  etransferFields.classList.toggle('hidden', selectedMethod !== 'etransfer');
}

async function paypalApi(payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/paypal-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!response.ok || data?.error) {
    throw new Error(data?.error || raw || t('guest.paypalAutomaticFailed'));
  }

  return data;
}

function cleanPayPalReturnUrl() {
  const url = new URL(location.href);
  ['paypal', 'request', 'token', 'PayerID'].forEach(name => url.searchParams.delete(name));
  history.replaceState({}, '', url);
}

async function startPayPalCheckout() {
  if (paypalCheckoutBusy || !currentRequest?.id || currentRequest.payment_method !== 'paypal' || currentRequest.payment_status === 'confirmed') return;

  const paymentWindow = embeddedForHost ? window.open('', '_blank') : null;
  paypalCheckoutBusy = true;
  renderPaymentStatus();
  clearNotice();

  try {
    const data = await paypalApi({
      action: 'create',
      request_id: currentRequest.id,
      guest_token: guestToken,
      language: getLanguage(),
    });

    if (data?.confirmed) {
      paypalCheckoutBusy = false;
      paymentWindow?.close();
      currentRequest.payment_status = 'confirmed';
      renderPaymentStatus();
      await refreshStatus();
      showNotice(t('guest.paypalConfirmedNotice'), 'success');
      return;
    }

    if (!data?.approve_url) throw new Error(t('guest.paypalAutomaticFailed'));
    if (paymentWindow) paymentWindow.location.href = data.approve_url;
    else location.assign(data.approve_url);
  } catch (error) {
    paypalCheckoutBusy = false;
    paymentWindow?.close();
    renderPaymentStatus();
    showNotice(error?.message || t('guest.paypalAutomaticFailed'), 'error');
  }
}

async function handlePayPalReturn() {
  const mode = params.get('paypal');
  if (!mode) return;

  if (mode === 'cancel') {
    showNotice(t('guest.paypalCancelled'));
    cleanPayPalReturnUrl();
    return;
  }

  if (mode !== 'return') return;

  const requestId = params.get('request');
  const orderId = params.get('token');
  if (!requestId || !orderId) {
    showNotice(t('guest.paypalAutomaticFailed'), 'error');
    cleanPayPalReturnUrl();
    return;
  }

  if (!currentRequest || currentRequest.id !== requestId) {
    currentRequest = {
      id: requestId,
      request_type: requestType,
      payment_method: 'paypal',
      payment_status: 'pending',
    };
  }

  paypalCheckoutBusy = true;
  showNotice(t('guest.paypalProcessing'));

  try {
    const data = await paypalApi({
      action: 'capture',
      request_id: requestId,
      order_id: orderId,
      guest_token: guestToken,
      language: getLanguage(),
    });

    if (!data?.confirmed) throw new Error(t('guest.paypalAutomaticFailed'));
    currentRequest.payment_status = 'confirmed';
    await refreshStatus();
    showNotice(t('guest.paypalConfirmedNotice'), 'success');
  } catch (error) {
    showNotice(error?.message || t('guest.paypalAutomaticFailed'), 'error');
  } finally {
    paypalCheckoutBusy = false;
    cleanPayPalReturnUrl();
    renderPaymentStatus();
  }
}

paypalPayButton.addEventListener('click', event => {
  event.preventDefault();
  startPayPalCheckout();
});

function renderPaymentStatus() {
  if (!currentRequest?.tip_amount) {
    paymentStatusPanel.classList.add('hidden');
    return;
  }

  paymentStatusPanel.classList.remove('hidden');
  const amount = Number(currentRequest.tip_amount).toFixed(2);
  if (currentRequest.payment_method === 'paypal' &&
      ['refunded','refund_pending'].includes(currentRequest.payment_status)) {
    const complete=currentRequest.payment_status==='refunded';
    paymentStatusTitle.textContent=complete
      ? (getLanguage()==='fr'? `Remboursement PayPal de ${amount} $ confirmé` : `PayPal refund confirmed — ${amount}`)
      : (getLanguage()==='fr'? 'Remboursement en cours' : 'Refund processing');
    paymentStatusText.textContent=complete
      ? (getLanguage()==='fr'? 'La demande a été refusée et le remboursement a été envoyé par PayPal.' : 'Your request was rejected and PayPal confirmed the refund.')
      : (getLanguage()==='fr'? 'PayPal traite votre remboursement.' : 'PayPal is processing your refund.');
    paypalPayButton.classList.add('hidden');
    return;
  }
  const confirmed = currentRequest.payment_status === 'confirmed';
  paymentStatusTitle.textContent = confirmed
    ? t('guest.paymentConfirmedTitle', { amount })
    : t('guest.paymentPendingTitle', { amount });

  if (confirmed) {
    paymentStatusText.textContent = t('guest.paymentConfirmedCopy');
    paypalPayButton.classList.add('hidden');
    return;
  }

  if (currentRequest.payment_method === 'etransfer') {
    paymentStatusText.textContent = t('guest.etransferPendingCopy', {
      amount,
      email: currentRequest.etransfer_email || publicEvent?.etransfer_email || '',
      name: currentRequest.payment_sender_name || '',
    });
    paypalPayButton.classList.add('hidden');
  } else if (currentRequest.payment_method === 'paypal') {
    paymentStatusText.textContent = t('guest.paypalPendingCopy');
    paypalPayButton.removeAttribute('href');
    paypalPayButton.classList.remove('hidden');
    paypalPayButton.setAttribute('aria-disabled', paypalCheckoutBusy ? 'true' : 'false');
    paypalPayButton.textContent = t(paypalCheckoutBusy ? 'guest.openingPaypal' : 'guest.payWithPaypal');
  } else {
    paymentStatusText.textContent = t('guest.paymentPendingCopy');
    paypalPayButton.classList.add('hidden');
  }
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
  renderTipOptions();
  syncPaymentUi();
}

let eventSettingsChannel = null;
let eventSettingsTimer = null;
let eventSettingsBusy = false;

async function refreshEventSettings() {
  if (!publicEvent?.id || eventSettingsBusy) return;
  eventSettingsBusy = true;
  const eventId = publicEvent.id;
  try {
    const [base, options, visibility] = await Promise.all([
      supabase.rpc('get_public_event', { p_slug:eventSlug }),
      supabase.from('dropmysong_event_options')
        .select('requests_enabled,karaoke_enabled,tips_enabled,tip_options,paypal_enabled,etransfer_enabled')
        .eq('id',eventId).limit(1),
      supabase.rpc('get_event_tip_visibility', { p_event_id:eventId }),
    ]);
    if (publicEvent?.id !== eventId || base.error || !base.data?.length) return;
    const old = publicEvent;
    const baseRow = base.data[0];
    const optionRow = !options.error ? options.data?.[0] : null;
    const visible = !visibility.error && visibility.data?.length
      ? visibility.data[0].tips_visible !== false : old.tips_visible;
    const next = {
      ...old,
      ...baseRow,
      ...(optionRow || {}),
      tips_visible:visible,
      paypal_enabled:true,
      etransfer_enabled:true,
      paypal_me_url:PAYPAL_ME_URL,
      etransfer_email:ETRANSFER_EMAIL,
    };
    const keys = ['requests_enabled','karaoke_enabled','tips_enabled','tips_visible','tip_options','paypal_enabled','etransfer_enabled'];
    const changed = keys.some(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
    if (changed) {
      publicEvent = next;
      renderEventBanner();
      // Only rebuild options when they change. Do not wipe a guest's other form inputs.
      syncAvailability();
    }
  } catch (error) {
    console.debug('Guest event setting refresh failed:',error?.message || error);
  } finally { eventSettingsBusy = false; }
}

function watchEventSettings() {
  if (!publicEvent?.id) return;
  if (eventSettingsChannel) supabase.removeChannel(eventSettingsChannel);
  if (eventSettingsTimer) clearInterval(eventSettingsTimer);
  eventSettingsChannel = supabase.channel('dropmysong-event-settings-' + publicEvent.id)
    .on('broadcast',{event:'settings-updated'},refreshEventSettings)
    .subscribe();
  eventSettingsTimer = setInterval(refreshEventSettings,6000);
  document.addEventListener('visibilitychange',refreshSettingsOnVisible);
}

function refreshSettingsOnVisible() {
  if (!document.hidden) refreshEventSettings();
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

  // v2 keeps the existing public event RPC and reads only the public karaoke toggle
  // from a tiny view. This avoids replacing database functions during the upgrade.
  const [{ data: optionRows, error: optionsError }, { data: visibilityRows, error: visibilityError }] = await Promise.all([
    supabase
      .from('dropmysong_event_options')
      .select('karaoke_enabled,tips_enabled,tip_options,paypal_enabled,paypal_me_url,etransfer_enabled,etransfer_email')
      .eq('id', publicEvent.id)
      .limit(1),
    supabase.rpc('get_event_tip_visibility', { p_event_id: publicEvent.id }),
  ]);

  if (!optionsError && optionRows?.length) {
    publicEvent = { ...publicEvent, ...optionRows[0] };
  } else {
    // Safe fallback for an event created before the optional settings existed.
    publicEvent.karaoke_enabled = true;
    publicEvent.tip_options = [5, 10, 15, 20];
  }

  publicEvent.tips_visible = !visibilityError && visibilityRows?.length
    ? visibilityRows[0].tips_visible !== false
    : true;

  // Drop My Song is currently for DJ Maxo, so payment destinations are global
  // rather than saved separately on every event.
  publicEvent.paypal_enabled = true;
  publicEvent.paypal_me_url = PAYPAL_ME_URL;
  publicEvent.etransfer_enabled = true;
  publicEvent.etransfer_email = ETRANSFER_EMAIL;

  renderEventBanner();
  syncAvailability();
  watchEventSettings();
  await loadRecentPlayed();
  startRecentPlayedPolling();
  restoreLastRequest();
  startGuestRequestPolling();
  await handlePayPalReturn();
}

function renderEventBanner() {
  if (!publicEvent) return;
  const locale = getLanguage() === 'fr' ? 'fr-CA' : 'en-CA';
  eventBanner.innerHTML = `<strong>${escapeHtml(publicEvent.name)}</strong>${publicEvent.event_date ? ` · ${escapeHtml(new Date(publicEvent.event_date + 'T00:00:00').toLocaleDateString(locale))}` : ''}`;
  eventBanner.classList.remove('hidden');
}

function renderRecentPlayed() {
  if (!recentPlayedPanel || !recentPlayedList) return;
  recentPlayedPanel.classList.toggle('hidden', !recentPlayedAvailable || embeddedForHost);
  if (!recentPlayedAvailable || embeddedForHost) return;
  recentPlayedList.innerHTML = recentPlayedRows.length
    ? recentPlayedRows.map((row, index) => `
        <div class="recent-played-item">
          <span class="recent-played-number">${index + 1}</span>
          <div>
            <strong>${escapeHtml(row.song)}</strong>
            <small>${escapeHtml(row.artist)}</small>
          </div>
        </div>`).join('')
    : `<div class="empty-state compact">${escapeHtml(t('guest.noRecentPlayed'))}</div>`;
}

async function loadRecentPlayed() {
  if (!publicEvent?.id || !recentPlayedPanel || embeddedForHost) return;

  const { data, error } = await supabase
    .from('dropmysong_recent_played')
    .select('artist,song,played_at')
    .eq('event_id', publicEvent.id)
    .order('played_at', { ascending: false })
    .limit(5);

  if (error) {
    recentPlayedAvailable = false;
    console.warn('Drop My Song recent played list unavailable:', error.message || error);
    renderRecentPlayed();
    return;
  }

  recentPlayedAvailable = true;
  recentPlayedRows = data || [];
  renderRecentPlayed();
}

function startRecentPlayedPolling() {
  stopRecentPlayedPolling();
  if (embeddedForHost || !publicEvent?.id) return;
  recentPlayedTimer = setInterval(loadRecentPlayed, 15000);
}

function stopRecentPlayedPolling() {
  if (recentPlayedTimer) clearInterval(recentPlayedTimer);
  recentPlayedTimer = null;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  primeAudio();

  // Use the mode that is visibly selected at the exact moment of submission.
  // This prevents a stale URL/state value from ever saving a Song as Karaoke
  // (or vice versa).
  const activeModeButton = requestModeButtons.find(button => button.classList.contains('active'));
  const submissionType = activeModeButton?.dataset.requestType === 'karaoke' ? 'karaoke' : 'song';
  requestType = submissionType;

  let artist = artistInput.value.trim();
  let song = songInput.value.trim();
  const songUrl = songUrlInput.value.trim();
  const name = requesterName.value.trim();
  const note = message.value.trim();

  const hasManualPair = Boolean(artist && song);
  const hasLink = Boolean(songUrl);

  if (!hasManualPair && !hasLink) {
    showNotice(t('notice.artistSongRequired'), 'error');
    return;
  }
  if (hasLink && !isHttpUrl(songUrl)) {
    showNotice(t('notice.invalidLink'), 'error');
    return;
  }
  if (submissionType === 'karaoke' && !name) {
    showNotice(t('notice.singerRequired'), 'error');
    requesterName.focus();
    return;
  }

  const tipsVisible = publicEvent?.tips_visible !== false;
  const selectedTip = tipsVisible ? Number(tipAmount.value || 0) : 0;
  const selectedPaymentMethod = tipsVisible ? paymentMethod.value : '';
  const tipsRequired = tipsVisible && !!publicEvent?.tips_enabled;

  if (tipsRequired && !selectedTip) {
    showNotice(t('notice.tipRequired'), 'error');
    return;
  }
  if (selectedTip && !selectedPaymentMethod) {
    showNotice(t('notice.paymentMethodRequired'), 'error');
    return;
  }
  if (selectedPaymentMethod === 'paypal' && !publicEvent?.paypal_enabled) {
    showNotice(t('notice.paymentUnavailable'), 'error');
    return;
  }
  if (selectedPaymentMethod === 'etransfer') {
    if (!publicEvent?.etransfer_enabled || !publicEvent?.etransfer_email) {
      showNotice(t('notice.paymentUnavailable'), 'error');
      return;
    }
    if (!paymentSenderName.value.trim()) {
      showNotice(t('notice.senderNameRequired'), 'error');
      paymentSenderName.focus();
      return;
    }
  }

  submitButton.disabled = true;
  submitButton.textContent = t('guest.sending');

  // A song link can stand on its own. Resolve whatever metadata the platform
  // exposes, then fill any missing Artist/Song values before saving.
  if (hasLink && (!artist || !song)) {
    try {
      const preview = await getLinkPreview(songUrl, {
        title: song,
        subtitle: artist,
      });

      if (preview?.needsManualMetadata) {
        showNotice(getLanguage()==='fr'
          ? 'Impossible de récupérer le titre. Entrez l’artiste et le titre avant d’envoyer.'
          : 'Could not retrieve the song title. Enter the artist and song before submitting.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = t(submissionType === 'karaoke' ? 'guest.submit.karaoke' : 'guest.submit.song');
        return;
      }
      artist ||= (preview?.artistName || preview?.subtitle || 'Artist not provided').trim();
      song ||= (preview?.trackTitle || preview?.title || 'Song from link').trim();

      if (!artist) artist = 'Linked song';
      if (!song) song = 'Song from link';

      artistInput.value = artist.slice(0, 120);
      songInput.value = song.slice(0, 160);
      lastAutoArtist = artistInput.value.trim();
      lastAutoSong = songInput.value.trim();
    } catch (error) {
      console.debug('DropMySong metadata fallback:', error?.message || error);
      artist ||= 'Linked song';
      song ||= 'Song from link';
    }
  }

  // Reject metadata placeholders left behind by older versions of the form.
  if (hasLink && (/^(Artist not provided|Linked song)$/i.test(artist)
      || /^(watch|Linked song|Song from link)$/i.test(song))) {
    showNotice(getLanguage()==='fr'
      ? 'Veuillez saisir un véritable artiste et titre de chanson.'
      : 'Please enter the actual artist and song title.', 'error');
    submitButton.disabled = false;
    submitButton.textContent = t(submissionType === 'karaoke' ? 'guest.submit.karaoke' : 'guest.submit.song');
    return;
  }

  // Existing database rules require non-empty Artist/Song columns. By this
  // point they are either user-entered or populated from the submitted link.
  artist = artist.slice(0, 120);
  song = song.slice(0, 160);

  const requestId = crypto.randomUUID();
  const { error } = await supabase.from('song_requests').insert({
    id: requestId,
    event_id: publicEvent.id,
    request_type: submissionType,
    artist,
    song,
    song_url: songUrl || null,
    requester_name: name ? name.slice(0, 80) : null,
    message: note ? note.slice(0, 200) : null,
    tip_amount: selectedTip || null,
    payment_method: selectedTip ? selectedPaymentMethod : null,
    payment_status: selectedTip ? 'pending' : 'not_required',
    payment_sender_name: selectedPaymentMethod === 'etransfer' ? paymentSenderName.value.trim().slice(0, 120) : null,
    guest_token: guestToken,
  });

  submitButton.disabled = false;
  submitButton.textContent = t(submissionType === 'karaoke' ? 'guest.submit.karaoke' : 'guest.submit.song');

  if (error) {
    console.error(error);
    showNotice(error?.message || t('notice.couldNotSubmit'), 'error');
    return;
  }

  currentRequest = {
    id: requestId,
    artist,
    song,
    song_url: songUrl || null,
    request_type: submissionType,
    tip_amount: selectedTip || null,
    payment_method: selectedTip ? selectedPaymentMethod : null,
    payment_status: selectedTip ? 'pending' : 'not_required',
    payment_sender_name: selectedPaymentMethod === 'etransfer' ? paymentSenderName.value.trim().slice(0, 120) : null,
    etransfer_email: publicEvent?.etransfer_email || null,
  };
  localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
  saveGuestRequest({ ...currentRequest, status: 'pending' });
  renderGuestRequests();
  if (submissionType === 'karaoke') {
    pushRegisteredRequestId = null;
    localStorage.removeItem(`dropmysong_push_request_${eventSlug}`);
  }
  form.reset();
  lastAutoArtist = '';
  lastAutoSong = '';
  songLinkPreview.innerHTML = '';
  songLinkPreview.classList.add('hidden');
  messageCount.textContent = '0';
  tipAmount.value = '';
  paymentMethod.value = '';
  paymentSenderName.value = '';
  tipButtons.querySelectorAll('[data-tip]').forEach(item => item.classList.remove('active'));
  paymentMethods.querySelectorAll('[data-payment-method]').forEach(item => item.classList.remove('active'));
  syncPaymentUi();
  showNotice(t(submissionType === 'karaoke' ? 'notice.karaokeSent' : 'notice.requestSent'), 'success');
  await refreshStatus();
  subscribeToRequestUpdates();
  startPolling();
  if (requestType === 'karaoke' && 'Notification' in window && Notification.permission === 'granted') {
    registerKaraokePush({ requestPermission: false, quiet: true });
  }
});

async function refreshStatus() {
  if (!currentRequest) return;
  const { data, error } = await supabase.rpc('get_request_status', {
    p_request_id: currentRequest.id,
    p_guest_token: guestToken,
  });
  if (error || !data?.length) return;

  const row = data[0];
  currentRequest = { ...currentRequest, ...row };
  if (currentRequest.payment_method === 'paypal') {
    const refund = await supabase.rpc('get_guest_refund_status',{
      p_request_id:currentRequest.id,p_guest_token:guestToken,
    });
    if (!refund.error && refund.data?.length) {
      currentRequest.payment_status=refund.data[0].payment_status;
      currentRequest.paypal_refund_state=refund.data[0].refund_state;
    }
  }
  if (currentRequest.request_type === 'karaoke' && currentRequest.status === 'playing') {
    const ack=await supabase.rpc('get_karaoke_arrival',{p_request_id:currentRequest.id,p_guest_token:guestToken});
    if (!ack.error) currentRequest.singer_confirmed_at=ack.data;
  }
  localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
  saveGuestRequest(currentRequest);
  renderGuestRequests();
  renderCurrentStatus();

  if ((currentRequest.request_type || requestType) === 'karaoke' && row.status === 'playing' && readyAnnouncementVersion !== row.updated_at) {
    readyAnnouncementVersion = row.updated_at;
    notifyKaraokeCall({ ...currentRequest, ...row, id: currentRequest.id });
  }

  if (row.status === 'played') loadRecentPlayed();
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
  statusPanel.classList.toggle('hidden', !activeGuestStatuses.has(currentRequest.status)
    && !(currentRequest.status==='rejected' && currentRequest.payment_method==='paypal'));
  const onMyWay = currentRequest.request_type === 'karaoke' && currentRequest.status === 'playing' && currentRequest.singer_confirmed_at;
  statusBadge.textContent = onMyWay ? (getLanguage()==='fr'?'✓ En route':'✓ On My Way') : statusBadge.textContent;
  cancelCurrentButton.classList.toggle('hidden', !canGuestCancel(currentRequest));
  cancelCurrentButton.textContent = getLanguage()==='fr'?'Annuler la demande':'Cancel request';
  renderPaymentStatus();
  renderLinkPreviewInto(statusLinkPreview, currentRequest.song_url, {
    linked: true,
    fallbackTitle: currentRequest.song,
    fallbackSubtitle: currentRequest.artist,
  });
  cantFindHelp.classList.toggle('hidden', currentRequest.status !== 'cant_find');
  const pushComplete = pushRegisteredRequestId === currentRequest.id;
  enableAlertsButton.classList.toggle('hidden', type !== 'karaoke' || pushComplete || ['played', 'rejected'].includes(currentRequest.status));
}

function restoreLastRequest() {
  const raw = localStorage.getItem(`dropmysong_last_${eventSlug}`);
  if (!raw) return;
  try {
    currentRequest = JSON.parse(raw);
    if (!savedGuestRequests().some(item => item.id === currentRequest.id)) saveGuestRequest(currentRequest);
    refreshStatus();
    subscribeToRequestUpdates();
    startPolling();
    if ((currentRequest.request_type || 'song') === 'karaoke' && 'Notification' in window && Notification.permission === 'granted') {
      registerKaraokePush({ requestPermission: false, quiet: true });
    }
  } catch {
    localStorage.removeItem(`dropmysong_last_${eventSlug}`);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshStatus, 4000);
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
    .on('broadcast', { event: 'payment-update' }, payload => {
      if (!payload?.payload || payload.payload.request_id !== currentRequest?.id) return;
      currentRequest = { ...currentRequest, payment_status: payload.payload.payment_status || currentRequest.payment_status };
      localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
      renderCurrentStatus();
      if (currentRequest.payment_status === 'confirmed') showNotice(t('notice.paymentConfirmed'), 'success');
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
  currentRequest = { ...currentRequest, song_url: url };
  renderCurrentStatus();
  showNotice(t('notice.linkSaved'), 'success');
  await refreshStatus();
});

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function registerKaraokePush({ requestPermission = true, quiet = false } = {}) {
  if (!currentRequest || (currentRequest.request_type || requestType) !== 'karaoke') return false;

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (!quiet) showNotice(t('notice.pushUnsupported'), 'error');
    return false;
  }

  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    if (!quiet) showNotice(t('notice.notificationDenied'), 'error');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const { error } = await supabase.from('push_subscriptions').insert({
      request_id: currentRequest.id,
      guest_token: guestToken,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      language: getLanguage(),
      page_url: location.href,
    });
    if (error) throw error;

    pushRegisteredRequestId = currentRequest.id;
    localStorage.setItem(`dropmysong_push_request_${eventSlug}`, currentRequest.id);
    enableAlertsButton.classList.add('hidden');
    if (!quiet) showNotice(t('guest.alertsEnabled'), 'success');
    return true;
  } catch (error) {
    console.warn('Drop My Song push subscription failed:', error);
    if (!quiet) showNotice(error?.message || t('notice.pushSaveFailed'), 'error');
    return false;
  }
}

enableAlertsButton.addEventListener('click', async () => {
  await registerKaraokePush({ requestPermission: true, quiet: false });
});

readyAcknowledge.addEventListener('click', async () => {
  if (!alertRequestId) return;
  readyAcknowledge.disabled = true;
  try {
    const {data,error}=await supabase.rpc('confirm_karaoke_arrival',{
      p_request_id:alertRequestId,p_guest_token:guestToken,
    });
    if (error || !data) throw new Error(error?.message || 'Could not confirm your response.');
    const item=savedGuestRequests().find(row=>row.id===alertRequestId);
    if (item) saveGuestRequest({...item,singer_confirmed_at:data});
    if (currentRequest?.id===alertRequestId) {
      currentRequest={...currentRequest,singer_confirmed_at:data};
      renderCurrentStatus();
    }
    karaokeReadyAlert.classList.add('hidden');
    showNotice(getLanguage()==='fr'?'✓ Confirmé — tu es en route!':'✓ Confirmed — On My Way!','success');
    renderGuestRequests();
  } catch(error) {
    showNotice(error.message || 'Could not confirm arrival. Try again.','error');
  } finally { readyAcknowledge.disabled=false; }
});

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
  alertRequestId=row.id;
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
          tag: `karaoke-${row.id}`,
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
  renderTipOptions();
  syncPaymentUi();
  renderCurrentStatus();
  renderRecentPlayed();
  if (!karaokeReadyAlert.classList.contains('hidden') && currentRequest) {
    karaokeReadySong.textContent = `${currentRequest.artist} — ${currentRequest.song}`;
  }
});

window.addEventListener('beforeunload', () => {
  teardownRequestRealtime();
  stopPolling();
  stopRecentPlayedPolling();
  if (guestRequestTimer) clearInterval(guestRequestTimer);
});

loadEvent();
