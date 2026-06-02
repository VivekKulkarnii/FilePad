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

// ─── Validation ───────────────────────────────────────────────────────────────
const RESERVED = new Set(['api','uploads','static','health','favicon.ico']);
const SLUG_RE  = /^[a-z0-9][a-z0-9\-_]{0,63}$/i;
function isValid(slug) { return SLUG_RE.test(slug) && !RESERVED.has(slug.toLowerCase()); }

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

function fileToJson(f) {
  return {
    id:                f.id,
    filename:          f.filename,
    filesize:          f.filesize,
    filesizeFormatted: fmtBytes(f.filesize),
    uploadedAt:        f.uploaded_at  ? new Date(f.uploaded_at).getTime()  : null,
    expiresAt:         f.expires_at   ? new Date(f.expires_at).getTime()   : null,
    downloads:         f.downloads    || 0
  };
}

// ─── Cleanup expired files ─────────────────────────────────────────────────────
async function cleanupExpired() {
  const { data: expired } = await supabase
    .from('files')
    .select('id, space_slug, storage_path')
    .lt('expires_at', new Date().toISOString());

  if (!expired || expired.length === 0) return;

  const paths = expired.map(f => f.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const ids = expired.map(f => f.id);
  await supabase.from('files').delete().in('id', ids);
  console.log(`[cleanup] Removed ${expired.length} expired file(s).`);
}

cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── GET /api/:slug/info ──────────────────────────────────────────────────────
app.get('/api/:slug/info', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    // Get or create space
    let { data: space, error } = await supabase
      .from('spaces').select('slug, created_at').eq('slug', slug).maybeSingle();
    if (error) throw error;

    if (!space) {
      const { data: created, error: e } = await supabase
        .from('spaces').insert({ slug }).select('slug, created_at').single();
      if (e) throw e;
      space = created;
    }

    // Get all files for this space
    const { data: files, error: fe } = await supabase
      .from('files')
      .select('*')
      .eq('space_slug', slug)
      .order('uploaded_at', { ascending: false });
    if (fe) throw fe;

    res.json({
      slug:      space.slug,
      createdAt: space.created_at ? new Date(space.created_at).getTime() : null,
      hasFiles:  files.length > 0,
      files:     files.map(fileToJson)
    });
  } catch (err) {
    console.error('info error:', err.message);
    res.status(500).json({ error: 'Failed to load space.' });
  }
});

// ─── POST /api/:slug/upload-url ───────────────────────────────────────────────
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
app.post('/api/:slug/confirm', async (req, res) => {
  const { slug } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  const { filename, filesize, storagePath } = req.body;
  if (!filename || !filesize || !storagePath)
    return res.status(400).json({ error: 'Missing fields.' });
  if (!storagePath.startsWith(`${slug}/`))
    return res.status(403).json({ error: 'Invalid storage path.' });

  try {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: file, error } = await supabase
      .from('files')
      .insert({ space_slug: slug, filename, filesize, storage_path: storagePath, expires_at: expiresAt })
      .select().single();
    if (error) throw error;

    res.json({ success: true, file: fileToJson(file) });
  } catch (err) {
    console.error('confirm error:', err.message);
    res.status(500).json({ error: 'Failed to save file.' });
  }
});

// ─── GET /api/:slug/download/:fileId ─────────────────────────────────────────
app.get('/api/:slug/download/:fileId', async (req, res) => {
  const { slug, fileId } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    const { data: file, error } = await supabase
      .from('files').select('*').eq('id', fileId).eq('space_slug', slug).maybeSingle();
    if (error) throw error;
    if (!file) return res.status(404).json({ error: 'File not found.' });

    if (file.expires_at && new Date(file.expires_at) < new Date()) {
      await supabase.storage.from(BUCKET).remove([file.storage_path]);
      await supabase.from('files').delete().eq('id', fileId);
      return res.status(410).json({ error: 'File has expired.' });
    }

    await supabase.from('files').update({ downloads: (file.downloads || 0) + 1 }).eq('id', fileId);

    const { data: signed, error: se } = await supabase.storage
      .from(BUCKET).createSignedUrl(file.storage_path, 60, { download: file.filename });
    if (se) throw se;

    res.redirect(signed.signedUrl);
  } catch (err) {
    console.error('download error:', err.message);
    res.status(500).json({ error: 'Download failed.' });
  }
});

// ─── DELETE /api/:slug/file/:fileId ──────────────────────────────────────────
app.delete('/api/:slug/file/:fileId', async (req, res) => {
  const { slug, fileId } = req.params;
  if (!isValid(slug)) return res.status(400).json({ error: 'Invalid space name.' });

  try {
    const { data: file } = await supabase
      .from('files').select('storage_path').eq('id', fileId).eq('space_slug', slug).maybeSingle();
    if (file && file.storage_path)
      await supabase.storage.from(BUCKET).remove([file.storage_path]);
    await supabase.from('files').delete().eq('id', fileId).eq('space_slug', slug);
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
