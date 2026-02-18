import { useRef, useState } from 'react';
import { Header } from './components/Header';
import { RedditForm } from './components/RedditForm';
import { MarkdownPreview } from './components/MarkdownPreview';
import { Footer } from './components/Footer';

function App() {
  const [markdown, setMarkdown] = useState('');
  const [url, setUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('url') || '';
  });
  const shouldAutoConvert = useRef(
    new URLSearchParams(window.location.search).has('url')
  );
  const hasContent = markdown.length > 0;

  return (
    <div className="page">
      {!hasContent ? (
        <div className="hero">
          <div className="container">
            <Header />
            <RedditForm
              url={url}
              onUrlChange={setUrl}
              onSubmit={setMarkdown}
              autoConvert={shouldAutoConvert.current}
            />
            <p className="bookmarklet-hint">
              Drag to your bookmark bar:{' '}
              <a
                className="bookmarklet-link"
                href={`javascript:void(window.open('${window.location.origin}?url='+encodeURIComponent(window.location.href)))`}
                onClick={(e) => e.preventDefault()}
              >
                R→MD
              </a>
            </p>
          </div>
        </div>
      ) : (
        <>
          <hr className="rule" />
          <div className="container toolbar-area">
            <RedditForm
              url={url}
              onUrlChange={setUrl}
              onSubmit={setMarkdown}
              compact
              onClear={() => setMarkdown('')}
            />
          </div>
          <hr className="rule rule--thin" />
          <div className="container content-area">
            <MarkdownPreview markdown={markdown} />
          </div>
        </>
      )}
      <hr className="rule" />
      <Footer />
    </div>
  );
}

export default App;
