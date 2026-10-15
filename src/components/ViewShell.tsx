'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Keep navigation inside the top layer so fullscreen never hides its own controls. */
export function ViewShell({ immersive, active, headingId, className, shell, closeLabel, onExit, onEscape, children }: {
  immersive: boolean;
  active: boolean;
  headingId?: string;
  className: string;
  shell: string;
  closeLabel: string;
  onExit: () => void;
  onEscape: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Bumped when the browser closes the dialog but the view stays fullscreen
  // (a controlled parent that declines the exit), so the effect opens it again
  // instead of leaving the whole shell hidden.
  const [reopen, setReopen] = useState(0);
  /** Set while this component closes the dialog itself; its close event is not a request to leave. */
  const closingRef = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!immersive || !active || !dialog) return;
    closingRef.current = false;
    if (!dialog.hasAttribute('open')) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      closingRef.current = true;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [immersive, active, reopen]);

  if (!immersive) return <div className={className} data-wanderer-shell={shell}>{children}</div>;
  return (
    <dialog
      ref={ref}
      className={`${className} wanderer-shell--immersive`}
      data-wanderer-shell={shell}
      aria-labelledby={headingId}
      // A close request the page may still cancel: Escape (unless a field or
      // the consumer keeps it) leaves fullscreen through onEscape.
      onCancel={(event) => { event.preventDefault(); onEscape(); }}
      // The browser closed the dialog anyway: a close request it no longer
      // lets the page cancel (a second Escape without other input, the
      // Android back gesture) or a close() from elsewhere. Follow it out of
      // fullscreen like the Exit button; a stale event while open is ignored.
      onClose={() => {
        const dialog = ref.current;
        if (closingRef.current || !dialog || dialog.hasAttribute('open')) return;
        onExit();
        setReopen((count) => count + 1);
      }}
    >
      <button type="button" className="wanderer-button wanderer-shell__close" onClick={onExit}>{closeLabel}</button>
      {children}
    </dialog>
  );
}
