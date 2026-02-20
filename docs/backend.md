# Backend Systems Deep Dive

This document is a comprehensive technical walkthrough of every system behind R→MD that isn't the visible UI. Despite being a "static frontend app," there's a surprising amount of backend-flavored architecture: a public API integration, a recursive tree-walking algorithm, a multi-stage Docker build pipeline, an nginx reverse proxy, and a manual deployment workflow.

If you're a senior engineer unfamiliar with this stack, this document should give you full context on every moving part.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [The Data Source: Reddit's Public JSON API](#2-the-data-source-reddits-public-json-api)
3. [The Data Pipeline: Fetch → Parse → Transform](#3-the-data-pipeline-fetch--parse--transform)
4. [The Recursive Comment Tree Algorithm](#4-the-recursive-comment-tree-algorithm)
5. [The Markdown Renderer](#5-the-markdown-renderer)
6. [The Build System: Vite + TypeScript + PostCSS](#6-the-build-system-vite--typescript--postcss)
7. [The Serving Layer: Docker + nginx](#7-the-serving-layer-docker--nginx)
8. [The Deployment Architecture](#8-the-deployment-architecture)
9. [URL Routing and Deep Linking](#9-url-routing-and-deep-linking)
10. [Security Considerations](#10-security-considerations)
11. [Failure Modes](#11-failure-modes)

---

## 1. System Overview

R→MD is a static frontend app with a lightweight server-side proxy. The frontend compiles to three static files (HTML, CSS, JS) served via Cloudflare Pages. All data processing — parsing Reddit JSON, building the comment tree, generating markdown — happens in the user's browser. A Cloudflare Worker provides both the Pages routing and a proxy fallback for fetching Reddit data.

This is the full request lifecycle:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                              │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐               │
│  │  Input   │───>│  fetch()     │───>│  Reddit     │               │
│  │  URL     │    │  direct      │    │  .json API  │               │
│  └──────────┘    │  (no-store)  │    └─────────────┘               │
│                  └──────┬───────┘                                   │
│                         │                                           │
│                    Success? ──Yes──┐                                │
│                         │          │                                │
│                        No          │                                │
│                         │          │                                │
│                         v          │                                │
│                  ┌──────────────┐  │                                │
│                  │  Proxy       │  │  (Cloudflare Worker            │
│                  │  fallback    │  │   fetches from Reddit          │
│                  │  /api/fetch  │  │   server-side)                 │
│                  └──────┬───────┘  │                                │
│                         │          │                                │
│                         v          v                                │
│                  ┌──────────────┐                                   │
│                  │  Parse JSON  │                                   │
│                  │  response    │                                   │
│                  └──────┬───────┘                                   │
│                         │                                           │
│                         v                                           │
│                  ┌──────────────┐                                   │
│                  │  Walk tree   │  ← recursive, depth-first         │
│                  │  Build MD    │                                   │
│                  └──────┬───────┘                                   │
│                         │                                           │
│                         v                                           │
│                  ┌──────────────┐    ┌─────────────┐               │
│                  │  Markdown    │───>│  Render as  │               │
│                  │  string      │    │  JSX or raw │               │
│                  └──────────────┘    └─────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     SERVING INFRASTRUCTURE                          │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐               │
│  │  Browser  │───>│  Cloudflare  │───>│  Pages      │               │
│  │  request  │    │  Worker      │    │  (static)   │               │
│  └──────────┘    │  + proxy     │    └─────────────┘               │
│                  └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

The browser does all the computation. The Worker routes page requests to Cloudflare Pages and provides the Reddit proxy fallback.

---

## 2. The Data Source: Reddit's Public JSON API

### How it works

Every Reddit page has a JSON representation. Append `.json` to any Reddit URL and you get the raw data that Reddit's own frontend uses to render the page:

```
https://www.reddit.com/r/programming/comments/abc123/some_post/
                                                                 ↓
https://www.reddit.com/r/programming/comments/abc123/some_post/.json
```

This is not an official API. There is no API key, no OAuth token, no rate limit header. It's a public endpoint that Reddit exposes — likely a side effect of their architecture rather than a deliberate developer feature. It works because Reddit's frontend is itself a client that consumes this JSON.

### The URL transformation

In the code (`RedditForm.tsx`), the user-provided URL is cleaned and transformed:

```typescript
const cleanUrl = url.replace(/\/?(\?.*)?$/, '');
const jsonUrl = cleanUrl + '.json';
```

The regex strips a trailing slash and any query parameters, then `.json` is appended. Examples:

| Input URL | Result |
|-----------|--------|
| `https://reddit.com/r/foo/comments/abc/title/` | `https://reddit.com/r/foo/comments/abc/title.json` |
| `https://reddit.com/r/foo/comments/abc/title` | `https://reddit.com/r/foo/comments/abc/title.json` |
| `https://www.reddit.com/r/foo/comments/abc/?sort=new` | `https://www.reddit.com/r/foo/comments/abc.json` |

### Response structure

The JSON response is an **array of two "Listing" objects**. This is Reddit's internal data model:

```
data[0]  →  The post itself (a Listing containing one Link)
data[1]  →  The comments (a Listing containing many Comments)
```

Here's the structure, annotated:

```jsonc
[
  // ─── data[0]: THE POST ───────────────────────────────────
  {
    "kind": "Listing",           // Reddit type prefix
    "data": {
      "children": [
        {
          "kind": "t3",          // "t3" = Link (post)
          "data": {
            "title": "Post title here",
            "author": "username",
            "selftext": "The body text of the post (markdown)",
            "score": 1234,
            "num_comments": 56,
            "created_utc": 1700000000,
            // ... hundreds of other fields we ignore
          }
        }
      ]
    }
  },

  // ─── data[1]: THE COMMENTS ──────────────────────────────
  {
    "kind": "Listing",
    "data": {
      "children": [
        {
          "kind": "t1",          // "t1" = Comment
          "data": {
            "author": "commenter1",
            "body": "Top-level comment text",
            "score": 42,
            "replies": {         // ← NESTED: same Listing structure
              "kind": "Listing",
              "data": {
                "children": [
                  {
                    "kind": "t1",
                    "data": {
                      "author": "replier1",
                      "body": "Reply to commenter1",
                      "replies": { ... }  // ← further nesting
                    }
                  }
                ]
              }
            }
          }
        },
        {
          "kind": "t1",
          "data": { ... }        // Another top-level comment
        },
        {
          "kind": "more",        // ← "Load more comments" marker
          "data": {
            "children": ["id1", "id2", ...],
            "count": 15
          }
        }
      ]
    }
  }
]
```

### Reddit's type prefixes

Reddit uses a prefix system for all entities:

| Prefix | Type | Example |
|--------|------|---------|
| `t1` | Comment | A comment on a post |
| `t2` | Account | A user account |
| `t3` | Link | A post/submission |
| `t4` | Message | A private message |
| `t5` | Subreddit | A subreddit |
| `t6` | Award | A Reddit award |

The code filters for `t1` (comments) and ignores `more` objects (which represent collapsed/truncated comment threads that would require additional API calls to expand).

### CORS and the Safari cache bug

This app makes cross-origin requests from the browser directly to `reddit.com`. This works because Reddit's servers include permissive CORS headers on their `.json` endpoints:

```
Access-Control-Allow-Origin: *
```

However, iOS Safari (and occasionally desktop Safari) has a WebKit bug where the browser's HTTP cache can contain non-CORS responses from prior `reddit.com` visits (e.g. browsing Reddit normally). When a cross-origin `fetch()` later hits that cached entry, Safari sees no `Access-Control-Allow-Origin` header and blocks the request — even though a fresh network request would return the header.

The fix is `cache: 'no-store'` on the fetch request, which bypasses the HTTP cache entirely:

```typescript
fetch(jsonUrl, { cache: 'no-store' })
```

This was confirmed through systematic testing: bare `fetch()` fails on iOS Safari with "Load failed" (a CORS `TypeError`), while `fetch()` with `cache: 'no-store'` succeeds consistently. The `credentials: 'omit'` option (ITP hypothesis) was ruled out as unnecessary.

As a safety net, the app falls back to a Cloudflare Worker proxy if the direct fetch fails for any reason. This handles edge cases where `cache: 'no-store'` alone isn't sufficient (future WebKit changes, content blockers, other CORS variations) and also provides an alternative path if the user's IP is rate-limited by Reddit.

### What we ignore

Reddit's JSON response contains hundreds of fields per object. The app uses exactly **four**:

| Field | From | Used for |
|-------|------|----------|
| `title` | Post (`data[0]`) | Markdown H1 heading |
| `author` | Post and Comments | Attribution line |
| `selftext` | Post | Post body content |
| `body` | Comments | Comment text content |

Everything else (scores, timestamps, awards, flairs, edit history, etc.) is discarded.

---

## 3. The Data Pipeline: Fetch → Parse → Transform

The full pipeline lives in `RedditForm.tsx` and executes in the browser. Here's the annotated flow:

```typescript
// Step 1: Build the JSON URL
const cleanUrl = url.replace(/\/?(\?.*)?$/, '');
const jsonUrl = cleanUrl + '.json';

// Step 2: Try direct fetch, fall back to proxy
let data: any;
try {
  const directRes = await fetch(jsonUrl, { cache: 'no-store' });
  if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
  data = await directRes.json();
} catch (directErr) {
  // Direct failed — fall back to server-side proxy
  const proxyUrl = `${import.meta.env.BASE_URL}api/fetch?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl);
  data = await response.json();
}
```

The direct fetch uses `cache: 'no-store'` to bypass Safari's CORS cache bug (see Section 2). If it fails for any reason (CORS block, rate limit, network error), the catch block falls back to the Cloudflare Worker proxy, which fetches from Reddit server-side and returns the JSON.

```typescript
// Step 2: Extract the post
const post = data[0].data.children[0].data;
```

`data[0]` is the first Listing (the post). `.data.children[0]` is the first (and only) child of that Listing. `.data` gets the actual post object. This triple `.data` nesting is Reddit's Listing wrapper pattern.

```typescript
// Step 3: Build the post header as markdown
let md = `# ${post.title}\n\n`;
md += `*Posted by u/${post.author}*\n\n`;
md += `${post.selftext}\n\n---\n\n`;
```

The post becomes a markdown document with:
- The title as an H1 (`# Title`)
- The author in italics (`*Posted by u/author*`)
- The body text verbatim (Reddit stores `selftext` as markdown already)
- A horizontal rule (`---`) separating the post from comments

```typescript
// Step 4: Walk the comment tree
data[1].data.children.forEach((comment: any) => {
  if (comment.kind === 't1') {
    md += processComment(comment, 0);
  }
});
```

`data[1]` is the second Listing (comments). Each child is either a `t1` (comment) or `more` (collapsed thread). We process only `t1` nodes, starting at depth 0.

The final markdown string is passed to `onSubmit`, which sets it in App's state, which triggers the UI transition from hero to workspace.

---

## 4. The Recursive Comment Tree Algorithm

This is the most algorithmically interesting part of the codebase. Reddit's comment data is a tree (each comment can have `replies` containing more comments). The algorithm walks this tree depth-first and converts it to flat markdown using blockquote nesting.

### The function

```typescript
const processComment = (comment: any, depth = 0): string => {
  // Build the ">" prefix for this depth level
  const indent = "> ".repeat(depth);

  // Author line: bold, prefixed with blockquote markers
  let mdComment = `${indent}**u/${comment.data.author}**\n`;

  // Comment body: split into lines, prefix each with blockquote markers
  const commentBody = comment.data.body
    .split('\n')
    .map((line: string) => `${indent}${line}`)
    .join('\n');
  mdComment += `${commentBody}\n\n`;

  // Recurse into replies (if any)
  if (comment.data.replies?.data?.children) {
    comment.data.replies.data.children.forEach((child: any) => {
      if (child.kind === 't1') {
        mdComment += processComment(child, depth + 1);
      }
    });
  }

  return mdComment;
};
```

### How blockquote nesting encodes depth

Markdown blockquotes nest with repeated `>` characters. The algorithm uses this to visually represent comment thread depth:

```
Depth 0:  (no prefix)     → top-level comment
Depth 1:  >               → reply to top-level
Depth 2:  > >             → reply to a reply
Depth 3:  > > >           → three levels deep
```

### Walkthrough with example data

Consider this thread:

```
Alice: "Great post!"
  Bob: "I agree"
    Charlie: "Me too"
  Dave: "Interesting point"
Eve: "Thanks for sharing"
```

The tree structure in Reddit's JSON:

```
t1 (Alice, depth=0)
├── t1 (Bob, depth=1)
│   └── t1 (Charlie, depth=2)
├── t1 (Dave, depth=1)
t1 (Eve, depth=0)
```

The algorithm walks this depth-first. Here's the call stack:

```
processComment(Alice, 0)
  → "**u/Alice**\nGreat post!\n\n"
  → processComment(Bob, 1)
    → "> **u/Bob**\n> I agree\n\n"
    → processComment(Charlie, 2)
      → "> > **u/Charlie**\n> > Me too\n\n"
      → (no replies, return)
    → (return Bob + Charlie)
  → processComment(Dave, 1)
    → "> **u/Dave**\n> Interesting point\n\n"
    → (no replies, return)
  → (return Alice + Bob + Charlie + Dave)
processComment(Eve, 0)
  → "**u/Eve**\nThanks for sharing\n\n"
```

Final markdown output:

```markdown
**u/Alice**
Great post!

> **u/Bob**
> I agree

> > **u/Charlie**
> > Me too

> **u/Dave**
> Interesting point

**u/Eve**
Thanks for sharing
```

### The line-splitting detail

One subtle aspect: Reddit stores comment bodies as multi-line strings. A comment body might be:

```
"I think this is important.\n\nHere's why:\n- Reason 1\n- Reason 2"
```

The algorithm splits on `\n` and prefixes EVERY line with the blockquote indent:

```typescript
const commentBody = comment.data.body
  .split('\n')
  .map((line: string) => `${indent}${line}`)
  .join('\n');
```

At depth 2, this becomes:

```
> > I think this is important.
> >
> > Here's why:
> > - Reason 1
> > - Reason 2
```

Without this line-by-line prefixing, only the first line would be inside the blockquote and subsequent lines would break out of the nesting.

### What we skip: "more" nodes

Reddit truncates long comment threads. When a thread has more replies than Reddit wants to send in one response, it includes a `more` object instead:

```json
{
  "kind": "more",
  "data": {
    "count": 15,
    "children": ["abc123", "def456", ...]
  }
}
```

The `children` array contains IDs of the hidden comments. To fetch them, you'd need to make an additional API call to Reddit's `/api/morechildren` endpoint, which requires authentication.

This app ignores `more` nodes entirely (`if (child.kind === 't1')`). For most threads, this means you get the top ~200 comments. Deeply buried replies may be missing. This is a known limitation and an intentional tradeoff — supporting `morechildren` would require either Reddit API authentication or a backend proxy.

---

## 5. The Markdown Renderer

After the pipeline produces a markdown string, the `MarkdownPreview` component can display it in two modes: raw (the string in a `<pre>` block) or rendered (parsed into JSX elements).

The renderer (`MarkdownPreview.tsx:23-51`) is a **custom, line-by-line markdown-to-JSX converter**. It does NOT use a markdown parsing library (no `marked`, no `remark`, no `react-markdown`). It is hand-rolled and purpose-built for the specific markdown patterns that `processComment` produces.

### The parsing strategy

The renderer splits the markdown string on `\n` and processes each line independently with a priority-ordered chain of pattern matchers:

```
For each line:
  1. Starts with "# "        → <h1>
  2. Starts with "## "       → <h2>
  3. Wrapped in "**...**"     → <strong> (block)
  4. Wrapped in "*...*"       → <em> (block)
  5. Equals "---"             → <hr>
  6. Starts with ">"          → <blockquote> (nested, see below)
  7. Non-empty                → <p>
  8. Empty                    → <br>
```

### Blockquote nesting reconstruction

The most complex part of the renderer is reconstructing blockquote nesting from the `>` prefixes that the comment algorithm produced. Here's the logic:

```typescript
if (line.trim().startsWith('>')) {
  const match = line.match(/^((?:>\s?)+)\s*(.*)$/);
  if (match) {
    const level = (match[1].match(/>/g) || []).length;
    const content = match[2];
    // ...
    let node: JSX.Element = inner;
    for (let j = 0; j < level; j++) {
      node = <blockquote key={`${i}-${j}`}>{node}</blockquote>;
    }
    return node;
  }
}
```

The regex `^((?:>\s?)+)\s*(.*)$` works like this:

```
^                 start of string
((?:>\s?)+)       capture group 1: one or more ">" optionally followed by a space
\s*               skip any remaining whitespace
(.*)              capture group 2: the actual content
$                 end of string
```

For the line `> > > Hello`, this produces:
- Group 1: `> > > ` (the prefix markers)
- Group 2: `Hello` (the content)
- Level: 3 (count of `>` characters in group 1)

Then the algorithm wraps the content in `level` layers of `<blockquote>`:

```
level=3: <blockquote><blockquote><blockquote><p>Hello</p></blockquote></blockquote></blockquote>
```

### HTML entity decoding

Reddit's JSON returns HTML-encoded text. For example, `&amp;` instead of `&`, `&lt;` instead of `<`, `&#39;` instead of `'`. The renderer decodes these before processing:

```typescript
const decodeHTML = (text: string): string => {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
};
```

This is a well-known browser trick: set a `<textarea>`'s `innerHTML` to the encoded string, then read `.value` to get the decoded string. The browser's HTML parser does the decoding for you. This handles all standard HTML entities without needing a lookup table.

### Why not use a markdown library?

A general-purpose markdown parser (like `marked` or `remark`) would handle more syntax: links, images, code blocks, tables, lists. But:

1. **The input is controlled.** The markdown is generated by our own `processComment` function, so we know exactly what patterns to expect.
2. **The blockquote nesting is non-standard.** General markdown parsers don't produce the nested `<blockquote>` structure we need for the visual thread display.
3. **Bundle size.** A full markdown parser adds 20-50KB. The custom renderer is ~30 lines.

The tradeoff is that some Reddit comments with complex formatting (tables, code blocks, nested lists) won't render perfectly in the "rendered" view. The "raw" view always shows the correct markdown — the rendered view is a best-effort visual presentation.

---

## 6. The Build System: Vite + TypeScript + PostCSS

### Vite

[Vite](https://vitejs.dev/) is the build tool. It serves two roles:

**In development**, it runs a dev server that serves source files directly to the browser using native ES module imports. TypeScript and JSX are transformed on-the-fly by [esbuild](https://esbuild.github.io/) (written in Go, extremely fast). There is no bundling step in dev — each file is served individually. Hot Module Replacement (HMR) pushes changes to the browser instantly.

**In production** (`npm run build`), it bundles everything with [Rollup](https://rollupjs.org/) into optimized static files:

```
dist/
├── index.html              (0.92 KB)
├── assets/
│   ├── index-XXXX.css      (~10 KB, gzipped ~2.8 KB)
│   └── index-XXXX.js       (~147 KB, gzipped ~47 KB)
```

The `XXXX` in filenames is a content hash for cache busting. When the file content changes, the hash changes, and browsers fetch the new version.

The Vite configuration is minimal (`vite.config.ts`):

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
```

- `react()` enables the automatic JSX runtime (no need to `import React` in every file) and React Fast Refresh for HMR.
- `optimizeDeps.exclude` tells Vite not to pre-bundle `lucide-react` (an icon library included as a dependency but not currently used in the redesigned UI).

### TypeScript

TypeScript configuration uses a **project references** pattern with two config files:

**`tsconfig.json`** — the root config, references the sub-configs:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**`tsconfig.app.json`** — the browser code config:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Key settings:
- `"jsx": "react-jsx"` — uses the automatic runtime, meaning `.tsx` files don't need `import React from 'react'`. React is injected automatically by the compiler.
- `"moduleResolution": "bundler"` — tells TypeScript to resolve imports the way Vite does, not the way Node.js does. This allows `.tsx` extension imports and other bundler-specific patterns.
- `"noEmit": true` — TypeScript only type-checks, it doesn't produce output files. Vite/esbuild handles the actual compilation.
- `"strict": true` — enables all strict type-checking flags.

**`tsconfig.node.json`** covers config files that run in Node.js (like `vite.config.ts`), with different target and module settings.

### PostCSS + Tailwind

The CSS pipeline is:

```
src/index.css → PostCSS → Tailwind CSS → Autoprefixer → output CSS
```

**PostCSS** (`postcss.config.js`) runs two plugins:
1. **Tailwind CSS** — processes `@tailwind` directives and utility classes
2. **Autoprefixer** — adds vendor prefixes (`-webkit-`, `-moz-`) for browser compatibility

**Tailwind** (`tailwind.config.js`) scans all HTML and TSX files for class names:

```javascript
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

The `content` array tells Tailwind where to look for class usage. Tailwind then tree-shakes its enormous utility class library down to only the classes actually used. In this project, Tailwind is used lightly — mostly for flex utilities, spacing, and responsive breakpoints. The bulk of the styling is custom CSS using CSS custom properties.

---

## 7. The Serving Layer: Docker + nginx

### Multi-stage Docker build

The `Dockerfile` uses a multi-stage build pattern:

```dockerfile
# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

**Why two stages?**

The build stage needs Node.js, npm, and all dev dependencies (TypeScript compiler, Vite, Tailwind, etc.) — this is a ~300MB image. The serve stage only needs nginx and three static files — this is a ~40MB image. The multi-stage build gives you the build tools temporarily, extracts the output, and discards everything else. The final image never contains Node.js, `node_modules`, or source code.

**Layer caching:**

```dockerfile
COPY package.json package-lock.json ./    # Layer 1: dependency manifest
RUN npm ci                                 # Layer 2: installed dependencies
COPY . .                                   # Layer 3: source code
RUN npm run build                          # Layer 4: build output
```

Docker caches layers. If `package.json` and `package-lock.json` haven't changed, layers 1 and 2 are cached and `npm ci` doesn't re-run. Only layers 3 and 4 (copy source + build) execute. This makes rebuilds after source-only changes take ~2-3 seconds instead of ~30 seconds.

**`npm ci` vs `npm install`:**

`npm ci` is used instead of `npm install` because:
- It installs from `package-lock.json` exactly (deterministic)
- It deletes `node_modules` first (clean slate)
- It's faster for CI/Docker builds
- It fails if `package-lock.json` is out of sync with `package.json`

### nginx configuration

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

This is a standard **SPA fallback** configuration. Here's what `try_files` does:

```
Request: GET /some/path

try_files $uri           → Does /usr/share/nginx/html/some/path exist as a file? No.
          $uri/          → Does /usr/share/nginx/html/some/path/ exist as a directory? No.
          /index.html    → Serve /usr/share/nginx/html/index.html instead.
```

**Why is this necessary?**

R→MD uses query parameters (`?url=...`) rather than path-based routing, so this fallback isn't strictly critical today. But it's protective: if someone navigates directly to any path (e.g., bookmarks a URL with a path), nginx serves `index.html` instead of returning 404. The React app then handles routing client-side.

For static assets (CSS, JS files with hashed names), `$uri` matches on the first try and the file is served directly.

### Docker Compose

```yaml
services:
  reddit2markdown:
    build: .
    ports:
      - "8080:80"
    restart: unless-stopped
```

- `build: .` — builds from the Dockerfile in the current directory
- `ports: "8080:80"` — maps host port 8080 to container port 80 (nginx)
- `restart: unless-stopped` — automatically restarts the container after crashes or host reboots, unless explicitly stopped with `docker compose down`

### .dockerignore

```
node_modules
.git
.DS_Store
.bolt
```

These are excluded from the Docker build context (the files sent to the Docker daemon). This is critical for performance: `node_modules` alone is ~200MB. Without `.dockerignore`, Docker would copy all of `node_modules` into the build context only to delete it and reinstall with `npm ci`.

---

## 8. The Deployment Architecture

### Physical topology

```
┌─────────────────────┐          ┌─────────────────────────────────┐
│  Development Mac     │   SSH    │  Intel MacBook Pro (intel-mbp)  │
│  (local machine)     │─────────>│  headless server                │
│                      │  rsync   │                                 │
│  Source code lives   │─────────>│  ┌─────────────────────┐       │
│  here. Edits happen  │          │  │  OrbStack            │       │
│  here.               │          │  │  (Docker runtime)    │       │
│                      │          │  │                      │       │
│                      │          │  │  ┌────────────────┐ │       │
│                      │          │  │  │  Container      │ │       │
│                      │          │  │  │  nginx :80      │ │       │
│                      │          │  │  │  mapped → :8080 │ │       │
│                      │          │  │  └────────────────┘ │       │
│                      │          │  └─────────────────────┘       │
└─────────────────────┘          └─────────────────────────────────┘
                                          │
                                          │  http://intel-mbp:8080
                                          ▼
                                   ┌─────────────┐
                                   │  Browser     │
                                   │  (any device │
                                   │  on network) │
                                   └─────────────┘
```

### OrbStack

[OrbStack](https://orbstack.dev/) is the Docker runtime on the Intel MacBook Pro. It's an alternative to Docker Desktop for macOS. It provides the `docker` and `docker compose` CLI commands but runs as a lightweight background service.

**Critical detail:** OrbStack installs its binaries to `~/.orbstack/bin/`, which is NOT in `$PATH` during non-interactive SSH sessions. Every remote Docker command must explicitly set the PATH:

```bash
ssh peterpeirce@intel-mbp "export PATH=\$HOME/.orbstack/bin:\$PATH && docker compose up -d --build"
```

Without this PATH prefix, `docker` commands will fail with "command not found" even though they work fine in an interactive terminal.

### The deployment workflow

There is no CI/CD pipeline. Deployment is manual and takes ~10 seconds:

**Step 1: Rsync source files to the remote host**

```bash
rsync -av \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='dist' \
  /Users/peter/projects/reddit2markdown/ \
  peterpeirce@intel-mbp:~/projects/reddit2markdown/
```

Flags:
- `-a` (archive): preserves permissions, timestamps, symlinks, recursive
- `-v` (verbose): shows transferred files
- `--exclude`: skip files that either don't belong on the server or would be regenerated

Note the trailing `/` on the source path — this means "copy the contents of this directory" rather than "copy the directory itself." Without it, you'd get `reddit2markdown/reddit2markdown/` on the remote.

**Step 2: Build and deploy the container**

```bash
ssh peterpeirce@intel-mbp \
  "export PATH=\$HOME/.orbstack/bin:\$PATH && \
   cd ~/projects/reddit2markdown && \
   docker compose up -d --build"
```

`docker compose up -d --build` does three things:
1. `--build`: Rebuilds the Docker image from the Dockerfile
2. Recreates the container if the image changed
3. `-d`: Runs in detached mode (background)

If only source files changed (not `package.json`), Docker's layer cache means `npm ci` is skipped and the build takes ~2-3 seconds.

**Step 3: Verify**

```bash
curl -s -o /dev/null -w '%{http_code}' http://intel-mbp:8080
# Should return: 200
```

### Why this works at this scale

This manual workflow is intentionally simple. There's no build server, no container registry, no orchestrator. The tradeoffs:

| Property | Status | Notes |
|----------|--------|-------|
| **Zero-downtime deploy** | No | Container restarts during rebuild (~2s downtime) |
| **Rollback** | Manual | `git revert` + redeploy |
| **Deploy time** | ~10s | rsync (~1s) + build (~3s) + container restart (~1s) |
| **Multiple instances** | No | Single container, single host |
| **HTTPS** | No | HTTP only, accessible on local network |

For a single-user tool on a home network, this is the right level of infrastructure.

---

## 9. URL Routing and Deep Linking

### Query parameter initialization

When the app loads, `App.tsx` reads the URL's query parameters:

```typescript
const [url, setUrl] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  return params.get('url') || '';
});
```

`useState` accepts a function (lazy initializer) that runs once on mount. This reads `?url=` from the browser's address bar.

A separate ref tracks whether auto-conversion should happen:

```typescript
const shouldAutoConvert = useRef(
  new URLSearchParams(window.location.search).has('url')
);
```

`useRef` is used instead of `useState` because this value never changes and should never trigger a re-render. It's a flag read once by the child component.

### Auto-conversion on mount

In `RedditForm.tsx`, a `useEffect` fires on mount:

```typescript
const hasAutoConverted = useRef(false);

useEffect(() => {
  if (autoConvert && url && !hasAutoConverted.current) {
    hasAutoConverted.current = true;
    convert();
  }
}, []);
```

The empty dependency array `[]` means this runs exactly once, after the first render. `hasAutoConverted` is a guard against React's `StrictMode` double-mounting in development (where effects run twice).

### The bookmarklet

The bookmarklet link is generated at render time in `App.tsx`:

```tsx
<a
  href={`javascript:void(window.open('${window.location.origin}?url='+encodeURIComponent(window.location.href)))`}
  onClick={(e) => e.preventDefault()}
>
  R→MD
</a>
```

**How this works:**

1. At render time, `${window.location.origin}` is evaluated. If you're viewing the app at `http://intel-mbp:8080`, this bakes in `http://intel-mbp:8080`.
2. The rest of the string is literal JavaScript that becomes the bookmarklet code.
3. When the user drags this link to their bookmark bar, the browser saves the `href` as-is.
4. When they click the bookmarklet on a Reddit page, the `javascript:` URI executes:
   - `window.location.href` evaluates to the Reddit URL they're currently viewing
   - `encodeURIComponent()` URL-encodes it
   - `window.open()` opens a new tab with `http://intel-mbp:8080?url=<encoded reddit url>`
5. The new tab loads R→MD, reads the `?url=` param, and auto-converts.

The `onClick={(e) => e.preventDefault()}` prevents the bookmarklet from executing when clicked directly on the R→MD page (where it would try to convert the R→MD page itself, which isn't a Reddit URL).

---

## 10. Security Considerations

### No secrets

There are no API keys, tokens, credentials, or environment variables. The app has zero configuration. This is a meaningful security property — there is nothing to leak.

### Cross-origin data flow

In the primary path (direct fetch), the browser fetches data from Reddit and processes it entirely client-side. No Reddit data touches any server you control.

In the fallback path (proxy), Reddit data transits through the Cloudflare Worker. The Worker does not log, store, or modify the data — it validates the URL, fetches from Reddit, and streams the response back to the client. Responses are cached at the Cloudflare edge for 60 seconds (keyed by the Reddit `.json` URL) to reduce redundant fetches.

In both paths:

- No user data is stored persistently
- There's no database, no user accounts, no analytics
- The Worker has no secrets or environment variables

### HTML entity injection

Reddit's JSON returns user-generated content that may contain HTML entities or markup. The `decodeHTML` function processes this content, and React's JSX rendering provides automatic XSS protection — React escapes strings by default when rendering them as text content.

The one exception is the `decodeHTML` function itself:

```typescript
const decodeHTML = (text: string): string => {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
};
```

Setting `innerHTML` on a `<textarea>` is safe because `<textarea>` elements don't execute scripts or render HTML — they treat everything as text. The decoded string is then rendered through React's normal text rendering, which escapes it again for the DOM. There is no `dangerouslySetInnerHTML` anywhere in the codebase.

### The `javascript:` bookmarklet

The bookmarklet link has a `javascript:` URI in its `href`. This is inherently an XSS vector if the content is user-controlled. In this case, the `href` is constructed from `window.location.origin` (controlled by the server) and static strings (controlled by the source code). There is no user input in the bookmarklet URL construction, so this is safe.

---

## 11. Failure Modes

### Network failures

The hybrid fetch provides resilience — many failures that would be fatal with direct-only fetch are handled transparently by the proxy fallback.

| Scenario | Direct fetch | Proxy fallback | User sees |
|----------|-------------|----------------|-----------|
| No internet connection | Fails | Fails | "Network error — could not reach the server" |
| Reddit is down | Fails | Fails (502) | "Could not reach Reddit — try again later" |
| CORS block (Safari cache bug) | Fails (`TypeError`) | Succeeds | Normal result (transparent fallback) |
| Reddit rate-limits user's IP | Fails (HTTP 429) | Succeeds (different IP) | Normal result (transparent fallback) |
| Reddit rate-limits proxy IP | Succeeds (user IP) | N/A | Normal result (direct path) |
| Both IPs rate-limited | Fails (HTTP 429) | Fails (429) | "Reddit is rate-limiting requests — try again in a minute" |

The direct fetch failure is instant (CORS `TypeError` is not a timeout), so the proxy fallback adds negligible latency. Errors from both paths are logged to the browser console for debugging.

### Malformed data

| Scenario | Result |
|----------|--------|
| URL is not a Reddit thread | JSON structure won't match expected shape → `TypeError` → caught |
| Thread is deleted/removed | Post data may be `null` or `[deleted]` → partial output or error |
| Thread is in a private subreddit | Reddit returns 403 → `response.json()` may fail → caught |
| Thread has zero comments | `data[1].data.children` is empty → no comments in output (not an error) |
| Comment body is `null` (deleted comment) | `.split('\n')` on `null` → `TypeError` → caught |

### Container failures

| Scenario | Result | Recovery |
|----------|--------|----------|
| Container crashes | `restart: unless-stopped` auto-restarts it | Automatic |
| Host machine reboots | OrbStack + Docker restart policy bring it back | Automatic |
| OrbStack not running | Container won't start | Run `open -a OrbStack` on the host |
| Port 8080 already in use | Container fails to bind | Stop the conflicting process or change the port in `docker-compose.yml` |
| Disk full | Docker build fails | Free disk space, then rebuild |

### Build failures

| Scenario | Cause | Fix |
|----------|-------|-----|
| `npm ci` fails | `package-lock.json` out of sync | Run `npm install` locally, commit the lock file |
| TypeScript errors | Type errors in source | Fix the errors (build is strict) |
| Vite build fails | Import errors, missing modules | Check imports and dependencies |
