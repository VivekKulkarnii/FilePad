const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Directories & DB ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_PATH     = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Simple JSON store
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return {}; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Expiry Cleanup ───────────────────────────────────────────────────────────
function cleanupExpired() {
  const db  = readDB();
  const now = Date.now();
  let changed = false;
  for (const [slug, space] of Object.entries(db)) {
    if (space.expiresAt && space.expiresAt < now) {
      if (space.filepath && fs.existsSync(space.filepath)) fs.unlinkSync(space.filepath);
      delete db[slug];
      changed = true;
      console.log(`[cleanup] Expired: ${slug}`);
    }
  }
  if (changed) writeDB(db);
}
cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000);

// ─── Multer ───────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}.zip`)
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    const ok   = ext === '.zip' ||
      ['application/zip','application/x-zip-compressed','application/x-zip','multipart/x-zip','application/octet-stream']
        .includes(mime);
    ok ? cb(null, true) : cb(new Error('INVALID_FILE_TYPE'));
  }
});

// ─── Slug Validation ──────────────────────────────────────────────────────────
const RESERVED = new Set(['api','uploads','static','health','favicon.ico','data.json']);
const SLUG_RE  = /^[a-z0-9][a-z0-9\-_]{0,63}$/i;
function isValid(slug) { return SLUG_RE.test(slug) && !RESERVED.has(slug.toLowerCase()); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── GET /api/:slug/info ──────────────────────────────────────────────────────
app.get('/api/:slug/info', (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const db  = readDB();
  let space = db[slug];
  const now = Date.now();

  // Handle expired
  if (space && space.expiresAt && space.expiresAt < now) {
    if (space.filepath && fs.existsSync(space.filepath)) fs.unlinkSync(space.filepath);
    delete db[slug];
    writeDB(db);
    space = null;
  }

  // Auto-create space
  if (!space) {
    space = { slug, createdAt: now };
    db[slug] = space;
    writeDB(db);
  }

  res.json({
    slug:             space.slug,
    hasFile:          !!space.filename,
    filename:         space.filename    || null,
    filesize:         space.filesize    || null,
    filesizeFormatted: fmtBytes(space.filesize),
    uploadedAt:       space.uploadedAt  || null,
    createdAt:        space.createdAt,
    expiresAt:        space.expiresAt   || null,
    downloads:        space.downloads   || 0
  });
});

// ─── POST /api/:slug/upload ───────────────────────────────────────────────────
app.post('/api/:slug/upload', (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') return res.status(400).json({ error: 'Only ZIP files are accepted.' });
      if (err.code === 'LIMIT_FILE_SIZE')       return res.status(400).json({ error: `File too large. Maximum is ${fmtBytes(MAX_FILE_SIZE)}.` });
      return res.status(500).json({ error: 'Upload failed.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    // Verify ZIP magic bytes (PK header: 0x50 0x4B)
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(req.file.path, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File does not appear to be a valid ZIP archive.' });
    }

    // Delete old file
    const db = readDB();
    const existing = db[slug];
    if (existing && existing.filepath && fs.existsSync(existing.filepath)) {
      fs.unlinkSync(existing.filepath);
    }

    const now = Date.now();
    db[slug] = {
      slug,
      filename:  req.file.originalname,
      filesize:  req.file.size,
      filepath:  req.file.path,
      createdAt: existing ? existing.createdAt : now,
      uploadedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      downloads: 0
    };
    writeDB(db);

    const s = db[slug];
    res.json({
      success: true,
      filename:          s.filename,
      filesize:          s.filesize,
      filesizeFormatted: fmtBytes(s.filesize),
      uploadedAt:        s.uploadedAt,
      expiresAt:         s.expiresAt,
      downloads:         0
    });
  });
});

// ─── GET /api/:slug/download ──────────────────────────────────────────────────
app.get('/api/:slug/download', (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const db    = readDB();
  const space = db[slug];

  if (!space || !space.filename) return res.status(404).json({ error: 'No file found.' });
  if (space.expiresAt && space.expiresAt < Date.now()) {
    if (space.filepath && fs.existsSync(space.filepath)) fs.unlinkSync(space.filepath);
    delete db[slug];
    writeDB(db);
    return res.status(410).json({ error: 'File has expired.' });
  }
  if (!fs.existsSync(space.filepath)) return res.status(404).json({ error: 'File not found on server.' });

  space.downloads = (space.downloads || 0) + 1;
  writeDB(db);

  res.setHeader('Content-Disposition', `attachment; filename="${space.filename}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', space.filesize);
  fs.createReadStream(space.filepath).pipe(res);
});

// ─── DELETE /api/:slug/file ───────────────────────────────────────────────────
app.delete('/api/:slug/file', (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const db = readDB();
  const space = db[slug];
  if (!space) return res.status(404).json({ error: 'Space not found.' });

  if (space.filepath && fs.existsSync(space.filepath)) fs.unlinkSync(space.filepath);

  db[slug] = { slug, createdAt: space.createdAt };
  writeDB(db);
  res.json({ success: true });
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('/:slug', (req, res) => {
  if (!isValid(req.params.slug)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'space.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`\n🗜️  FilePad → http://localhost:${PORT}\n`));
