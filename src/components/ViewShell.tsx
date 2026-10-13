'use client';

import { useEffect, useRef, type ReactNode } from 'react';

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
  useEffect(() => {
    const dialog = ref.current;
    if (!immersive || !active || !dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [immersive, active]);

  if (!immersive) return <div className={className} data-wanderer-shell={shell}>{children}</div>;
  return (
    <dialog
      ref={ref}
      className={`${className} wanderer-shell--immersive`}
      data-wanderer-shell={shell}
      aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onEscape(); }}
    >
      <button type="button" className="wanderer-button wanderer-shell__close" onClick={onExit}>{closeLabel}</button>
      {children}
    </dialog>
  );
}
