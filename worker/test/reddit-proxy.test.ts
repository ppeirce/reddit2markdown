import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { proxyUrl, VALID_THREAD, REDDIT_JSON } from './helpers';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

// -- Input validation --------------------------------------------------

describe('input validation', () => {
  it('returns 400 missing_url when ?url= is absent', async () => {
    const res = await SELF.fetch('https://peirce.net/reddit/api/fetch');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_url' });
  });

  it('returns 400 invalid_url for malformed URL', async () => {
    const res = await SELF.fetch(proxyUrl('not-a-url'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_url' });
  });

  it('returns 400 https_required for http:// URL', async () => {
    const res = await SELF.fetch(
      proxyUrl('http://www.reddit.com/r/test/comments/abc123/title'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'https_required' });
  });

  it('returns 400 host_not_allowed for non-Reddit hostname', async () => {
    const res = await SELF.fetch(
      proxyUrl('https://evil.com/r/test/comments/abc123/title'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'host_not_allowed' });
  });

  it('returns 400 invalid_path for subreddit listing (no /comments/)', async () => {
    const res = await SELF.fetch(
      proxyUrl('https://www.reddit.com/r/movies'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_path' });
  });

  it('returns 400 invalid_path for Reddit homepage', async () => {
    const res = await SELF.fetch(proxyUrl('https://www.reddit.com/'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_path' });
  });
});

// -- Method restriction ------------------------------------------------

describe('method restriction', () => {
  it('returns 405 for POST', async () => {
    const res = await SELF.fetch(proxyUrl(VALID_THREAD), { method: 'POST' });
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: 'method_not_allowed' });
  });

  it('returns 405 for PUT', async () => {
    const res = await SELF.fetch(proxyUrl(VALID_THREAD), { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: 'method_not_allowed' });
  });
});

// -- Upstream error mapping --------------------------------------------

describe('upstream error mapping', () => {
  it('maps Reddit 429 to 429 with rate_limited and Retry-After', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(429, '', { headers: { 'Retry-After': '30' } });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('maps Reddit 429 without Retry-After', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(429, '');

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('maps Reddit 403 to 502 upstream_forbidden', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(403, '<html>Forbidden</html>');

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_forbidden' });
  });

  it('maps Reddit 500 to 502 upstream_error', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(500, 'Internal Server Error');

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error' });
  });

  it('maps Reddit 503 to 502 upstream_error', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(503, 'Service Unavailable');

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error' });
  });

  it('returns 502 upstream_parse_error when Content-Type is text/html', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, '<html>challenge page</html>', {
        headers: { 'content-type': 'text/html' },
      });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_parse_error' });
  });

  it('returns 502 upstream_parse_error when body is not valid JSON', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, 'this is not json{{{', {
        headers: { 'content-type': 'application/json' },
      });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_parse_error' });
  });

  it('returns 502 response_too_large when body exceeds 5 MB', async () => {
    const largeBody = 'x'.repeat(5 * 1024 * 1024 + 1);
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, largeBody, {
        headers: { 'content-type': 'application/json' },
      });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'response_too_large' });
  });

  it('returns 504 upstream_timeout on AbortError', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .replyWithError(new DOMException('The operation was aborted', 'AbortError'));

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: 'upstream_timeout' });
  });

  it('returns 502 upstream_unreachable on network error', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .replyWithError(new Error('network failure'));

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_unreachable' });
  });
});

// -- Happy path --------------------------------------------------------

describe('happy path', () => {
  it('returns 200 with proxied JSON for valid thread URL', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = await res.json();
    expect(body[0].kind).toBe('Listing');
  });

  it('strips trailing slash from Reddit URL path', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json' },
      });

    const res = await SELF.fetch(proxyUrl(VALID_THREAD + '/'));
    expect(res.status).toBe(200);
  });

  it('accepts old.reddit.com hostname', async () => {
    fetchMock
      .get('https://old.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json' },
      });

    const res = await SELF.fetch(
      proxyUrl('https://old.reddit.com/r/test/comments/abc123/some_title'),
    );
    expect(res.status).toBe(200);
  });

  it('serves second request from cache without upstream fetch', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json' },
      });

    // First request — hits upstream
    const res1 = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res1.status).toBe(200);

    // Second request — no mock set up, so if it hits upstream it will throw.
    // If it serves from cache, it succeeds.
    const res2 = await SELF.fetch(proxyUrl(VALID_THREAD));
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body[0].kind).toBe('Listing');
  });
});
