// --- Reddit fetch proxy ---

const ALLOWED_HOSTS = new Set(['www.reddit.com', 'old.reddit.com']);
const THREAD_PATH_RE = /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+(\/[^?#]*)?$/;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 10_000; // 10 s
const CACHE_TTL_SECONDS = 60;
const UPSTREAM_UA =
  'Mozilla/5.0 (compatible; r2md/1.0; +https://peirce.net/reddit) AppleWebKit/537.36';

const BOT_UA_PATTERNS = [
  'Slackbot', 'Discordbot', 'Twitterbot', 'facebookexternalhit',
  'LinkedInBot', 'AppleBot', 'WhatsApp', 'TelegramBot',
];

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isCrawler(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BOT_UA_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

// --- Shared URL validation & fetch ---

type ValidateResult =
  | { ok: true; jsonUrl: string; hostname: string; cleanPath: string }
  | { ok: false; response: Response };

function validateRedditUrl(targetParam: string | null): ValidateResult {
  if (!targetParam) {
    return { ok: false, response: jsonResponse(
      { error: 'missing_url', message: 'Provide a Reddit thread URL as ?url=…' }, 400,
    )};
  }

  let target: URL;
  try {
    target = new URL(targetParam);
  } catch {
    return { ok: false, response: jsonResponse({ error: 'invalid_url', message: 'Not a valid URL' }, 400) };
  }

  if (target.protocol !== 'https:') {
    return { ok: false, response: jsonResponse({ error: 'https_required', message: 'Only HTTPS URLs are allowed' }, 400) };
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return { ok: false, response: jsonResponse({ error: 'host_not_allowed', message: 'Only Reddit URLs are allowed' }, 400) };
  }

  const cleanPath = target.pathname.replace(/\/+$/, '');
  if (!THREAD_PATH_RE.test(cleanPath)) {
    return { ok: false, response: jsonResponse(
      { error: 'invalid_path', message: 'URL must be a Reddit thread (/r/…/comments/…)' }, 400,
    )};
  }

  return {
    ok: true,
    jsonUrl: `https://${target.hostname}${cleanPath}.json`,
    hostname: target.hostname,
    cleanPath,
  };
}

type FetchResult =
  | { ok: true; body: string; data: unknown }
  | { ok: false; response: Response };

async function fetchRedditJson(jsonUrl: string): Promise<FetchResult> {
  // Check cache
  const cache = caches.default;
  const cacheKey = new Request(jsonUrl);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return { ok: true, body, data: JSON.parse(body) };
  }

  // Fetch from Reddit with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(jsonUrl, {
      method: 'GET',
      headers: { 'User-Agent': UPSTREAM_UA },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isTimeout =
      err instanceof DOMException && err.name === 'AbortError';
    return { ok: false, response: isTimeout
      ? jsonResponse({ error: 'upstream_timeout', message: 'Reddit took too long to respond' }, 504)
      : jsonResponse({ error: 'upstream_unreachable', message: 'Could not reach Reddit' }, 502),
    };
  } finally {
    clearTimeout(timeout);
  }

  // Map non-200 statuses
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get('Retry-After');
    return { ok: false, response: jsonResponse(
      { error: 'rate_limited', message: 'Reddit is rate-limiting requests' },
      429,
      retryAfter ? { 'Retry-After': retryAfter } : undefined,
    )};
  }
  if (upstream.status === 403) {
    return { ok: false, response: jsonResponse(
      { error: 'upstream_forbidden', message: 'Reddit blocked this request' }, 502,
    )};
  }
  if (!upstream.ok) {
    return { ok: false, response: jsonResponse(
      { error: 'upstream_error', message: `Reddit returned HTTP ${upstream.status}` }, 502,
    )};
  }

  // Validate content-type
  const ct = upstream.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    return { ok: false, response: jsonResponse(
      { error: 'upstream_parse_error', message: `Expected JSON, got ${ct || 'unknown'}` }, 502,
    )};
  }

  // Read body with size guard
  const body = await upstream.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    return { ok: false, response: jsonResponse({ error: 'response_too_large', message: 'Response exceeded 5 MB limit' }, 502) };
  }

  // Validate JSON
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, response: jsonResponse({ error: 'upstream_parse_error', message: 'Reddit returned invalid JSON' }, 502) };
  }

  // Cache for next time
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await cache.put(cacheKey, response.clone());

  return { ok: true, body, data };
}

// --- Reddit proxy handler ---

async function handleRedditProxy(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const requestUrl = new URL(request.url);
  const validated = validateRedditUrl(requestUrl.searchParams.get('url'));
  if (!validated.ok) return validated.response;

  const result = await fetchRedditJson(validated.jsonUrl);
  if (!result.ok) return result.response;

  return new Response(result.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
}

// --- OG meta tag handler for crawlers ---

function buildOgHtml(
  title: string,
  description: string,
  canonicalUrl: string,
): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(canonicalUrl);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${t} \u2014 R\u2192MD</title>
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:site_name" content="R\u2192MD">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${u}">
  <meta name="twitter:card" content="summary">
</head>
<body>
  <p>Redirecting to <a href="${u}">R\u2192MD</a>\u2026</p>
</body>
</html>`;
}

async function handleOgPreview(redditUrl: string): Promise<Response> {
  const canonicalUrl = `https://peirce.net/reddit?url=${encodeURIComponent(redditUrl)}`;

  const validated = validateRedditUrl(redditUrl);
  if (!validated.ok) {
    // Fallback: generic OG tags
    return htmlResponse(buildOgHtml(
      'Reddit Thread \u2014 R\u2192MD',
      'Convert Reddit threads to clean markdown',
      canonicalUrl,
    ));
  }

  const result = await fetchRedditJson(validated.jsonUrl);
  if (!result.ok) {
    // Fallback: generic OG tags
    return htmlResponse(buildOgHtml(
      'Reddit Thread \u2014 R\u2192MD',
      'Convert Reddit threads to clean markdown',
      canonicalUrl,
    ));
  }

  // Extract thread metadata
  const data = result.data as any[];
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post?.title) {
    return htmlResponse(buildOgHtml(
      'Reddit Thread \u2014 R\u2192MD',
      'Convert Reddit threads to clean markdown',
      canonicalUrl,
    ));
  }

  const title = post.title;
  const author = post.author || 'unknown';
  const subreddit = post.subreddit || 'reddit';
  const description = `u/${author} in r/${subreddit} \u2014 converted to markdown`;

  return htmlResponse(buildOgHtml(title, description, canonicalUrl));
}

// --- Pages proxy ---

async function handlePagesProxy(request: Request, url: URL): Promise<Response> {
  const strippedPath = url.pathname.replace(/^\/reddit\/?/, '/');

  const pagesUrl = new URL(strippedPath, 'https://r2md.pages.dev');
  pagesUrl.search = url.search;

  const headers = new Headers(request.headers);
  headers.set('Host', 'r2md.pages.dev');

  const response = await fetch(pagesUrl.toString(), {
    method: request.method,
    headers,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// --- Entrypoint ---

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/reddit')) {
      return fetch(request);
    }

    // Route /reddit/api/fetch to the Reddit proxy
    if (url.pathname === '/reddit/api/fetch') {
      return handleRedditProxy(request);
    }

    // For page requests with ?url=, check if this is a bot requesting OG tags
    const redditUrl = url.searchParams.get('url');
    if (redditUrl) {
      const ua = request.headers.get('User-Agent') || '';
      if (isCrawler(ua)) {
        return handleOgPreview(redditUrl);
      }
    }

    // Everything else goes to Pages
    return handlePagesProxy(request, url);
  },
};
