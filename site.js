const $ = (selector) => document.querySelector(selector);
const form = $('#inspect-form');
const input = $('#video-url');
const result = $('#result');
const message = $('#message');
const progress = $('#progress-panel');
const downloadButton = $('#download-btn');
let selectedFile = null;

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);
const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac']);

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = '';
}

function fileName(path) {
  const last = path.split('/').filter(Boolean).pop() || '';
  try { return decodeURIComponent(last); } catch { return last; }
}

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 180) || 'media-file';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(1)} GB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

function inspect(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('Enter a valid video or audio URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a public http or https media link without login details.');
  }
  const name = fileName(url.pathname);
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const kind = videoExtensions.has(extension) ? 'video' : audioExtensions.has(extension) ? 'audio' : null;
  if (!kind) {
    throw new Error('This browser edition needs a direct media file link, such as .mp4, .webm, .mp3, or .m4a. For video page links, use the Android or Windows app.');
  }
  return { url, name: safeFileName(name), kind };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearMessage();
  result.hidden = true;
  progress.hidden = true;
  selectedFile = null;
  try {
    selectedFile = inspect(input.value);
    $('#source').textContent = selectedFile.url.hostname;
    $('#title').textContent = selectedFile.name;
    $('#details').textContent = `${selectedFile.kind === 'video' ? 'Video' : 'Audio'} · Direct file link`;
    const player = document.createElement(selectedFile.kind);
    player.controls = true;
    player.preload = 'metadata';
    player.src = selectedFile.url.href;
    $('#preview-frame').replaceChildren(player);
    $('#preview-note').textContent = 'Preview depends on your browser and the file format. You can still try downloading if it does not play.';
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showMessage(error.message);
  }
});

function setProgress(done, total) {
  const percent = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  $('#percent').textContent = total > 0 ? `${percent}%` : formatBytes(done);
  $('#progress-fill').style.width = `${percent}%`;
}

downloadButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  clearMessage();
  progress.hidden = false;
  $('#progress-label').textContent = 'Downloading file…';
  $('#progress-note').textContent = 'Keep this page open until the save dialog appears.';
  $('#save-link').hidden = true;
  setProgress(0, 0);
  downloadButton.disabled = true;
  try {
    const response = await fetch(selectedFile.url.href, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) throw new Error('That URL returned a web page rather than a media file.');
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('This browser could not read the file.');
    const chunks = [];
    let done = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      done += next.value.byteLength;
      setProgress(done, total);
    }
    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: type || 'application/octet-stream' }));
    const link = $('#save-link');
    link.href = blobUrl;
    link.download = selectedFile.name;
    link.hidden = false;
    $('#progress-label').textContent = 'File ready';
    $('#progress-note').textContent = 'Choose Save file if your browser did not start the download automatically.';
    setProgress(done, done);
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  } catch (error) {
    progress.hidden = true;
    showMessage(`${error.message || 'Could not download this file.'} If the source blocks browser access, use the installed VideoDesk app.`);
  } finally {
    downloadButton.disabled = false;
  }
});
