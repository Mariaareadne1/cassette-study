import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from './icons';

type Props = { title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean };

/** Native modal dialog: focus trapping, Escape and inert background come from the platform. */
export function Dialog({ title, open, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`cs-dialog${wide ? ' cs-dialog-wide' : ''}`}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="cs-dialog-head">
        <h2>{title}</h2>
        <button type="button" className="cs-icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="cs-dialog-body">{open && children}</div>
    </dialog>
  );
}
