import { useState } from 'react';

interface MarkdownPreviewProps {
  markdown: string;
  shareUrl: string;
  title: string;
}

export function MarkdownPreview({ markdown, shareUrl, title }: MarkdownPreviewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
      } catch (err) {
        // User cancelled or share failed — ignore AbortError
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('[r2md] Share failed:', err);
        }
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const decodeHTML = (text: string): string => {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  };

  const renderMarkdown = (text: string) => {
    return text.split('\n').map((raw, i) => {
      const line = decodeHTML(raw);
      if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
      if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
      if (line.startsWith('**') && line.endsWith('**'))
        return <strong key={i} className="block mb-1">{line.slice(2, -2)}</strong>;
      if (line.startsWith('*') && line.endsWith('*'))
        return <em key={i} className="block mb-1">{line.slice(1, -1)}</em>;
      if (line === '---') return <hr key={i} />;
      if (line.trim().startsWith('>')) {
        const match = line.match(/^((?:>\s?)+)\s*(.*)$/);
        if (match) {
          const level = (match[1].match(/>/g) || []).length;
          const content = match[2];
          const trimmed = content.trim();
          const inner = /^\*\*u\/.+\*\*$/.test(trimmed)
            ? <strong>{trimmed.slice(2, -2)}</strong>
            : <p>{content}</p>;
          let node: JSX.Element = inner;
          for (let j = 0; j < level; j++) {
            node = <blockquote key={`${i}-${j}`}>{node}</blockquote>;
          }
          return node;
        }
      }
      return line ? <p key={i}>{line}</p> : <br key={i} />;
    });
  };

  return (
    <div className="fade-in">
      <div className="preview-controls">
        <div className="preview-tabs">
          <button
            onClick={() => setShowRaw(false)}
            className={`btn-tab ${!showRaw ? 'active' : ''}`}
          >
            Rendered
          </button>
          <button
            onClick={() => setShowRaw(true)}
            className={`btn-tab ${showRaw ? 'active' : ''}`}
          >
            Raw
          </button>
        </div>
        <div className="preview-tabs">
          <button onClick={copyToClipboard} className="btn-tab">
            {copied ? 'Copied' : 'Copy'}
          </button>
          {shareUrl && (
            <button onClick={share} className="btn-tab">
              {shared ? 'Copied' : 'Share'}
            </button>
          )}
        </div>
      </div>

      <div className="preview-body">
        {showRaw ? (
          <pre className="raw-output">{markdown}</pre>
        ) : (
          <div className="md-rendered">{renderMarkdown(markdown)}</div>
        )}
      </div>
    </div>
  );
}
