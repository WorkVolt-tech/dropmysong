import { supabase } from './supabaseClient.js';
import { STATUS_LABELS, escapeHtml, getOrCreateGuestToken, isHttpUrl } from './common.js';

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

let publicEvent = null;
let currentRequest = null;
let pollTimer = null;

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

function showNotice(text, type = '') {
  notice.textContent = text;
  notice.className = `notice ${type}`.trim();
  notice.classList.remove('hidden');
}

function clearNotice() {
  notice.classList.add('hidden');
}

async function loadEvent() {
  if (!eventSlug) {
    showNotice('This request link is missing an event. Ask the DJ for the current QR code or request link.', 'error');
    form.classList.add('hidden');
    return;
  }

  const { data, error } = await supabase.rpc('get_public_event', { p_slug: eventSlug });
  if (error || !data?.length) {
    console.error(error);
    showNotice('This event could not be found or is no longer active.', 'error');
    form.classList.add('hidden');
    return;
  }

  publicEvent = data[0];
  eventBanner.innerHTML = `<strong>${escapeHtml(publicEvent.name)}</strong>${publicEvent.event_date ? ` · ${escapeHtml(new Date(publicEvent.event_date + 'T00:00:00').toLocaleDateString())}` : ''}`;
  eventBanner.classList.remove('hidden');

  if (!publicEvent.requests_enabled) {
    showNotice('Song requests are currently paused by the DJ. Check back in a little while.');
    form.classList.add('hidden');
    return;
  }

  if (publicEvent.tips_enabled) tipsPanel.classList.remove('hidden');
  restoreLastRequest();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();

  const artist = document.querySelector('#artist').value.trim();
  const song = document.querySelector('#song').value.trim();
  const songUrl = document.querySelector('#songUrl').value.trim();
  const requesterName = document.querySelector('#requesterName').value.trim();
  const note = message.value.trim();

  if (!artist || !song) {
    showNotice('Artist and song are required.', 'error');
    return;
  }
  if (!isHttpUrl(songUrl)) {
    showNotice('Please enter a valid song link that starts with http:// or https://.', 'error');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';

  const { data, error } = await supabase.rpc('submit_song_request', {
    p_event_slug: eventSlug,
    p_artist: artist,
    p_song: song,
    p_song_url: songUrl || null,
    p_requester_name: requesterName || null,
    p_message: note || null,
    p_tip_amount: tipAmount.value ? Number(tipAmount.value) : null,
    p_guest_token: guestToken,
  });

  submitButton.disabled = false;
  submitButton.textContent = 'Submit Request';

  if (error || !data?.length) {
    console.error(error);
    showNotice(error?.message || 'Could not submit your request. Please try again.', 'error');
    return;
  }

  currentRequest = { id: data[0].request_id, artist, song };
  localStorage.setItem(`dropmysong_last_${eventSlug}`, JSON.stringify(currentRequest));
  form.reset();
  messageCount.textContent = '0';
  tipAmount.value = '';
  document.querySelectorAll('[data-tip]').forEach(item => item.classList.remove('active'));
  showNotice('Request sent to DJ Maxo.', 'success');
  await refreshStatus();
  startPolling();
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
  statusSong.textContent = `${row.artist} — ${row.song}`;
  statusBadge.textContent = STATUS_LABELS[row.status] || row.status;
  statusBadge.className = `status-pill ${row.status}`;
  statusText.textContent = statusCopy(row.status);
  statusPanel.classList.remove('hidden');
  cantFindHelp.classList.toggle('hidden', row.status !== 'cant_find');

  if (['played', 'rejected'].includes(row.status)) stopPolling();
}

function statusCopy(status) {
  return {
    pending: 'Waiting for the DJ to review it.',
    accepted: 'DJ Maxo accepted your request. It is in the queue.',
    playing: 'Your request is playing now!',
    played: 'Played — thanks for the request.',
    rejected: 'This request will not be played at this event.',
    cant_find: 'DJ Maxo needs a direct link to help find this song.',
  }[status] || 'Request updated.';
}

function restoreLastRequest() {
  const raw = localStorage.getItem(`dropmysong_last_${eventSlug}`);
  if (!raw) return;
  try {
    currentRequest = JSON.parse(raw);
    refreshStatus();
    startPolling();
  } catch {
    localStorage.removeItem(`dropmysong_last_${eventSlug}`);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshStatus, 5000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

saveHelpLink.addEventListener('click', async () => {
  const url = helpSongUrl.value.trim();
  if (!currentRequest || !isHttpUrl(url) || !url) {
    showNotice('Please paste a valid song link.', 'error');
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
    showNotice(error.message || 'Could not save the link.', 'error');
    return;
  }
  helpSongUrl.value = '';
  showNotice('Song link sent to DJ Maxo.', 'success');
  await refreshStatus();
});

loadEvent();
