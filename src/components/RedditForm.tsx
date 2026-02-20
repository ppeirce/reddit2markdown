import React, { useEffect, useRef, useState } from 'react';

interface RedditFormProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (result: { markdown: string; title: string }) => void;
  compact?: boolean;
  onClear?: () => void;
  autoConvert?: boolean;
}

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

export function RedditForm({ url, onUrlChange, onSubmit, compact, onClear, autoConvert }: RedditFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasAutoConverted = useRef(false);

  const processComment = (comment: any, depth = 0): string => {
    const indent = "> ".repeat(depth);
    let mdComment = `${indent}**u/${comment.data.author}**\n`;

    const commentBody = comment.data.body
      .split('\n')
      .map((line: string) => `${indent}${line}`)
      .join('\n');
    mdComment += `${commentBody}\n\n`;

    if (comment.data.replies?.data?.children) {
      comment.data.replies.data.children.forEach((child: any) => {
        if (child.kind === 't1') {
          mdComment += processComment(child, depth + 1);
        }
      });
    }

    return mdComment;
  };

  const convert = async () => {
    setLoading(true);
    setError('');

    try {
      let data: any;

      // Try direct fetch first (user's own IP, distributed rate limit).
      // cache: 'no-store' bypasses Safari's HTTP cache, which can contain
      // non-CORS responses from prior reddit.com visits that block fetch().
      const cleanUrl = url.replace(/\/?(\?.*)?$/, '');
      const jsonUrl = cleanUrl + '.json';

      try {
        const directRes = await fetch(jsonUrl, { cache: 'no-store' });
        if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
        data = await directRes.json();
      } catch (directErr) {
        // Direct failed (e.g. CORS on iOS Safari) — fall back to proxy
        console.warn('[r2md] Direct fetch failed, using proxy:', directErr);

        const proxyUrl = `${import.meta.env.BASE_URL}api/fetch?url=${encodeURIComponent(url)}`;

        let response: Response;
        try {
          response = await fetch(proxyUrl);
        } catch (fetchErr) {
          console.error('[r2md] Proxy fetch failed:', fetchErr);
          setError('Network error — could not reach the server');
          return;
        }

        // Proxy returns structured JSON errors for non-200 responses
        if (!response.ok) {
          let errorBody: { error?: string; message?: string } = {};
          try {
            errorBody = await response.json();
          } catch {
            // non-JSON error response
          }
          const code = errorBody.error || 'unknown';
          console.error(`[r2md] Proxy error: ${response.status} ${code}`);

          const messages: Record<string, string> = {
            rate_limited: 'Reddit is rate-limiting requests — try again in a minute',
            upstream_forbidden: 'Reddit blocked this request — try again later',
            upstream_timeout: 'Reddit took too long to respond — try again',
            upstream_unreachable: 'Could not reach Reddit — try again later',
            upstream_error: errorBody.message || 'Reddit returned an error',
            upstream_parse_error: 'Got an unexpected response from Reddit',
            response_too_large: 'That thread is too large to convert',
            invalid_url: 'That doesn\u2019t look like a valid URL',
            invalid_path: 'That doesn\u2019t look like a Reddit thread URL',
            host_not_allowed: 'Only Reddit URLs are supported',
          };
          setError(messages[code] || errorBody.message || `Something went wrong (${code})`);
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.error(`[r2md] Expected JSON but got content-type: ${contentType}`);
          setError('Got an unexpected response from the server');
          return;
        }

        try {
          data = await response.json();
        } catch (parseErr) {
          console.error('[r2md] JSON parse failed:', parseErr);
          setError('Got an invalid response from the server');
          return;
        }
      }

      if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) {
        console.error('[r2md] Unexpected JSON shape:', JSON.stringify(data).slice(0, 200));
        setError('Unexpected response — is this a Reddit thread URL?');
        return;
      }

      const post = data[0].data.children[0].data;
      let md = `# ${post.title}\n\n`;
      md += `*Posted by u/${post.author}*\n\n`;
      md += `${post.selftext}\n\n---\n\n`;

      data[1].data.children.forEach((comment: any) => {
        if (comment.kind === 't1') {
          md += processComment(comment, 0);
        }
      });

      onSubmit({ markdown: md, title: post.title });
    } catch (err) {
      console.error('[r2md] Unexpected error:', err);
      setError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    convert();
  };

  useEffect(() => {
    if (autoConvert && url && !hasAutoConverted.current) {
      hasAutoConverted.current = true;
      convert();
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className={compact ? 'form-compact' : ''}>
      <div className="form-row">
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://reddit.com/r/..."
          required
          className="form-input"
        />
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Converting\u2026' : 'Convert \u2192'}
        </button>
        {compact && onClear && (
          <button type="button" onClick={onClear} className="btn-text">
            Clear
          </button>
        )}
      </div>
      {loading && titleFromSlug(url) && (
        <p className="loading-hint">Converting &ldquo;{titleFromSlug(url)}&rdquo;&hellip;</p>
      )}
      {error && <p className="error-msg">{error}</p>}
    </form>
  );
}
