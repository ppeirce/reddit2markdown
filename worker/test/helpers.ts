/** Build a request URL for the /reddit/api/fetch proxy endpoint */
export function proxyUrl(redditUrl: string): string {
  return `https://peirce.net/reddit/api/fetch?url=${encodeURIComponent(redditUrl)}`;
}

/** Build a request URL for a Pages-proxied path */
export function pagesUrl(path: string = '/reddit'): string {
  return `https://peirce.net${path}`;
}

/** A valid Reddit thread URL for testing */
export const VALID_THREAD = 'https://www.reddit.com/r/test/comments/abc123/some_title';

/** Minimal valid Reddit JSON response */
export const REDDIT_JSON = JSON.stringify([
  { kind: 'Listing', data: { children: [{ kind: 't3', data: { title: 'Test' } }] } },
  { kind: 'Listing', data: { children: [] } },
]);
