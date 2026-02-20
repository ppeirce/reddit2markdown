import React, { useEffect, useRef, useState } from 'react';

interface RedditFormProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (markdown: string) => void;
  compact?: boolean;
  onClear?: () => void;
  autoConvert?: boolean;
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
      const jsonUrl = url.replace(/\/?$/, '.json');

      let response: Response;
      try {
        response = await fetch(jsonUrl);
      } catch (fetchErr) {
        // TypeError: Failed to fetch → CORS block or network error
        console.error('[r2md] fetch failed:', fetchErr);
        setError(`Network error — could not reach Reddit (${fetchErr instanceof TypeError ? 'CORS or network' : String(fetchErr)})`);
        return;
      }

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || 'unknown';
        console.error(`[r2md] Reddit returned HTTP ${response.status} (${contentType})`);
        if (response.status === 429) {
          setError(`Reddit is rate-limiting requests (HTTP 429) — try again in a minute`);
        } else if (response.status === 403) {
          setError(`Reddit blocked this request (HTTP 403)`);
        } else {
          setError(`Reddit returned an error (HTTP ${response.status})`);
        }
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error(`[r2md] Expected JSON but got content-type: ${contentType}`);
        setError(`Reddit returned non-JSON response (${contentType || 'no content-type'})`);
        return;
      }

      let data: any;
      try {
        data = await response.json();
      } catch (parseErr) {
        console.error('[r2md] JSON parse failed:', parseErr);
        setError('Reddit returned invalid JSON');
        return;
      }

      if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) {
        console.error('[r2md] Unexpected JSON shape:', JSON.stringify(data).slice(0, 200));
        setError('Unexpected response structure — is this a Reddit thread URL?');
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

      onSubmit(md);
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
          {loading ? 'Working\u2026' : 'Convert \u2192'}
        </button>
        {compact && onClear && (
          <button type="button" onClick={onClear} className="btn-text">
            Clear
          </button>
        )}
      </div>
      {error && <p className="error-msg">{error}</p>}
    </form>
  );
}
