import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { VALID_THREAD, REDDIT_JSON, pageUrlWithThread, BOT_UA, BROWSER_UA } from './helpers';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('OG preview for crawlers', () => {
  it('returns OG HTML with thread title for bot UA + valid ?url=', async () => {
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/test/comments/abc123/some_title.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json' },
      });

    const res = await SELF.fetch(pageUrlWithThread(VALID_THREAD), {
      headers: { 'User-Agent': BOT_UA },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('og:title');
    expect(html).toContain('Test');
    expect(html).toContain('u/testuser in r/test');
  });

  it('serves OG response from cache on second bot request', async () => {
    const cacheThread = 'https://www.reddit.com/r/cached/comments/def456/cached_thread';
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/cached/comments/def456/cached_thread.json' })
      .reply(200, REDDIT_JSON, {
        headers: { 'content-type': 'application/json' },
      });

    // First request — hits upstream, populates cache
    const res1 = await SELF.fetch(pageUrlWithThread(cacheThread), {
      headers: { 'User-Agent': BOT_UA },
    });
    expect(res1.status).toBe(200);
    expect(await res1.text()).toContain('Test');

    // Second request — no mock, so upstream would fail. If cache works, it succeeds.
    const res2 = await SELF.fetch(pageUrlWithThread(cacheThread), {
      headers: { 'User-Agent': BOT_UA },
    });
    expect(res2.status).toBe(200);
    const html = await res2.text();
    expect(html).toContain('og:title');
    expect(html).toContain('Test');
  });

  it('returns generic fallback OG tags when Reddit fetch fails', async () => {
    const failThread = 'https://www.reddit.com/r/fail/comments/zzz999/will_fail';
    fetchMock
      .get('https://www.reddit.com')
      .intercept({ path: '/r/fail/comments/zzz999/will_fail.json' })
      .reply(500, 'Internal Server Error');

    const res = await SELF.fetch(pageUrlWithThread(failThread), {
      headers: { 'User-Agent': BOT_UA },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('og:title');
    expect(html).toContain('Reddit Thread');
    expect(html).toContain('Convert Reddit threads to clean markdown');
  });

  it('passes through to Pages for bot UA without ?url=', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/' })
      .reply(200, '<html>pages</html>');

    const res = await SELF.fetch('https://peirce.net/reddit', {
      headers: { 'User-Agent': BOT_UA },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('pages');
  });

  it('passes through to Pages for non-bot UA with valid ?url=', async () => {
    const threadUrl = 'https://www.reddit.com/r/test/comments/abc123/some_title';
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: `/?url=${encodeURIComponent(threadUrl)}` })
      .reply(200, '<html>spa</html>');

    const res = await SELF.fetch(pageUrlWithThread(threadUrl), {
      headers: { 'User-Agent': BROWSER_UA },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('spa');
  });
});

describe('bot detection', () => {
  // These tests verify that each bot UA triggers the OG handler
  // rather than passing through to Pages. The Reddit JSON may be
  // cached from earlier tests or the fetch may fail (returning fallback
  // OG) — either way, getting HTML with og:title proves detection worked.
  const bots = [
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Twitter', 'Twitterbot/1.0'],
    ['Facebook', 'facebookexternalhit/1.1'],
    ['LinkedIn', 'LinkedInBot/1.0'],
    ['Apple', 'AppleBot/0.1'],
    ['WhatsApp', 'WhatsApp/2.23'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
  ];

  for (const [name, ua] of bots) {
    it(`detects ${name} as a crawler`, async () => {
      const res = await SELF.fetch(pageUrlWithThread(VALID_THREAD), {
        headers: { 'User-Agent': ua },
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('og:title');
    });
  }
});
