/* space.js – Sharing space page logic */

const slug = location.pathname.replace(/^\//, '').split('/')[0];

// ─── Elements ────────────────────────────────────────────────────────────────
const loadingState   = document.getElementById('loadingState');
const errorState     = document.getElementById('errorState');
const expiredState   = document.getElementById('expiredState');
const uploadState    = document.getElementById('uploadState');
const downloadState  = document.getElementById('downloadState');

const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadError    = document.getElementById('uploadError');
const uploadErrorMsg = document.getElementById('uploadErrorMsg');

const replaceToggle    = document.getElementById('replaceToggle');
const replaceZone      = document.getElementById('replaceZone');
const replaceDropZone  = document.getElementById('replaceDropZone');
const replaceFileInput = document.getElementById('replaceFileInput');
const replaceProgress  = document.getElementById('replaceProgress');
const replaceError     = document.getElementById('replaceError');
const replaceErrorMsg  = document.getElementById('replaceErrorMsg');

const downloadBtn      = document.getElementById('downloadBtn');
const copyLinkBtn      = document.getElementById('copyLinkBtn');
const expiredUploadBtn = document.getElementById('expiredUploadBtn');
const toast            = document.getElementById('toast');
const toastMsg         = document.getElementById('toastMsg');
const spaceUrlText     = document.getElementById('spaceUrlText');
const copyBtnSmall     = document.getElementById('copyBtnSmall');

// ─── State ────────────────────────────────────────────────────────────────────
let spaceData = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showOnly(el) {
  [loadingState, errorState, expiredState, uploadState, downloadState]
    .forEach(e => e.classList.add('hidden'));
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
  return `Expires in ${days} day${days !== 1 ? 's' : ''}`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Link copied!'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Link copied!');
    });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderSpace(data) {
  spaceData = data;
  document.title = `FilePad – ${slug}`;
  spaceUrlText.textContent = location.host + '/' + slug;
  document.getElementById('slugBadgeUpload').textContent   = slug;
  document.getElementById('slugBadgeDownload').textContent = slug;

  if (!data.hasFile) {
    showOnly(uploadState);
  } else {
    document.getElementById('fileName').textContent      = data.filename;
    document.getElementById('fileSize').textContent      = data.filesizeFormatted;
    document.getElementById('fileUploaded').textContent  = formatRelative(data.uploadedAt);
    document.getElementById('fileDownloads').textContent = `${data.downloads} download${data.downloads !== 1 ? 's' : ''}`;
    document.getElementById('fileExpiry').textContent    = formatExpiry(data.expiresAt);
    downloadBtn.href = `/api/${slug}/download`;
    showOnly(downloadState);
  }
}

// ─── Load Space ───────────────────────────────────────────────────────────────
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

// ─── Upload Flow (direct to Supabase, bypasses server body limit) ─────────────
function setupDropZone(zone, input, progressEl, errorEl, errorMsgEl,
                       progressFill, progressPct, progressStatus, progressFilename,
                       onSuccess) {

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

  async function handleFile(file) {
    errorEl.classList.add('hidden');

    // ── 1. Client-side validation ────────────────────────────────────────────
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'zip') { showErr('Only ZIP files are accepted. Please select a .zip file.'); return; }
    if (file.size > 500 * 1024 * 1024) { showErr('File exceeds the 500 MB limit.'); return; }

    // Validate ZIP magic bytes (PK header: 0x50 0x4B) in the browser
    try {
      const buf   = await file.slice(0, 4).arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
        showErr('File does not appear to be a valid ZIP archive.');
        return;
      }
    } catch { showErr('Could not validate file.'); return; }

    // ── Show progress ────────────────────────────────────────────────────────
    zone.classList.add('hidden');
    progressEl.classList.remove('hidden');
    progressFilename.textContent = file.name;
    progressPct.textContent      = '0%';
    progressFill.style.width     = '0%';
    progressStatus.textContent   = 'Preparing…';

    // ── 2. Get signed upload URL from our server ─────────────────────────────
    let signedUrl, storagePath;
    try {
      const r = await fetch(`/api/${encodeURIComponent(slug)}/upload-url`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to get upload URL.');
      signedUrl   = d.signedUrl;
      storagePath = d.storagePath;
    } catch (err) {
      reset(); showErr(err.message); return;
    }

    progressStatus.textContent = 'Uploading…';

    // ── 3. Upload directly to Supabase Storage (XHR for progress) ───────────
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', 'application/zip');

        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            progressFill.style.width = pct + '%';
            progressPct.textContent  = pct + '%';
            progressStatus.textContent = pct < 100 ? 'Uploading…' : 'Finalizing…';
          }
        });

        xhr.addEventListener('load', () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Storage upload failed (status ' + xhr.status + ').'))
        );
        xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
        xhr.send(file);
      });
    } catch (err) {
      reset(); showErr(err.message); return;
    }

    progressStatus.textContent = 'Saving…';

    // ── 4. Confirm with server → update DB ───────────────────────────────────
    try {
      const r = await fetch(`/api/${encodeURIComponent(slug)}/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: file.name, filesize: file.size, storagePath })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Confirm failed.');

      progressFill.style.width   = '100%';
      progressPct.textContent    = '100%';
      progressStatus.textContent = 'Done!';

      setTimeout(() => { progressEl.classList.add('hidden'); onSuccess(data); }, 600);
    } catch (err) {
      reset(); showErr(err.message);
    }

    input.value = '';
  }

  function reset() { progressEl.classList.add('hidden'); zone.classList.remove('hidden'); }
  function showErr(msg) { errorMsgEl.textContent = msg; errorEl.classList.remove('hidden'); }
}

// ─── Wire: Upload zone ────────────────────────────────────────────────────────
setupDropZone(
  dropZone, fileInput,
  uploadProgress, uploadError, uploadErrorMsg,
  document.getElementById('progressBarFill'),
  document.getElementById('progressPercent'),
  document.getElementById('progressStatus'),
  document.getElementById('progressFilename'),
  (data) => { renderSpace({ ...spaceData, hasFile: true, ...data }); showToast('File uploaded successfully!'); }
);

// ─── Wire: Replace zone ───────────────────────────────────────────────────────
replaceToggle.addEventListener('click', () => replaceZone.classList.toggle('hidden'));

setupDropZone(
  replaceDropZone, replaceFileInput,
  replaceProgress, replaceError, replaceErrorMsg,
  document.getElementById('replaceProgressBarFill'),
  document.getElementById('replaceProgressPercent'),
  document.getElementById('replaceProgressStatus'),
  document.getElementById('replaceProgressFilename'),
  (data) => {
    replaceZone.classList.add('hidden');
    renderSpace({ ...spaceData, hasFile: true, ...data });
    showToast('File replaced successfully!');
  }
);

// ─── Copy link ────────────────────────────────────────────────────────────────
copyLinkBtn.addEventListener('click',  () => copyToClipboard(location.href));
copyBtnSmall.addEventListener('click', () => copyToClipboard(location.href));

// ─── Expired upload ───────────────────────────────────────────────────────────
expiredUploadBtn.addEventListener('click', () => renderSpace({ ...spaceData, hasFile: false }));

// ─── Init ─────────────────────────────────────────────────────────────────────
if (!slug) { location.href = '/'; } else { loadSpace(); }
