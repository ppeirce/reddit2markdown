# R→MD

**Live at [peirce.net/reddit](https://peirce.net/reddit)**

Convert Reddit threads into clean, readable markdown. Paste a URL, get structured markdown with nested comments preserved as blockquotes.

Forked from [frankwiersma/reddit2markdown](https://github.com/frankwiersma/reddit2markdown).

## Features

- Paste any Reddit thread URL and get markdown output instantly
- Nested comments rendered with proper hierarchy using blockquotes
- Toggle between rendered and raw markdown views
- One-click copy to clipboard
- **Bookmarklet** for one-click conversion from any Reddit page
- **Query parameter support** — link directly to a converted thread via `?url=`
- No API keys required — uses Reddit's public `.json` endpoint
- Hybrid fetch: direct request (user's IP) with automatic proxy fallback via Cloudflare Worker

## Tech Stack

- **Language**: TypeScript
- **Framework**: React 18
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS + custom CSS (Bureau design system)
- **Fonts**: Bebas Neue, Space Grotesk, JetBrains Mono (Google Fonts)
- **Deployment**: Cloudflare Pages + Workers (production), Docker (self-hosted)

## Prerequisites

- Node.js 20+
- npm
- Docker and Docker Compose (for containerized deployment only)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/ppeirce/reddit2markdown.git
cd reddit2markdown
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173) by default. Pass `--port` to change:

```bash
npx vite --port 3003
```

No environment variables, no database, no API keys. It just runs.

## Architecture

### How It Works

1. User pastes a Reddit thread URL
2. The client tries a direct `fetch()` to Reddit's `.json` endpoint (with `cache: 'no-store'` to bypass Safari's CORS cache bug — see below)
3. If direct fetch fails (e.g. CORS block, rate limit), the client falls back to a same-origin proxy (`/api/fetch`) powered by a Cloudflare Worker
4. The JSON response is parsed client-side: post title, author, body text, and the full comment tree
5. Comments are recursively processed into markdown using blockquote nesting (`>`, `> >`, `> > >`) to represent thread depth
6. The result is displayed in a rendered view (custom markdown-to-JSX renderer) or as raw copyable text

**Why the hybrid approach?** Direct fetch uses the user's own IP, distributing Reddit's rate limit (~100 req/10min) across all users. The proxy fallback exists for clients where direct fetch fails — most commonly iOS Safari, which has a WebKit bug where the browser's HTTP cache can contain non-CORS responses from prior reddit.com visits, causing cross-origin `fetch()` to fail even though Reddit returns `Access-Control-Allow-Origin: *`. The `cache: 'no-store'` option fixes this for most cases; the proxy catches the rest.

The proxy enforces security constraints: Reddit-host allowlist, HTTPS-only, GET-only, thread path validation, 10s timeout, 5MB size cap, and 60s edge caching.

### Directory Structure

```
├── src/
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Root component, two-state layout (hero / workspace)
│   ├── index.css                   # All styles (Bureau design system)
│   └── components/
│       ├── Header.tsx              # Hero title (empty state only)
│       ├── RedditForm.tsx          # URL input, fetch logic, comment processing
│       ├── MarkdownPreview.tsx     # Rendered/raw toggle, copy, markdown-to-JSX renderer
│       └── Footer.tsx              # Site footer
├── index.html                      # HTML shell, Google Fonts
├── Dockerfile                      # Multi-stage build (node:20-alpine → nginx:alpine)
├── docker-compose.yml              # Single service, port 8080
├── nginx.conf                      # SPA fallback (try_files → /index.html)
├── worker/
│   ├── src/index.ts                # Cloudflare Worker: Reddit proxy + Pages router
│   ├── test/                       # Worker test suite (vitest + workerd)
│   ├── wrangler.toml               # Worker config and route binding
│   └── vitest.config.ts            # Test runner config
├── STYLE_GUIDE.md                  # Bureau design system documentation
├── vite.config.ts                  # Vite config
├── tailwind.config.js              # Tailwind config
├── tsconfig.json                   # TypeScript config
└── package.json                    # Dependencies and scripts
```

### Key Components

**`App.tsx`** — Manages two pieces of state: the Reddit URL and the converted markdown string. The UI has two modes:
- **Hero state** (no content): Full-screen landing with the large title, URL input, and bookmarklet link
- **Workspace state** (content loaded): Compact toolbar with the URL input at the top, converted content below

The URL is initialized from the `?url=` query parameter if present, enabling deep linking and the bookmarklet.

**`RedditForm.tsx`** — Contains all Reddit-specific logic: fetching the JSON, parsing the post data, and recursively walking the comment tree. Each comment is converted to markdown with `> ` prefixes matching its nesting depth. Supports an `autoConvert` prop that triggers conversion on mount (used when a URL arrives via query parameter).

**`MarkdownPreview.tsx`** — A custom line-by-line markdown-to-JSX renderer. Handles headings, bold, italic, horizontal rules, and nested blockquotes. Blockquote nesting depth determines the left border color (ink → red → stone). Also provides the rendered/raw toggle and copy-to-clipboard.

### Query Parameter API

Append `?url=` with an encoded Reddit thread URL to auto-convert on page load:

```
https://peirce.net/reddit?url=https://www.reddit.com/r/subreddit/comments/abc123/thread_title/
```

This is what the bookmarklet uses under the hood.

## Bookmarklet

The app includes a self-configuring bookmarklet on the hero page. To install:

1. Open your R→MD instance in a browser
2. Drag the `R→MD` link from below the input field to your bookmark bar

The bookmarklet captures the origin of whatever R→MD instance you dragged it from. When clicked on a Reddit thread, it opens a new tab with that thread auto-converted.

If you prefer to create it manually, add a bookmark with this URL (replace the origin with your deployment):

```javascript
javascript:void(window.open('http://your-instance:8080?url='+encodeURIComponent(window.location.href)))
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `cd worker && npm test` | Run Worker proxy test suite (30 tests) |

## Deployment

### Docker (Recommended)

The app uses a multi-stage Docker build:
1. **Build stage**: `node:20-alpine` runs `npm ci` and `npm run build` to produce static files in `dist/`
2. **Serve stage**: `nginx:alpine` serves the static files with SPA fallback routing

Build and run locally:

```bash
docker compose up -d --build
```

The app will be available at [http://localhost:8080](http://localhost:8080).

To stop:

```bash
docker compose down
```

### Deploy to a Remote Host

The production instance runs on a remote machine via Docker (OrbStack). The deployment workflow:

1. **Rsync** project files to the remote host (excludes `node_modules`, `.git`, `dist`):

```bash
rsync -av --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='dist' \
  ./ user@remote-host:~/projects/reddit2markdown/
```

2. **Build and start** the container on the remote host:

```bash
ssh user@remote-host "cd ~/projects/reddit2markdown && docker compose up -d --build"
```

3. **Verify** the deployment:

```bash
curl -s -o /dev/null -w '%{http_code}' http://remote-host:8080
```

Should return `200`.

The entire cycle (rsync + build + deploy) takes under 10 seconds. There's no CI/CD pipeline — this manual workflow is fast enough for a single-maintainer project.

### Iterating

For rapid development against the deployed instance:

1. Make changes locally
2. Rsync + rebuild on the remote host (steps 1–2 above)
3. Hard-refresh the browser

The Docker build caches the `npm ci` layer, so rebuilds that only change source files complete in ~3 seconds.

## Design System

The visual design follows **Bureau**, an editorial brutalist design system documented in [`STYLE_GUIDE.md`](STYLE_GUIDE.md). Key characteristics:

- Warm newsprint background (`#F2EDE8`), not dark mode
- Signal red (`#E63312`) as the single accent color
- Bebas Neue for display headlines, Space Grotesk for body, JetBrains Mono for inputs/code
- Full-bleed horizontal rules as the primary structural device
- No shadows, no rounded corners, no gradients

## Troubleshooting

### Error Messages

The app provides specific error messages for different failure modes:

- **"That doesn't look like a Reddit thread URL"** — The URL must be a thread (`/r/.../comments/...`), not a subreddit listing, user profile, or search page
- **"Reddit is rate-limiting requests"** — Reddit limits ~100 requests per 10 minutes. Wait a moment and retry
- **"Reddit blocked this request"** — Some threads (removed, quarantined, private) aren't accessible via the public API
- **"Reddit took too long to respond"** — The 10-second timeout was exceeded. Try again
- **"Network error — could not reach the server"** — Check your internet connection

### Docker Build Fails

If `npm ci` fails during the Docker build, ensure `package-lock.json` is committed and up to date:

```bash
npm install
git add package-lock.json
```

Then rebuild.
