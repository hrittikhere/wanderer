import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Talks, definePlugin, type Theme } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';
import '@wanderer/talks/styles.css';
import './page.css';
import { talks, milestones } from './data';

const workshops = definePlugin({ id: 'workshops', filters: [{ id: 'workshop', label: 'Workshops', order: 5, predicate: (talk) => talk.tags?.includes('workshop') ?? false }] });
const plugins = [workshops];
const responsive = { small: 'list', large: 'globe' };
const parameters = new URLSearchParams(window.location.search);

function App() {
  const [presentation, setPresentation] = useState<'inline' | 'immersive'>(parameters.get('presentation') === 'immersive' ? 'immersive' : 'inline');
  const [theme, setTheme] = useState<Theme>(parameters.get('theme') === 'dark' ? 'dark' : 'light');
  const views = useMemo(() => [globeView({ presentation, intro: false })], [presentation]);
  return (
    <main>
      <header className="page-header">
        <p className="eyebrow">Wanderer / speaking history</p>
        <h1>Ideas travel.</h1>
        <p className="lede">Conversations about platforms, open source and the people building them. Explore the sessions or follow the journey around the world.</p>
        <div className="demo-options">
          <label>Globe presentation <select value={presentation} onChange={(event) => setPresentation(event.target.value as typeof presentation)}><option value="inline">In the page</option><option value="immersive">Fullscreen</option></select></label>
          <label>Appearance <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>
        </div>
      </header>
      <Talks
        talks={talks}
        referenceDate="2026-10-13"
        views={views}
        milestones={milestones}
        plugins={plugins}
        theme={theme}
        direction={parameters.get('dir') === 'rtl' ? 'rtl' : 'ltr'}
        // Query options the browser tests use: ?escape=false and ?responsive=1.
        escapeToList={parameters.get('escape') !== 'false'}
        responsive={parameters.has('responsive') ? responsive : undefined}
      />
      <footer>Synthetic sample data. <a href="https://github.com/hrittikhere/wanderer">Explore Wanderer on GitHub</a></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
