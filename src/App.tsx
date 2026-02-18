import { useState } from 'react';
import { Header } from './components/Header';
import { RedditForm } from './components/RedditForm';
import { MarkdownPreview } from './components/MarkdownPreview';
import { Footer } from './components/Footer';

function App() {
  const [markdown, setMarkdown] = useState('');
  const [url, setUrl] = useState('');
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
            />
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
