# FilePad

> Dontpad for ZIP files — instant URL-based ZIP file sharing. No account, no login, just a URL.

## Features
- 🔗 **URL-based spaces** — every path is a sharing space
- 📦 **ZIP only** — validated by extension AND magic bytes
- 🚀 **Drag & drop upload** with real-time progress
- 🔄 **File replacement** — update in-place, URL stays the same
- ⏱️ **Auto-expiry** — files deleted after 30 days
- 📊 **File metadata** — name, size, upload time, download count
- 📋 **One-click link copy**
- 🚫 **No account required**

## Quick Start

```bash
npm install
npm run dev      # development (auto-reload)
npm start        # production
```

Runs at **http://localhost:3000**

## Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Upload**: Multer (multipart/form-data)
- **Frontend**: Vanilla HTML/CSS/JS

## File Limits
- Max size: **500 MB** per file
- Accepted: `.zip` only (magic-byte verified)
- Expiry: **30 days** after upload

## Project Structure
```
FilePad/
├── server.js          # Express server + all API routes
├── filepad.db         # SQLite database (auto-created)
├── uploads/           # Stored ZIP files (auto-created)
└── public/
    ├── index.html     # Homepage
    ├── space.html     # Sharing space page
    ├── style.css      # Design system
    ├── home.js        # Homepage logic
    └── space.js       # Space page logic
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/:slug/info` | Get/create space metadata |
| POST | `/api/:slug/upload` | Upload ZIP file |
| GET | `/api/:slug/download` | Download ZIP file |
| DELETE | `/api/:slug/file` | Delete file from space |
| GET | `/api/health` | Health check |
