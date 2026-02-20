// --- Reddit fetch proxy ---

const ALLOWED_HOSTS = new Set(['www.reddit.com', 'old.reddit.com']);
const THREAD_PATH_RE = /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+(\/[^?#]*)?$/;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 10_000; // 10 s
const CACHE_TTL_SECONDS = 60;
const UPSTREAM_UA =
  'Mozilla/5.0 (compatible; r2md/1.0; +https://peirce.net/reddit) AppleWebKit/537.36';

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

async function handleRedditProxy(request: Request): Promise<Response> {
  // GET only
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const requestUrl = new URL(request.url);
  const targetParam = requestUrl.searchParams.get('url');

  if (!targetParam) {
    return jsonResponse(
      { error: 'missing_url', message: 'Provide a Reddit thread URL as ?url=…' },
      400,
    );
  }

  // Parse & validate target URL
  let target: URL;
  try {
    target = new URL(targetParam);
  } catch {
    return jsonResponse({ error: 'invalid_url', message: 'Not a valid URL' }, 400);
  }

  if (target.protocol !== 'https:') {
    return jsonResponse({ error: 'https_required', message: 'Only HTTPS URLs are allowed' }, 400);
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return jsonResponse({ error: 'host_not_allowed', message: 'Only Reddit URLs are allowed' }, 400);
  }

  const cleanPath = target.pathname.replace(/\/+$/, '');
  if (!THREAD_PATH_RE.test(cleanPath)) {
    return jsonResponse(
      { error: 'invalid_path', message: 'URL must be a Reddit thread (/r/…/comments/…)' },
      400,
    );
  }

  // Build the .json endpoint URL
  const jsonUrl = `https://${target.hostname}${cleanPath}.json`;

  // Check cache
  const cache = caches.default;
  const cacheKey = new Request(jsonUrl);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

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
    return isTimeout
      ? jsonResponse({ error: 'upstream_timeout', message: 'Reddit took too long to respond' }, 504)
      : jsonResponse({ error: 'upstream_unreachable', message: 'Could not reach Reddit' }, 502);
  } finally {
    clearTimeout(timeout);
  }

  // Map non-200 statuses
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get('Retry-After');
    return jsonResponse(
      { error: 'rate_limited', message: 'Reddit is rate-limiting requests' },
      429,
      retryAfter ? { 'Retry-After': retryAfter } : undefined,
    );
  }
  if (upstream.status === 403) {
    return jsonResponse(
      { error: 'upstream_forbidden', message: 'Reddit blocked this request' },
      502,
    );
  }
  if (!upstream.ok) {
    return jsonResponse(
      { error: 'upstream_error', message: `Reddit returned HTTP ${upstream.status}` },
      502,
    );
  }

  // Validate content-type
  const ct = upstream.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    return jsonResponse(
      { error: 'upstream_parse_error', message: `Expected JSON, got ${ct || 'unknown'}` },
      502,
    );
  }

  // Read body with size guard
  const body = await upstream.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    return jsonResponse({ error: 'response_too_large', message: 'Response exceeded 5 MB limit' }, 502);
  }

  // Validate JSON
  try {
    JSON.parse(body);
  } catch {
    return jsonResponse({ error: 'upstream_parse_error', message: 'Reddit returned invalid JSON' }, 502);
  }

  // Return and cache
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  // Cache API requires cloning since the body can only be consumed once
  await cache.put(cacheKey, response.clone());
  return response;
}

// --- Pages proxy (existing) ---

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

    // Everything else goes to Pages
    return handlePagesProxy(request, url);
  },
};
