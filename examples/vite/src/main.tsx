import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { definePlugin, type Theme } from '@wanderer/talks';
import { Wanderer } from '@wanderer/talks/globe';
import '@wanderer/talks/styles.css';
import './page.css';
import { talks, milestones } from './data';

const workshops = definePlugin({ id: 'workshops', filters: [{ id: 'workshop', label: 'Workshops', order: 5, predicate: (talk) => talk.tags?.includes('workshop') ?? false }] });
const plugins = [workshops];
const responsive = { small: 'list', large: 'globe' };
const parameters = new URLSearchParams(window.location.search);
const themes: readonly Theme[] = ['light', 'dark', 'system'];
const additionNames = ['Sidebox', 'List', 'Search', 'Filters', 'ResultCount', 'Hint'] as const;
const additionLabels = { Sidebox: 'sidebox', List: 'list view', Search: 'search', Filters: 'filters', ResultCount: 'result count', Hint: 'globe hint' };
const allAdditions = parameters.get('demo') === 'all';

function App() {
  const [presentation, setPresentation] = useState<'inline' | 'immersive'>(parameters.get('presentation') === 'immersive' ? 'immersive' : 'inline');
  const [theme, setTheme] = useState<Theme>(themes.find((value) => value === parameters.get('theme')) ?? 'light');
  const [additions, setAdditions] = useState(() => Object.fromEntries(additionNames.map((name) => [name, allAdditions])) as Record<typeof additionNames[number], boolean>);
  // The page around the component follows the same appearance (page.css uses light-dark()).
  useEffect(() => { document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme; }, [theme]);
  return (
    <main>
      <header className="page-header">
        <p className="eyebrow">Wanderer / speaking history</p>
        <h1>Ideas travel.</h1>
        <p className="lede">A globe and the milestones along the way. Add the controls your page needs.</p>
        <div className="demo-options">
          <label>Globe presentation <select value={presentation} onChange={(event) => setPresentation(event.target.value as typeof presentation)}><option value="inline">In the page</option><option value="immersive" disabled={!additions.List}>Fullscreen (with list view)</option></select></label>
          <label>Appearance <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>
        </div>
        <fieldset className="demo-additions">
          <legend>Optional additions</legend>
          {additionNames.map((name) => <label key={name}><input type="checkbox" checked={additions[name]} onChange={(event) => setAdditions((current) => ({ ...current, [name]: event.target.checked }))} /> Enable {additionLabels[name]}</label>)}
        </fieldset>
      </header>
      <Wanderer
        talks={talks}
        referenceDate="2026-10-13"
        globe={{ presentation, intro: false }}
        defaultView={allAdditions ? 'list' : 'globe'}
        enableSidebox={additions.Sidebox}
        enableList={additions.List}
        enableSearch={additions.Search}
        enableFilters={additions.Filters}
        enableResultCount={additions.ResultCount}
        enableHint={additions.Hint}
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
