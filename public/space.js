/* space.js – Sharing space page logic */

const slug = location.pathname.replace(/^\//, '').split('/')[0];

// ─── Elements ────────────────────────────────────────────────────────────────
const loadingState   = document.getElementById('loadingState');
const errorState     = document.getElementById('errorState');
const expiredState   = document.getElementById('expiredState');
const uploadState    = document.getElementById('uploadState');
const downloadState  = document.getElementById('downloadState');

// Upload
const dropZone       = document.getElementById('dropZone');
const dropZoneInner  = document.getElementById('dropZoneInner');
const fileInput      = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadError    = document.getElementById('uploadError');
const uploadErrorMsg = document.getElementById('uploadErrorMsg');

// Replace
const replaceToggle    = document.getElementById('replaceToggle');
const replaceZone      = document.getElementById('replaceZone');
const replaceDropZone  = document.getElementById('replaceDropZone');
const replaceFileInput = document.getElementById('replaceFileInput');
const replaceProgress  = document.getElementById('replaceProgress');
const replaceError     = document.getElementById('replaceError');
const replaceErrorMsg  = document.getElementById('replaceErrorMsg');

// Download
const downloadBtn    = document.getElementById('downloadBtn');
const copyLinkBtn    = document.getElementById('copyLinkBtn');
const expiredUploadBtn = document.getElementById('expiredUploadBtn');

// Toast
const toast    = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');

// Nav
const spaceUrlText = document.getElementById('spaceUrlText');
const copyBtnSmall = document.getElementById('copyBtnSmall');

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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatExpiry(ts) {
  if (!ts) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'Expires in less than a day';
  return `Expires in ${days} day${days !== 1 ? 's' : ''}`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Link copied!')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Link copied!');
  });
}

// ─── Render Space ─────────────────────────────────────────────────────────────
function renderSpace(data) {
  spaceData = data;
  document.title = `FilePad – ${slug}`;
  spaceUrlText.textContent = location.host + '/' + slug;

  // Slug badges
  document.getElementById('slugBadgeUpload').textContent   = slug;
  document.getElementById('slugBadgeDownload').textContent = slug;

  if (!data.hasFile) {
    showOnly(uploadState);
  } else {
    // File card
    document.getElementById('fileName').textContent     = data.filename;
    document.getElementById('fileSize').textContent     = data.filesizeFormatted;
    document.getElementById('fileUploaded').textContent = formatRelative(data.uploadedAt);
    document.getElementById('fileDownloads').textContent = `${data.downloads} download${data.downloads !== 1 ? 's' : ''}`;
    document.getElementById('fileExpiry').textContent   = formatExpiry(data.expiresAt);
    downloadBtn.href = `/api/${slug}/download`;
    showOnly(downloadState);
  }
}

// ─── Load Space ───────────────────────────────────────────────────────────────
async function loadSpace() {
  showOnly(loadingState);
  try {
    const res = await fetch(`/api/${encodeURIComponent(slug)}/info`);
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

// ─── Upload Logic ─────────────────────────────────────────────────────────────
function setupDropZone(zone, input, progressEl, errorEl, errorMsgEl, progressFill, progressPct, progressStatus, progressFilename, onSuccess) {

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

  function handleFile(file) {
    errorEl.classList.add('hidden');

    // Client-side type check
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'zip') {
      showError('Only ZIP files are accepted. Please select a .zip file.');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      showError('File exceeds 500 MB limit.');
      return;
    }

    zone.classList.add('hidden');
    progressEl.classList.remove('hidden');

    progressFilename.textContent = file.name;
    progressPct.textContent = '0%';
    progressFill.style.width = '0%';
    progressStatus.textContent = 'Uploading…';

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/${encodeURIComponent(slug)}/upload`);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = pct + '%';
        progressPct.textContent  = pct + '%';
        progressStatus.textContent = pct < 100 ? 'Uploading…' : 'Processing…';
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          progressStatus.textContent = 'Done!';
          progressFill.style.width = '100%';
          progressPct.textContent = '100%';
          setTimeout(() => {
            progressEl.classList.add('hidden');
            onSuccess(data);
          }, 600);
        } else {
          progressEl.classList.add('hidden');
          zone.classList.remove('hidden');
          showError(data.error || 'Upload failed.');
        }
      } catch {
        progressEl.classList.add('hidden');
        zone.classList.remove('hidden');
        showError('Upload failed. Please try again.');
      }
      input.value = '';
    });

    xhr.addEventListener('error', () => {
      progressEl.classList.add('hidden');
      zone.classList.remove('hidden');
      showError('Network error. Please try again.');
      input.value = '';
    });

    xhr.send(formData);
  }

  function showError(msg) {
    errorMsgEl.textContent = msg;
    errorEl.classList.remove('hidden');
    zone.classList.remove('hidden');
  }
}

// ─── Wire up Upload zone ──────────────────────────────────────────────────────
setupDropZone(
  dropZone, fileInput,
  uploadProgress, uploadError, uploadErrorMsg,
  document.getElementById('progressBarFill'),
  document.getElementById('progressPercent'),
  document.getElementById('progressStatus'),
  document.getElementById('progressFilename'),
  (data) => {
    renderSpace({ ...spaceData, hasFile: true, ...data });
    showToast('File uploaded successfully!');
  }
);

// ─── Wire up Replace zone ─────────────────────────────────────────────────────
replaceToggle.addEventListener('click', () => {
  const open = !replaceZone.classList.contains('hidden');
  replaceZone.classList.toggle('hidden', open);
});

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

// ─── Copy link buttons ────────────────────────────────────────────────────────
const spaceUrl = location.href;

copyLinkBtn.addEventListener('click', () => copyToClipboard(spaceUrl));
copyBtnSmall.addEventListener('click', () => copyToClipboard(spaceUrl));

// ─── Expired upload button ────────────────────────────────────────────────────
expiredUploadBtn.addEventListener('click', () => {
  renderSpace({ ...spaceData, hasFile: false });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
if (!slug) {
  location.href = '/';
} else {
  loadSpace();
}
