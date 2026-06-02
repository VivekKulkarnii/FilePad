require('dotenv').config();
const express = require('express');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app    = express();
const PORT   = process.env.PORT || 3000;
const BUCKET = 'zip-files';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── Slug validation ──────────────────────────────────────────────────────────
const RESERVED = new Set(['api','uploads','static','health','favicon.ico']);
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
app.get('/api/:slug/info', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    let { data: space, error } = await supabase
      .from('spaces').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;

    // Handle expired
    if (space && space.expires_at && new Date(space.expires_at) < new Date()) {
      if (space.storage_path) await supabase.storage.from(BUCKET).remove([space.storage_path]);
      await supabase.from('spaces').delete().eq('slug', slug);
      space = null;
    }

    // Auto-create empty space
    if (!space) {
      const { data: created, error: e } = await supabase
        .from('spaces').insert({ slug }).select().single();
      if (e) throw e;
      space = created;
    }

    res.json({
      slug:              space.slug,
      hasFile:           !!space.filename,
      filename:          space.filename   || null,
      filesize:          space.filesize   || null,
      filesizeFormatted: fmtBytes(space.filesize),
      uploadedAt:        space.uploaded_at ? new Date(space.uploaded_at).getTime() : null,
      createdAt:         space.created_at  ? new Date(space.created_at).getTime()  : null,
      expiresAt:         space.expires_at  ? new Date(space.expires_at).getTime()  : null,
      downloads:         space.downloads   || 0
    });
  } catch (err) {
    console.error('info error:', err.message);
    res.status(500).json({ error: 'Failed to load space.' });
  }
});

// ─── POST /api/:slug/upload-url ───────────────────────────────────────────────
// Returns a signed URL so the browser can upload directly to Supabase Storage.
// This bypasses Vercel's 4.5MB body limit entirely.
app.post('/api/:slug/upload-url', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const storagePath = `${slug}/${Date.now()}-${uuidv4()}.zip`;

  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUploadUrl(storagePath);

  if (error) {
    console.error('upload-url error:', error.message);
    return res.status(500).json({ error: 'Could not generate upload URL.' });
  }

  res.json({ signedUrl: data.signedUrl, storagePath });
});

// ─── POST /api/:slug/confirm ──────────────────────────────────────────────────
// Called after the browser finishes the direct Supabase upload.
// Updates the DB with file metadata.
app.post('/api/:slug/confirm', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const { filename, filesize, storagePath } = req.body;
  if (!filename || !filesize || !storagePath)
    return res.status(400).json({ error: 'Missing fields.' });

  // Ensure storagePath belongs to this slug (prevents spoofing other spaces)
  if (!storagePath.startsWith(`${slug}/`))
    return res.status(403).json({ error: 'Invalid storage path.' });

  try {
    // Delete old file if one exists
    const { data: existing } = await supabase
      .from('spaces').select('storage_path').eq('slug', slug).maybeSingle();
    if (existing && existing.storage_path && existing.storage_path !== storagePath) {
      await supabase.storage.from(BUCKET).remove([existing.storage_path]);
    }

    const now       = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: updated, error } = await supabase
      .from('spaces')
      .update({ filename, filesize, storage_path: storagePath, uploaded_at: now, expires_at: expiresAt, downloads: 0 })
      .eq('slug', slug)
      .select().single();

    if (error) throw error;

    res.json({
      success:           true,
      filename:          updated.filename,
      filesize:          updated.filesize,
      filesizeFormatted: fmtBytes(updated.filesize),
      uploadedAt:        new Date(updated.uploaded_at).getTime(),
      expiresAt:         new Date(updated.expires_at).getTime(),
      downloads:         0
    });
  } catch (err) {
    console.error('confirm error:', err.message);
    res.status(500).json({ error: 'Failed to confirm upload.' });
  }
});

// ─── GET /api/:slug/download ──────────────────────────────────────────────────
app.get('/api/:slug/download', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    const { data: space, error } = await supabase
      .from('spaces').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (!space || !space.storage_path) return res.status(404).json({ error: 'No file found.' });

    if (space.expires_at && new Date(space.expires_at) < new Date()) {
      await supabase.storage.from(BUCKET).remove([space.storage_path]);
      await supabase.from('spaces').delete().eq('slug', slug);
      return res.status(410).json({ error: 'File has expired.' });
    }

    await supabase.from('spaces')
      .update({ downloads: (space.downloads || 0) + 1 }).eq('slug', slug);

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET).createSignedUrl(space.storage_path, 60, { download: space.filename });

    if (signErr) throw signErr;
    res.redirect(signed.signedUrl);
  } catch (err) {
    console.error('download error:', err.message);
    res.status(500).json({ error: 'Download failed.' });
  }
});

// ─── DELETE /api/:slug/file ───────────────────────────────────────────────────
app.delete('/api/:slug/file', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    const { data: space } = await supabase
      .from('spaces').select('storage_path').eq('slug', slug).maybeSingle();
    if (space && space.storage_path)
      await supabase.storage.from(BUCKET).remove([space.storage_path]);
    await supabase.from('spaces')
      .update({ filename: null, filesize: null, storage_path: null, uploaded_at: null, expires_at: null, downloads: 0 })
      .eq('slug', slug);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('/:slug', (req, res) => {
  if (!isValid(req.params.slug)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'space.html'));
});

// ─── Export for Vercel; listen locally when run directly ─────────────────────
module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`\n🗜️  FilePad → http://localhost:${PORT}\n`));
}
