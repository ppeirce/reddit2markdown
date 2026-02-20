# Tech Spec: Share Pages

**Status:** Draft
**Date:** 2026-02-20

## Motivation

After converting a Reddit thread, there's no way to share the result. The
`?url=` auto-convert mechanism already works as a shareable link, but:

1. There's no "Share" button — users must manually copy the URL bar
2. Shared links produce blank preview cards in Slack, Discord, iMessage, etc.
   because the SPA has no thread-specific OpenGraph tags
3. Recipients see a blank page while the thread converts, with no indication of
   what's loading

This spec addresses all three gaps while keeping the existing stateless,
live-link approach (no server-side storage of converted markdown).

## Scope

| Enhancement | What it does |
|---|---|
| Share button | Makes sharing discoverable; uses Web Share API on mobile, clipboard on desktop |
| OG meta tags via Worker | Gives shared links rich preview cards in chat platforms |
| Loading state with title hint | Shows the thread title immediately while conversion runs |

## Non-goals

- Stored snapshots / short URLs (future consideration, requires KV)
- Social image generation (og:image with rendered preview)
- Share-to-specific-platform buttons (Twitter, Facebook, etc.)

---

## 1. Share Button

### Behavior

A "Share" button appears in the workspace toolbar after successful conversion.
On click:

1. **If Web Share API is available** (mobile browsers, some desktop): invoke
   `navigator.share()` with the share URL and thread title
2. **Fallback**: copy the share URL to clipboard, show "Copied!" feedback

The share URL is the current page origin + base path + `?url=<original-url>`:

```
https://peirce.net/reddit?url=https://www.reddit.com/r/movies/comments/1q51kqe/dead_poets_society_what_a_movie/
```

### Data flow

The share button needs the **post title** and the **original Reddit URL**.
Currently `RedditForm.tsx` calls `onSubmit(md)` with only the assembled markdown
string. The post title is embedded in the markdown as the first `# ` line but is
not exposed as structured data. (Note: the `convert()` function now uses a
hybrid fetch — direct first, proxy fallback — but `post.title` is extracted from
the `data` variable after either path succeeds, so the extraction logic is the
same.)

**Change:** Expand the `onSubmit` callback to pass metadata alongside the
markdown:

```ts
// Current
onSubmit: (markdown: string) => void

// Proposed
onSubmit: (result: { markdown: string; title: string }) => void
```

`App.tsx` stores both values in state. The title is available for the share
button and for the loading state (enhancement 3).

### Where it lives

The share button goes in `MarkdownPreview.tsx`, alongside the existing
Rendered / Raw / Copy controls. It uses the `.btn-tab` class for visual
consistency.

```
[ Rendered ]  [ Raw ]  [ Copy ]  [ Share ↗ ]
```

### Implementation

```
src/App.tsx
  - State: add `title` alongside `markdown`
  - Pass `title` and `url` to MarkdownPreview

src/components/RedditForm.tsx
  - In convert(): extract `post.title` from `data` (available after either
    direct fetch or proxy fallback resolves)
  - Call onSubmit({ markdown, title }) instead of onSubmit(md)

src/components/MarkdownPreview.tsx
  - New prop: `shareUrl: string`, `title: string`
  - New "Share" button next to Copy
  - share() function:
    if (navigator.share) {
      navigator.share({ title, url: shareUrl })
    } else {
      navigator.clipboard.writeText(shareUrl)
      // show "Copied!" feedback (same pattern as existing copy button)
    }
```

### Files changed

| File | Change |
|---|---|
| `src/App.tsx` | Add `title` state, construct share URL, pass to MarkdownPreview |
| `src/components/RedditForm.tsx` | Change `onSubmit` signature to include title |
| `src/components/MarkdownPreview.tsx` | Add Share button with Web Share / clipboard |

---

## 2. OG Meta Tags via Worker

### Problem

When a URL like `peirce.net/reddit?url=<thread>` is pasted in Slack, Discord,
or iMessage, the platform's crawler fetches the page to build a preview card.
It gets the SPA's static `index.html`:

```html
<title>R→MD</title>
<!-- no og:title, no og:description -->
```

The preview card shows "R→MD" with no thread context. The recipient has no idea
what the link contains.

### Solution

The Cloudflare Worker already sits between incoming requests and Pages. It can
detect social media crawlers by User-Agent and return lightweight HTML with
OpenGraph tags instead of the full SPA.

### Crawler detection

Social platforms identify their crawlers:

| Platform | User-Agent contains |
|---|---|
| Slack | `Slackbot` |
| Discord | `Discordbot` |
| Twitter/X | `Twitterbot` |
| Facebook | `facebookexternalhit` |
| LinkedIn | `LinkedInBot` |
| iMessage | `AppleBot` |
| WhatsApp | `WhatsApp` |
| Telegram | `TelegramBot` |
| Generic | `bot` (catch-all, use cautiously) |

### Data flow

```
Crawler requests: peirce.net/reddit?url=https://www.reddit.com/r/movies/comments/1q51kqe/...
    │
    ▼
Worker sees ?url= param AND bot User-Agent
    │
    ▼
Worker calls handleRedditProxy() internally to fetch thread JSON
    │
    ▼
Worker extracts: title, author, subreddit, selftext (truncated)
    │
    ▼
Worker returns minimal HTML with OG tags (not the SPA)
```

For non-bot requests, the Worker continues to serve the SPA as usual.

### Response for crawlers

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — R→MD</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="u/${author} in r/${subreddit} — converted to markdown">
  <meta property="og:site_name" content="R→MD">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://peirce.net/reddit?url=${encodedUrl}">
  <meta name="twitter:card" content="summary">
</head>
<body>
  <p>Redirecting to <a href="https://peirce.net/reddit?url=${encodedUrl}">R→MD</a>...</p>
</body>
</html>
```

This gives crawlers what they need for preview cards. If a real user somehow
lands on this HTML (e.g., JavaScript disabled), the visible link still works.

### Preview card result

In Slack/Discord/iMessage, the shared link renders as:

```
┌──────────────────────────────────────────┐
│ R→MD                                     │
│ Dead Poets Society. What a movie.        │
│ u/username in r/movies — converted to    │
│ markdown                                 │
└──────────────────────────────────────────┘
```

### Caching

The Worker already caches Reddit JSON responses for 60s via the Cache API. The
OG tag handler should reuse the same cache — if the thread JSON is already
cached from a recent conversion, the bot response is served without an
additional Reddit fetch.

Implementation: extract the Reddit fetch + validation logic from
`handleRedditProxy()` into a shared function that both the API endpoint and
the OG handler can call.

### Fallback

If the Reddit fetch fails (rate limit, timeout, etc.), return a generic OG
response:

```html
<meta property="og:title" content="Reddit Thread — R→MD">
<meta property="og:description" content="Convert Reddit threads to clean markdown">
```

This is no worse than the current behavior, and the link still works.

### Files changed

| File | Change |
|---|---|
| `worker/src/index.ts` | Add bot detection, OG HTML generation, refactor Reddit fetch into shared function |

### Test cases (worker/test/)

| Case | Expected |
|---|---|
| Bot UA + valid `?url=` | 200 HTML with OG tags containing thread title |
| Bot UA + valid `?url=`, Reddit fetch cached | OG response served from cache |
| Bot UA + valid `?url=`, Reddit fetch fails | 200 HTML with generic fallback OG tags |
| Bot UA + no `?url=` | Pass through to Pages (normal SPA) |
| Non-bot UA + valid `?url=` | Pass through to Pages (normal SPA) |

---

## 3. Loading State with Title Hint

### Problem

When a recipient opens a shared link, they see a blank page (or the hero with a
spinner) while the proxy fetches from Reddit. There's no indication of what's
being loaded.

### Solution

Extract a human-readable title hint from the Reddit URL slug before the fetch
completes:

```
https://www.reddit.com/r/movies/comments/1q51kqe/dead_poets_society_what_a_movie/
                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                  "dead_poets_society_what_a_movie"
                                                  → "Dead poets society what a movie"
```

Display this immediately in the loading state:

```
Converting "Dead poets society what a movie"...
```

### Implementation

The URL slug is the 5th path segment. Transform:
1. Split on `/`, take segment after the post ID
2. Replace underscores with spaces
3. Capitalize first letter

```ts
function titleFromSlug(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    // /r/<sub>/comments/<id>/<slug>
    const slug = segments[4];
    if (!slug) return null;
    const title = slug.replace(/_/g, ' ');
    return title.charAt(0).toUpperCase() + title.slice(1);
  } catch {
    return null;
  }
}
```

### Where it shows

In `RedditForm.tsx`, when `loading` is true and a slug title is extractable,
the submit button or an adjacent element shows the hint. In compact mode
(workspace state), this appears in the toolbar area. In hero mode (auto-convert
from `?url=`), it replaces the hero content.

### Files changed

| File | Change |
|---|---|
| `src/components/RedditForm.tsx` | Add `titleFromSlug()`, show hint during loading |

---

## Implementation Order

1. **Share button** — Smallest change, immediately useful. Requires the
   `onSubmit` signature change which is a good refactor regardless.
2. **Loading state** — Small, self-contained, improves the recipient experience
   for shared links.
3. **OG meta tags** — Most complex piece, requires Worker changes and new tests.
   Depends on the share button being in use so there are actually links being
   shared that benefit from preview cards.

## Open Questions

1. **Should the share button share the `?url=` link or the raw markdown?**
   Proposed: share the link (opens R→MD for the recipient). The existing Copy
   button already handles copying raw markdown.

2. **Should the share URL use the URL the user pasted, or normalize it?**
   For example, if the user pasted `old.reddit.com/...`, should the share URL
   use `www.reddit.com/...` instead? Normalization would ensure consistent
   caching and OG tag behavior. Could strip tracking params too.

3. **og:image — worth it?** Generating a dynamic preview image (thread title
   rendered as an image) would make cards much more eye-catching but adds
   significant complexity (image generation service, storage, caching). Listed
   as a non-goal for now but worth revisiting.
