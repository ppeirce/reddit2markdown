import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { pagesUrl } from './helpers';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('Pages proxy', () => {
  it('proxies /reddit to r2md.pages.dev/', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/' })
      .reply(200, '<html>r2md</html>', {
        headers: { 'content-type': 'text/html' },
      });

    const res = await SELF.fetch(pagesUrl('/reddit'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html>');
  });

  it('proxies /reddit/ to r2md.pages.dev/', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/' })
      .reply(200, '<html>r2md</html>');

    const res = await SELF.fetch(pagesUrl('/reddit/'));
    expect(res.status).toBe(200);
  });

  it('strips /reddit prefix from asset paths', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/assets/index-abc123.js' })
      .reply(200, 'console.log("ok")', {
        headers: { 'content-type': 'application/javascript' },
      });

    const res = await SELF.fetch(pagesUrl('/reddit/assets/index-abc123.js'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log("ok")');
  });

  it('forwards query parameters to Pages', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/?url=https%3A%2F%2Freddit.com%2Fr%2Ftest' })
      .reply(200, '<html>with params</html>');

    const res = await SELF.fetch(pagesUrl('/reddit?url=https://reddit.com/r/test'));
    expect(res.status).toBe(200);
  });
});
