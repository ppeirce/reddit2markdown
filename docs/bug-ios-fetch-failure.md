# Bug: "Could not fetch that thread" on iPhone

**Reported:** 2026-02-20
**Status:** Root cause confirmed — fix deployed
**Severity:** Medium (platform-specific, inconsistent)

## Report

A user reports that converting a Reddit thread via `peirce.net/reddit` fails on
iPhone with "Could not fetch that thread", but works fine on their Mac.

Test URL: `https://www.reddit.com/r/movies/comments/1q51kqe/dead_poets_society_what_a_movie/`

The failure is described as inconsistent — not every user may experience it, and
conditions may vary.

## Architecture Context

The app is a static React + TypeScript SPA (hosted on Cloudflare Pages at
`r2md.pages.dev`, proxied through a Cloudflare Worker at `peirce.net/reddit`).

The critical path: when a user clicks "Convert", **the browser itself** makes a
direct cross-origin `fetch()` to Reddit's public `.json` endpoint:

```ts
// src/components/RedditForm.tsx:43-45
const jsonUrl = url.replace(/\/?$/, '.json');
const response = await fetch(jsonUrl);
const data = await response.json();
```

There is no server-side proxy. The request goes directly from the user's browser
to `www.reddit.com`.

## Investigation

### 1. User-Agent discrimination (confirmed)

Reddit's `.json` endpoint returns different responses based on User-Agent:

| User-Agent | Status | Content-Type |
|---|---|---|
| *(none / curl default)* | 403 | text/html (190KB) |
| `Mozilla/5.0` (short) | 403 | text/html (1.5KB) |
| Full desktop browser UA | 200 | application/json |
| Full iPhone Safari UA | 200 | application/json |

Both desktop and mobile browser UAs get 200 JSON from curl. So the server
doesn't discriminate by platform at the HTTP level — at least not from curl.

### 2. Reddit's CORS preflight is broken (confirmed server-side, unconfirmed as trigger)

Reddit's `.json` endpoint handles CORS inconsistently:

**GET request** — CORS headers present:
```
access-control-allow-origin: *
access-control-expose-headers: X-Moose
```

**OPTIONS (preflight) request** — NO CORS headers at all:
```
HTTP/2 200
content-length: 0
(no access-control-allow-origin)
(no access-control-allow-methods)
```

A `fetch(url)` with no custom headers is normally a "simple request" that
doesn't trigger preflight. **We have not confirmed via iOS network trace that
Safari actually sends OPTIONS for this request.** This is a plausible failure
path but not a proven one — see "Next steps" for how to confirm.

### 3. No `response.ok` check — HTML parsed as JSON (confirmed)

The code does not check `response.ok` before calling `response.json()`. A 403 or
429 from Reddit returns HTML, which causes `response.json()` to throw a
`SyntaxError`. This is a confirmed code-level bug regardless of the iOS-specific
trigger.

Possible error types that all show as "Could not fetch that thread":

| Actual cause | Error type | What happens |
|---|---|---|
| CORS preflight blocked | `TypeError: Failed to fetch` | Browser blocks request entirely |
| Reddit returns 403 HTML | `SyntaxError` from `.json()` | HTML can't be parsed as JSON |
| Reddit rate limit (429) | `SyntaxError` from `.json()` | Rate limit page isn't JSON |
| Unexpected JSON structure | `TypeError: Cannot read property` | `data[0].data.children[0]` fails |
| Network error (timeout, DNS) | `TypeError: Failed to fetch` | Request never completes |

### 4. Rate limiting on shared IPs (confirmed mechanism, hypothesized as trigger)

Reddit's rate limit headers show ~100 requests per 10-minute window per IP:

```
x-ratelimit-used: 14
x-ratelimit-remaining: 86.0
x-ratelimit-reset: 404
```

If the iPhone is on cellular, it shares a carrier-grade NAT IP with potentially
thousands of other users. If other Reddit traffic from that IP has already
consumed the quota, the request returns a non-JSON error response. This is a
plausible trigger but unconfirmed for this specific user's case.

### 5. iOS Safari's stricter cross-origin handling (hypothesis)

iOS Safari ships with **Prevent Cross-Site Tracking** (ITP) enabled by default.
This feature:

- Partitions network state and cookies by first-party site
- May modify or restrict cross-origin requests in ways desktop browsers don't
- Varies in behavior across iOS versions

**This is a hypothesis.** We have no direct evidence that ITP interfered with
this specific request. It is plausible that ITP triggers a preflight or modifies
the request in a way that causes Reddit to respond differently, but this needs
confirmation via an actual iOS Safari network trace.

## Confidence Summary

| Finding | Status |
|---|---|
| Reddit blocks requests without full browser UA | **Confirmed** (curl) |
| Reddit OPTIONS response lacks CORS headers | **Confirmed** (curl) |
| Code doesn't check `response.ok` before `.json()` | **Confirmed** (code review) |
| All errors produce same generic message | **Confirmed** (code review) |
| Reddit rate-limits at ~100 req/10min per IP | **Confirmed** (response headers) |
| iOS Safari blocks cross-origin fetch to Reddit | **Confirmed** (users see "CORS or network" TypeError) |
| Exact iOS trigger (preflight vs ITP vs other) | **Unconfirmed** (no network trace of specific mechanism) |
| Cellular carrier NAT exhausts rate limit | **Plausible** (no user network info) |

## Why "Inconsistent"

The inconsistency likely comes from a combination of factors:

- **Network path**: WiFi vs cellular → different IPs → different rate limit
  buckets and Cloudflare reputation scores
- **iOS version**: Different Safari/WebKit versions have different ITP behaviors
  and preflight heuristics
- **Reddit's edge behavior**: Cloudflare challenges are served intermittently
  based on IP reputation, traffic patterns, and time of day
- **Same user, different device**: Mac on WiFi (clean IP, desktop browser, no
  preflight) vs iPhone on cellular (shared IP, stricter browser, possible
  preflight)

## Proposed Solution: Server-Side Proxy

### Problem

Direct client-side `fetch()` to Reddit is inherently fragile — it depends on
Reddit's CORS configuration, the browser's cross-origin behavior, network
conditions, and rate limits that are all outside our control.

### Fix

Add a proxy endpoint to the existing Cloudflare Worker (`worker/src/index.ts`)
that fetches Reddit data server-side and returns it to the client.

**Request flow (current — fragile):**
```
iPhone Safari → reddit.com/.json   (cross-origin, CORS-dependent)
```

**Request flow (proposed — robust):**
```
iPhone Safari → peirce.net/reddit/api/fetch?url=...  (same-origin)
                    ↓
              Cloudflare Worker → reddit.com/.json    (server-side, no CORS)
                    ↓
              JSON returned to browser
```

### Benefits

- **Eliminates CORS entirely** — browser makes a same-origin request to our own
  worker
- **Eliminates iOS Safari privacy interference** — no cross-origin request means
  ITP has nothing to block
- **Consistent User-Agent and IP** — Cloudflare's edge servers make the request,
  not the user's browser
- **Proper error handling** — the worker can check Reddit's response status,
  parse errors, and return meaningful error messages
- **Caching opportunity** — the worker can cache Reddit responses to reduce
  redundant requests and avoid rate limits
- **Works identically across all devices and browsers**

### Security Constraints

The proxy MUST NOT be an open relay. Required safeguards:

- **URL allowlist**: Only proxy requests to Reddit hosts (`www.reddit.com`,
  `old.reddit.com`, `oauth.reddit.com`). Reject all other domains.
- **HTTPS only**: Reject any non-HTTPS target URL.
- **GET only**: The proxy endpoint only accepts GET requests and only makes GET
  requests upstream.
- **Private IP blocking**: Reject target URLs that resolve to private/loopback
  IP ranges (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `::1`, `fd00::/8`)
  to prevent SSRF against internal services.
- **Path validation**: Only allow paths matching Reddit's thread URL pattern
  (`/r/<subreddit>/comments/<id>/...`). Reject arbitrary Reddit paths.
- **Response size limit**: Cap response body at ~5MB to prevent memory exhaustion
  on the worker.
- **Timeout**: Set a fetch timeout (e.g., 10s) to prevent the worker from
  hanging on slow Reddit responses.

### Worker Operational Behavior

The proxy should handle Reddit error responses gracefully:

| Reddit status | Worker behavior |
|---|---|
| 200 + valid JSON | Return JSON with `200` and `application/json` content type |
| 200 + non-JSON | Return `502` with `{"error": "upstream_parse_error"}` |
| 403 | Return `502` with `{"error": "upstream_forbidden"}` |
| 429 | Return `429` with `{"error": "rate_limited"}` + `Retry-After` if present |
| 5xx | Return `502` with `{"error": "upstream_error"}` |
| Timeout | Return `504` with `{"error": "upstream_timeout"}` |

Additional worker concerns:

- **User-Agent**: Use a stable, descriptive UA string (e.g.,
  `r2md/1.0 (peirce.net/reddit; server-side proxy)`)
- **Caching**: Cache successful responses for a short TTL (e.g., 60s) using
  Cloudflare's Cache API to reduce redundant upstream requests
- **Backoff**: If Reddit returns 429, respect `Retry-After` and return the same
  to the client rather than retrying immediately

### Client Error Handling

Update `RedditForm.tsx` to provide structured error mapping:

| Proxy response | User-facing message |
|---|---|
| Network error / timeout | "Couldn't reach the server — check your connection" |
| 429 (rate limited) | "Reddit is rate-limiting requests — try again in a minute" |
| 502 (upstream forbidden) | "Reddit blocked this request — try again later" |
| 502 (upstream parse error) | "Got an unexpected response from Reddit" |
| 504 (upstream timeout) | "Reddit took too long to respond — try again" |
| 200 but JSON shape invalid | "That doesn't look like a Reddit thread" |

Additionally:

- Validate `Content-Type: application/json` on the proxy response before parsing
- Validate expected JSON shape (`data[0].data.children[0].data`) before
  accessing nested properties
- Log the actual error type to `console.error` for debugging

### Implementation Scope

1. Add `/reddit/api/fetch` route to `worker/src/index.ts` with security
   constraints and operational error handling described above
2. Update `RedditForm.tsx` to call the proxy endpoint instead of Reddit directly
3. Add `response.ok` checking, `Content-Type` validation, JSON shape validation,
   and structured error messages in the client
4. Deploy updated worker and Pages app

## Acceptance Criteria

The fix is complete when:

- [ ] Converting any valid Reddit thread URL works identically on iOS Safari and
  desktop browsers
- [ ] The proxy rejects non-Reddit URLs (returns 400)
- [ ] The proxy rejects non-HTTPS, non-GET, and non-thread-path requests
- [ ] Reddit 403/429/5xx responses produce specific, helpful error messages in
  the client instead of generic "Could not fetch"
- [ ] Malformed or non-Reddit URLs produce a clear "not a valid Reddit thread"
  message
- [ ] Worker response size and timeout limits are enforced

## Reproduction Test Matrix

To verify the fix across the conditions most likely to trigger the original bug:

| # | Device | Browser | Network | ITP | Expected |
|---|---|---|---|---|---|
| 1 | iPhone (latest iOS) | Safari | WiFi | On (default) | Pass |
| 2 | iPhone (latest iOS) | Safari | Cellular | On (default) | Pass |
| 3 | iPhone (latest iOS) | Safari | WiFi | Off | Pass |
| 4 | iPhone (iOS 16.x) | Safari | WiFi | On (default) | Pass |
| 5 | iPhone | Chrome for iOS | WiFi | N/A | Pass |
| 6 | Mac | Safari | WiFi | On | Pass |
| 7 | Mac | Chrome | WiFi | N/A | Pass |

For each row, test with the original report URL:
`https://www.reddit.com/r/movies/comments/1q51kqe/dead_poets_society_what_a_movie/`

## Resolution

### Diagnostic phase (2026-02-20)

Deployed structured error handling to the client that distinguishes CORS/network
errors, HTTP status errors, content-type mismatches, JSON parse failures, and
unexpected response shapes. iPhone users confirmed seeing:

> Network error — could not reach Reddit (CORS or network)

This is a `TypeError` thrown by `fetch()` itself — the browser blocks the request
before receiving any response. This confirms the CORS/network block hypothesis
and rules out rate limiting, Reddit 403s, and response parsing as the cause.

### Fix (2026-02-20)

Deployed a server-side proxy at `/reddit/api/fetch` in the Cloudflare Worker.
The client now makes a same-origin request to the proxy, which fetches Reddit's
`.json` endpoint server-side and returns the data. This eliminates all
browser-mediated cross-origin behavior.

The exact iOS Safari trigger (CORS preflight vs ITP vs other) remains
unconfirmed, but the proxy makes it moot — there is no longer a cross-origin
request for the browser to block.

## Remaining open questions

1. **Exact iOS Safari mechanism**: A Safari Web Inspector network trace would
   confirm whether iOS sends an OPTIONS preflight or blocks the request via ITP.
   Academic at this point since the proxy bypasses the issue entirely.
2. **Pages auto-deploy**: The Cloudflare Pages build config has a broken deploy
   command (`npx wrangler deploy`) that should be removed. Auto-deploy from
   GitHub pushes is currently not working.
