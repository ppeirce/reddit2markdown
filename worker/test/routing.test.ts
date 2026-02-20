import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('main fetch routing', () => {
  it('routes /reddit/api/fetch to Reddit proxy', async () => {
    // No upstream mock — proxy returns 400 for missing ?url=
    const res = await SELF.fetch('https://peirce.net/reddit/api/fetch');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_url' });
  });

  it('routes /reddit to Pages proxy', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/' })
      .reply(200, '<html>pages</html>');

    const res = await SELF.fetch('https://peirce.net/reddit');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('pages');
  });

  it('routes /reddit/anything to Pages proxy', async () => {
    fetchMock
      .get('https://r2md.pages.dev')
      .intercept({ path: '/anything' })
      .reply(200, 'ok');

    const res = await SELF.fetch('https://peirce.net/reddit/anything');
    expect(res.status).toBe(200);
  });

  it('passes through non-/reddit paths', async () => {
    fetchMock
      .get('https://peirce.net')
      .intercept({ path: '/other-page' })
      .reply(200, 'passthrough');

    const res = await SELF.fetch('https://peirce.net/other-page');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('passthrough');
  });
});
