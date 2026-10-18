import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, disabled = false, className = '' }: { title: string; children: ReactNode; onClose: () => void; disabled?: boolean; className?: string }) {
  const headingId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const blocked = useRef(disabled); blocked.current = disabled;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!blocked.current) close.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !disabled) onClose(); }}>
    <div ref={dialog} tabIndex={-1} className={`settings-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <button type="button" className="modal-close" aria-label="关闭窗口" disabled={disabled} onClick={onClose}><X size={19}/></button>
      <h2 id={headingId}>{title}</h2>{children}
    </div>
  </div>;
}
