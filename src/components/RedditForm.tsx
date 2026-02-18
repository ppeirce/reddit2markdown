import React, { useState } from 'react';

interface RedditFormProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (markdown: string) => void;
  compact?: boolean;
  onClear?: () => void;
}

export function RedditForm({ url, onUrlChange, onSubmit, compact, onClear }: RedditFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const jsonUrl = url.replace(/\/?$/, '.json');
      const response = await fetch(jsonUrl);
      const data = await response.json();

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
      setError('Could not fetch that thread');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
