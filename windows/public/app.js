const $ = (selector) => document.querySelector(selector);
const form = $('#inspect-form');
const button = $('#inspect-btn');
const result = $('#result');
const message = $('#message');
let token = null;
let timer = null;
let inspection = null;
let downloadKind = 'video';
const android = Boolean(window.VideoDeskAndroid);
const online = location.hostname.endsWith('.onrender.com');
const androidRequests = new Map();
const typedHeading = $('#typed-heading');
if (typedHeading) {
  const phrase = 'you have a link to.';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    typedHeading.textContent = phrase;
  } else {
    let index = 0;
    let deleting = false;
    const animateHeading = () => {
      if (document.hidden) { setTimeout(animateHeading, 250); return; }
      typedHeading.textContent = phrase.slice(0, index);
      if (!deleting && index === phrase.length) {
        deleting = true;
        setTimeout(animateHeading, 1500);
      } else if (deleting && index === 0) {
        deleting = false;
        setTimeout(animateHeading, 400);
      } else {
        index += deleting ? -1 : 1;
        setTimeout(animateHeading, deleting ? 30 : 75);
      }
    };
    setTimeout(animateHeading, 350);
  }
}
window.videoDeskAndroidResponse = (id, status, body) => {
  const pending = androidRequests.get(id);
  if (!pending) return;
  androidRequests.delete(id);
  try {
    const data = JSON.parse(body);
    if (status >= 400) pending.reject(new Error(data.error || 'Something went wrong.'));
    else pending.resolve(data);
  } catch { pending.reject(new Error('Could not read the app response.')); }
};

function serverState(connected) {
  $('#server-badge').classList.toggle('offline', !connected);
  $('#server-label').textContent = online ? (connected ? 'Online downloader' : 'Online service unavailable') : (connected ? 'Running on this device' : 'Local server stopped');
}

function showMessage(text, kind = 'error') {
  message.textContent = text;
  message.className = `message ${kind === 'info' ? 'info' : ''}`;
  message.hidden = false;
}
function clearMessage() { message.hidden = true; message.textContent = ''; }
function duration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function size(bytes) {
  if (!bytes || !Number.isFinite(bytes)) return '';
  return bytes > 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
const jellyGroup = $('#qualities');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function updateJellySelection(animate = false) {
  const chips = [...jellyGroup.querySelectorAll('.jelly-chip')];
  const selected = chips.findIndex((chip) => chip.querySelector('input').checked);
  if (selected < 0) return;
  const row = chips[selected].offsetTop;
  const push = Math.min(34, chips[selected].offsetWidth * .1 + 6);
  chips.forEach((chip, index) => {
    const active = index === selected;
    const sameRow = chip.offsetTop === row;
    chip.toggleAttribute('data-selected', active);
    chip.style.setProperty('--jelly-x', `${sameRow && !active ? (index < selected ? -push : push) : 0}px`);
    chip.style.setProperty('--jelly-scale', active ? '1.12' : sameRow ? '.95' : '1');
    chip.style.setProperty('--jelly-delay', `${animate ? Math.min(88, Math.abs(index - selected) * 22) : 0}ms`);
  });
  if (animate && !reducedMotion.matches) {
    const skin = chips[selected].querySelector('.jelly-skin');
    skin.getAnimations().forEach((animation) => animation.cancel());
    skin.animate([
      {transform: 'scale(1, 1)'},
      {transform: 'scale(1.16, .85)', offset: .32},
      {transform: 'scale(.96, 1.07)', offset: .72},
      {transform: 'scale(1, 1)'}
    ], {duration: 480, easing: 'ease-out'});
  }
}
jellyGroup.addEventListener('change', (event) => {
  if (event.target.matches('input[name="quality"]')) updateJellySelection(true);
});
window.addEventListener('resize', () => updateJellySelection());
function showOptions(kind) {
  if (!inspection) return;
  const previousKind = downloadKind;
  downloadKind = kind;
  $('#video-mode-label').classList.toggle('active', kind === 'video');
  $('#audio-mode-label').classList.toggle('active', kind === 'audio');
  const mediaSwitch = $('#media-switch');
  mediaSwitch.toggleAttribute('data-on', kind === 'audio');
  mediaSwitch.setAttribute('aria-checked', String(kind === 'audio'));
  mediaSwitch.disabled = !inspection.options?.length || !inspection.audio_options?.length;
  if (previousKind !== kind && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    mediaSwitch.querySelector('.squish-thumb-face').animate([
      {transform:'scale(1, 1)'},
      {transform:'scale(1.34, .76)', offset:.38},
      {transform:'scale(.94, 1.06)', offset:.78},
      {transform:'scale(1, 1)'}
    ], {duration:440, easing:'ease-out'});
  }
  const options = kind === 'video' ? inspection.options : inspection.audio_options;
  $('#quality-heading').textContent = kind === 'video' ? 'Choose video quality' : 'Choose audio format';
  $('#quality-count').textContent = `${options.length} available`;
  $('#qualities').setAttribute('aria-label', kind === 'video' ? 'Video quality' : 'Audio format');
  $('#download-btn').innerHTML = kind === 'video' ? 'Prepare video download <span aria-hidden="true">↘</span>' : 'Prepare audio download <span aria-hidden="true">↘</span>';
  const container = $('#qualities');
  container.replaceChildren();
  options.forEach((option, index) => {
    const label = document.createElement('label');
    label.className = 'jelly-chip';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'quality'; input.value = option.id; input.checked = index === 0;
    const copy = document.createElement('span'); copy.className = 'jelly-skin';
    const strong = document.createElement('strong'); strong.textContent = option.label;
    const small = document.createElement('small'); small.textContent = [option.ext, size(option.size)].filter(Boolean).join(' · ');
    copy.append(strong, small); label.append(input, copy); container.append(label);
  });
  updateJellySelection();
}
const mediaSwitch = $('#media-switch');
let switchGrip = null;
let suppressSwitchClick = false;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
mediaSwitch.addEventListener('pointerdown', (event) => {
  if (mediaSwitch.disabled || event.button !== 0) return;
  switchGrip = {id:event.pointerId, startX:event.clientX, startKind:downloadKind, moved:false};
  mediaSwitch.setPointerCapture(event.pointerId);
  mediaSwitch.setAttribute('data-held', '');
});
mediaSwitch.addEventListener('pointermove', (event) => {
  if (!switchGrip || switchGrip.id !== event.pointerId) return;
  if (Math.abs(event.clientX - switchGrip.startX) > (event.pointerType === 'touch' ? 8 : 4)) switchGrip.moved = true;
  if (!switchGrip.moved) return;
  const rect = mediaSwitch.getBoundingClientRect();
  mediaSwitch.style.setProperty('--thumb-x', `${clamp(event.clientX - rect.left - 15, 4, 42)}px`);
});
function finishSwitch(event, cancelled = false) {
  if (!switchGrip || switchGrip.id !== event.pointerId) return;
  const grip = switchGrip;
  switchGrip = null;
  if (mediaSwitch.hasPointerCapture(event.pointerId)) mediaSwitch.releasePointerCapture(event.pointerId);
  mediaSwitch.removeAttribute('data-held');
  if (cancelled) showOptions(grip.startKind);
  else if (grip.moved) {
    const midpoint = mediaSwitch.getBoundingClientRect().left + 38;
    showOptions(event.clientX > midpoint ? 'audio' : 'video');
  } else showOptions(downloadKind === 'video' ? 'audio' : 'video');
  mediaSwitch.style.removeProperty('--thumb-x');
  suppressSwitchClick = true;
  setTimeout(() => { suppressSwitchClick = false; }, 0);
}
mediaSwitch.addEventListener('pointerup', (event) => finishSwitch(event));
mediaSwitch.addEventListener('pointercancel', (event) => finishSwitch(event, true));
mediaSwitch.addEventListener('click', () => {
  if (suppressSwitchClick) { suppressSwitchClick = false; return; }
  if (!mediaSwitch.disabled) showOptions(downloadKind === 'video' ? 'audio' : 'video');
});
function renderPreview(data) {
  const frame = $('#preview-frame');
  const note = $('#preview-note');
  frame.replaceChildren();
  note.replaceChildren();
  const preview = data.preview || {kind:'unavailable'};
  if (preview.kind === 'embed') {
    const player = document.createElement('iframe');
    player.src = preview.url;
    player.title = `Preview: ${data.title}`;
    player.loading = 'lazy';
    player.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
    player.allowFullscreen = true;
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.append(player);
    note.append('Playback uses the original site. The quality you choose below applies to the saved file.');
  } else if (preview.kind === 'video') {
    const player = document.createElement('video');
    player.src = preview.url;
    player.controls = true;
    player.preload = 'metadata';
    player.playsInline = true;
    if (data.thumbnail) player.poster = data.thumbnail;
    player.addEventListener('error', () => { note.firstChild.textContent = 'This source cannot play in the browser. You can still try downloading it. '; });
    frame.append(player);
    note.append('Preview playback uses the source file. The quality you choose below applies to the saved file.');
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'preview-fallback';
    if (data.thumbnail) {
      const poster = document.createElement('img');
      poster.src = data.thumbnail;
      poster.alt = '';
      fallback.append(poster);
    }
    const text = document.createElement('span');
    text.textContent = 'Browser preview unavailable for this source';
    fallback.append(text);
    frame.append(fallback);
    note.append('You can still choose a quality and prepare the download.');
  }
  if (data.webpage_url) {
    const link = document.createElement('a');
    link.href = data.webpage_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open at source ↗';
    note.append(' ', link);
  }
}
async function json(path, options) {
  if (android) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      androidRequests.set(id, {
        resolve: (data) => { serverState(true); if (path === '/api/health' && !data.ok) reject(new Error(data.error || 'Downloader could not start.')); else resolve(data); },
        reject: (error) => { serverState(false); reject(error); }
      });
      window.VideoDeskAndroid.request(id, path, options?.body || '{}');
    });
  }
  let response;
  try {
    response = await fetch(path, options);
    serverState(true);
  } catch {
    serverState(false);
    throw new Error(online ? 'Cannot reach the online downloader. Wait a moment and try again.' : 'Cannot reach the local downloader. Start start-windows.bat on a computer or start-android.sh in Termux, keep it running, then try again.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInterval(timer);
  clearMessage();
  result.hidden = true;
  $('#preview-frame').replaceChildren();
  $('#progress-panel').hidden = true;
  button.disabled = true;
  button.textContent = 'Checking link…';
  try {
    const data = await json('/api/inspect', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:$('#video-url').value})});
    token = data.token;
    inspection = data;
    $('#source').textContent = data.source;
    $('#title').textContent = data.title;
    $('#details').textContent = [duration(data.duration), `${data.options.length} video qualities`, data.audio_options?.length ? 'Audio only available' : null].filter(Boolean).join(' · ');
    renderPreview(data);
    showOptions(data.options.length ? 'video' : 'audio');
    result.hidden = false;
    result.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (error) { showMessage(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Find video <span aria-hidden="true">→</span>'; }
});
$('#download-btn').addEventListener('click', async () => {
  const chosen = document.querySelector('input[name="quality"]:checked');
  if (!chosen || !token) return;
  clearMessage();
  $('#download-btn').disabled = true;
  try {
    const kind = downloadKind;
    const data = await json('/api/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token, format_id:chosen.value, kind})});
    $('#progress-panel').hidden = false;
    $('#save-link').hidden = true;
    $('#progress-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
    const finished = await poll(data.job_id, kind);
    if (!finished) timer = setInterval(() => poll(data.job_id, kind), 1000);
  } catch (error) { showMessage(error.message); $('#download-btn').disabled = false; }
});
async function poll(jobId, kind) {
  try {
    const job = await json(`/api/jobs/${jobId}`);
    const percentage = Math.round(job.progress || 0);
    $('#percent').textContent = `${percentage}%`;
    $('#progress-fill').style.width = `${percentage}%`;
    if (job.status === 'ready') {
      clearInterval(timer);
      $('#progress-label').textContent = `Your ${kind} is ready`;
      $('#progress-note').textContent = [job.filename, size(job.size)].filter(Boolean).join(' · ');
      const link = $('#save-link');
      if (android) {
        link.href = '#open-saved-video';
        link.textContent = `Open saved ${kind}`;
        link.onclick = (event) => { event.preventDefault(); window.VideoDeskAndroid.openFile(jobId); };
      } else {
        link.href = `/api/jobs/${jobId}/file`;
        link.textContent = `Save ${kind} to this device ↓`;
      }
      link.hidden = false;
      $('#download-btn').disabled = false;
      return true;
    } else if (job.status === 'error') {
      clearInterval(timer);
      showMessage(job.error || 'Download failed.');
      $('#progress-panel').hidden = true;
      $('#download-btn').disabled = false;
      return true;
    } else {
      $('#progress-label').textContent = `Preparing your ${kind}…`;
    }
  } catch (error) { clearInterval(timer); showMessage(error.message); $('#download-btn').disabled = false; return true; }
  return false;
}
if (!android && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
json('/api/health').catch(() => {
  showMessage(android ? 'The downloader could not start. Reopen the app and try again.' : online ? 'The online downloader is unavailable. Please try again shortly.' : 'The local downloader is stopped. Start the launcher for this device, then try again.', 'info');
});
if (online) {
  document.querySelector('footer span:last-child').textContent = 'Online edition · Saves to this device';
  $('.helper').textContent = 'Public Internet Archive, YouTube, Vimeo, TikTok and Dailymotion videos · One video at a time';
  const sharedUrl = new URLSearchParams(location.search).get('url');
  if (sharedUrl) {
    $('#video-url').value = sharedUrl;
    form.requestSubmit();
  }
}
