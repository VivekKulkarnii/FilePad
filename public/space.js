/* space.js – Multi-file space logic */

const slug = location.pathname.replace(/^\//, '').split('/')[0];

// ─── Elements ────────────────────────────────────────────────────────────────
const loadingState   = document.getElementById('loadingState');
const errorState     = document.getElementById('errorState');
const uploadState    = document.getElementById('uploadState');
const downloadState  = document.getElementById('downloadState');

const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const uploadQueue    = document.getElementById('uploadQueue');
const uploadError    = document.getElementById('uploadError');
const uploadErrorMsg = document.getElementById('uploadErrorMsg');

const uploadMoreBtn   = document.getElementById('uploadMoreBtn');
const uploadMoreZone  = document.getElementById('uploadMoreZone');
const moreDropZone    = document.getElementById('moreDropZone');
const moreFileInput   = document.getElementById('moreFileInput');
const moreUploadQueue = document.getElementById('moreUploadQueue');
const moreUploadError = document.getElementById('moreUploadError');
const moreUploadErrorMsg = document.getElementById('moreUploadErrorMsg');

const copyLinkBtn  = document.getElementById('copyLinkBtn');
const filesList    = document.getElementById('filesList');
const filesTitle   = document.getElementById('filesTitle');
const toast        = document.getElementById('toast');
const toastMsg     = document.getElementById('toastMsg');
const spaceUrlText = document.getElementById('spaceUrlText');
const copyBtnSmall = document.getElementById('copyBtnSmall');

// ─── State ────────────────────────────────────────────────────────────────────
let spaceFiles = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showOnly(el) {
  [loadingState, errorState, uploadState, downloadState].forEach(e => e.classList.add('hidden'));
  el.classList.remove('hidden');
}

function showToast(msg, isError = false) {
  toastMsg.textContent = msg;
  toast.style.color = isError ? 'var(--red)' : 'var(--green)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatExpiry(ts) {
  if (!ts) return '';
  const days = Math.floor((ts - Date.now()) / 86400000);
  if (days <= 0) return 'Expired';
  return `${days}d left`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Link copied!'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Link copied!');
    });
}

// ─── Render files list ────────────────────────────────────────────────────────
function renderFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.id = file.id;
  item.innerHTML = `
    <div class="file-item-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
    </div>
    <div class="file-item-info">
      <div class="file-item-name" title="${file.filename}">${file.filename}</div>
      <div class="file-item-meta">
        <span>${file.filesizeFormatted}</span>
        <span class="meta-dot">·</span>
        <span>${formatRelative(file.uploadedAt)}</span>
        <span class="meta-dot">·</span>
        <span>${file.downloads} download${file.downloads !== 1 ? 's' : ''}</span>
        ${file.expiresAt ? `<span class="meta-dot">·</span><span class="expiry-badge">${formatExpiry(file.expiresAt)}</span>` : ''}
      </div>
    </div>
    <div class="file-item-actions">
      <a href="/api/${encodeURIComponent(slug)}/download/${file.id}" class="btn btn-primary btn-sm" target="_blank">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </a>
      <button class="btn btn-ghost btn-sm btn-danger" data-delete="${file.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  `;
  // Delete handler
  item.querySelector('[data-delete]').addEventListener('click', () => deleteFile(file.id, item));
  return item;
}

function renderSpace(data) {
  document.title = `FilePad – ${slug}`;
  spaceUrlText.textContent = location.host + '/' + slug;
  document.getElementById('slugBadgeUpload').textContent   = slug;
  document.getElementById('slugBadgeDownload').textContent = slug;

  spaceFiles = data.files || [];

  if (spaceFiles.length === 0) {
    showOnly(uploadState);
  } else {
    filesTitle.textContent = `${spaceFiles.length} File${spaceFiles.length !== 1 ? 's' : ''} Ready`;
    filesList.innerHTML = '';
    spaceFiles.forEach(f => filesList.appendChild(renderFileItem(f)));
    showOnly(downloadState);
  }
}

// ─── Add a single file to the list (after upload) ─────────────────────────────
function addFileToList(file) {
  spaceFiles.unshift(file);
  filesTitle.textContent = `${spaceFiles.length} File${spaceFiles.length !== 1 ? 's' : ''} Ready`;
  filesList.insertBefore(renderFileItem(file), filesList.firstChild);
  showOnly(downloadState);
}

// ─── Delete a file ────────────────────────────────────────────────────────────
async function deleteFile(fileId, itemEl) {
  itemEl.style.opacity = '0.5';
  itemEl.style.pointerEvents = 'none';

  try {
    const r = await fetch(`/api/${encodeURIComponent(slug)}/file/${fileId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed.');
    itemEl.remove();
    spaceFiles = spaceFiles.filter(f => f.id !== fileId);
    filesTitle.textContent = `${spaceFiles.length} File${spaceFiles.length !== 1 ? 's' : ''} Ready`;
    if (spaceFiles.length === 0) showOnly(uploadState);
    showToast('File deleted.');
  } catch {
    itemEl.style.opacity = '1';
    itemEl.style.pointerEvents = '';
    showToast('Could not delete file.', true);
  }
}

// ─── Upload engine ────────────────────────────────────────────────────────────
async function uploadFiles(files, queueEl, errorEl, errorMsgEl) {
  const valid = [];
  const errors = [];

  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'zip') { errors.push(`${file.name}: not a ZIP file.`); continue; }
    if (file.size > 500 * 1024 * 1024) { errors.push(`${file.name}: exceeds 500 MB.`); continue; }
    try {
      const buf = await file.slice(0, 4).arrayBuffer();
      const b = new Uint8Array(buf);
      if (b[0] !== 0x50 || b[1] !== 0x4B) { errors.push(`${file.name}: not a valid ZIP.`); continue; }
    } catch { errors.push(`${file.name}: could not validate.`); continue; }
    valid.push(file);
  }

  if (errors.length) {
    errorMsgEl.textContent = errors.join(' ');
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
  }

  if (valid.length === 0) return;

  queueEl.classList.remove('hidden');

  for (let i = 0; i < valid.length; i++) {
    const file = valid[i];
    const label = valid.length > 1 ? `(${i + 1}/${valid.length}) ${file.name}` : file.name;

    // Create progress row
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `
      <div class="progress-header">
        <span class="progress-filename">${label}</span>
        <span class="progress-percent" id="pct-${i}">0%</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="fill-${i}" style="width:0%"></div>
      </div>
      <p class="progress-status" id="status-${i}">Preparing…</p>
    `;
    queueEl.appendChild(row);

    const fill   = row.querySelector(`#fill-${i}`);
    const pct    = row.querySelector(`#pct-${i}`);
    const status = row.querySelector(`#status-${i}`);

    try {
      // Get signed URL
      const r1 = await fetch(`/api/${encodeURIComponent(slug)}/upload-url`, { method: 'POST' });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error || 'Failed to get upload URL.');
      status.textContent = 'Uploading…';

      // Upload directly to Supabase
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', d1.signedUrl);
        xhr.setRequestHeader('Content-Type', 'application/zip');
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const p = Math.round((e.loaded / e.total) * 100);
            fill.style.width = p + '%';
            pct.textContent  = p + '%';
            status.textContent = p < 100 ? 'Uploading…' : 'Finalizing…';
          }
        });
        xhr.addEventListener('load', () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed (status ' + xhr.status + ').')));
        xhr.addEventListener('error', () => reject(new Error('Network error.')));
        xhr.send(file);
      });

      status.textContent = 'Saving…';

      // Confirm with server
      const r2 = await fetch(`/api/${encodeURIComponent(slug)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, filesize: file.size, storagePath: d1.storagePath })
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error || 'Confirm failed.');

      fill.style.width   = '100%';
      pct.textContent    = '100%';
      status.textContent = '✓ Done';
      row.classList.add('queue-item-done');

      addFileToList(d2.file);
    } catch (err) {
      status.textContent = '✗ ' + err.message;
      row.classList.add('queue-item-error');
    }
  }

  // Clear queue after a delay
  setTimeout(() => {
    queueEl.innerHTML = '';
    queueEl.classList.add('hidden');
    uploadMoreZone.classList.add('hidden');
  }, 2000);
}

// ─── Setup drop zone ──────────────────────────────────────────────────────────
function setupDropZone(zone, input, queueEl, errorEl, errorMsgEl) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) uploadFiles(Array.from(e.dataTransfer.files), queueEl, errorEl, errorMsgEl);
  });
  input.addEventListener('change', () => {
    if (input.files.length) { uploadFiles(Array.from(input.files), queueEl, errorEl, errorMsgEl); input.value = ''; }
  });
}

setupDropZone(dropZone, fileInput, uploadQueue, uploadError, uploadErrorMsg);
setupDropZone(moreDropZone, moreFileInput, moreUploadQueue, moreUploadError, moreUploadErrorMsg);

// ─── Upload More button ───────────────────────────────────────────────────────
uploadMoreBtn.addEventListener('click', () => {
  uploadMoreZone.classList.toggle('hidden');
});

// ─── Copy link ────────────────────────────────────────────────────────────────
copyLinkBtn.addEventListener('click',  () => copyToClipboard(location.href));
copyBtnSmall.addEventListener('click', () => copyToClipboard(location.href));

// ─── Load ─────────────────────────────────────────────────────────────────────
async function loadSpace() {
  showOnly(loadingState);
  try {
    const res  = await fetch(`/api/${encodeURIComponent(slug)}/info`);
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('errorMessage').textContent = data.error || 'An error occurred.';
      showOnly(errorState);
      return;
    }
    renderSpace(data);
  } catch {
    document.getElementById('errorMessage').textContent = 'Could not connect to server.';
    showOnly(errorState);
  }
}

if (!slug) { location.href = '/'; } else { loadSpace(); }
