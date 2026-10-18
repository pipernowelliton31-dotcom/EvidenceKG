import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FolderOpen } from 'lucide-react';

export type OverviewFile = { path: string; format?: string };
const formatLabels: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PPTX', png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WebP', md: 'Markdown', txt: 'TXT ' };

export default function LibraryOverview({ name, files }: { name: string; files: OverviewFile[] }) {
  const id = useId();
  const trigger = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  function cancelClose() { clearTimeout(closeTimer.current); }
  function show() { cancelClose(); setOpen(true); }
  function leave() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (!trigger.current?.contains(focused) && !panel.current?.contains(focused)) setOpen(false);
    }, 160);
  }
  useEffect(() => () => cancelClose(), []);
  useEffect(() => { setOpen(false); setPosition(undefined); }, [name, files]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { setOpen(false); return; }
      const inset = 12, gap = 8;
      const width = Math.min(420, innerWidth - inset * 2);
      const above = Math.max(0, rect.top - gap - inset);
      const below = Math.max(0, innerHeight - rect.bottom - gap - inset);
      const upwards = above >= below;
      const maxHeight = Math.min(420, upwards ? above : below);
      const height = Math.min(panel.current.getBoundingClientRect().height, maxHeight);
      setPosition({ width, maxHeight, left: Math.max(inset, Math.min(rect.left, innerWidth - width - inset)), top: upwards ? rect.top - gap - height : rect.bottom + gap });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelClose(); if (panel.current?.contains(document.activeElement)) trigger.current?.focus(); setOpen(false); } };
    document.addEventListener('keydown', escape, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <>
    <div ref={trigger} className="composer-project" role="group" tabIndex={0} aria-label={`${name}，文件总览`} aria-controls={open ? id : undefined} data-open={open}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.focus()); } }}>
      <FolderOpen size={19} aria-hidden="true"/><span className="composer-project-name">{name}</span>
    </div>
    {open && createPortal(<div ref={panel} id={id} className="composer-file-overview" role="region" aria-labelledby={`${id}-heading`} tabIndex={0}
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onMouseEnter={cancelClose} onMouseLeave={leave} onFocus={cancelClose} onBlur={leave}>
      <header><h3 id={`${id}-heading`}>文件总览</h3><span>{files.length} 份文件</span></header>
      <p className="overview-library-name">{name}</p>
      {files.length ? <ul>{files.map(file => {
        const format = (file.format || file.path.split('.').pop() || '').toLowerCase().replace(/^\./, '');
        return <li key={file.path}><FileText size={18} aria-hidden="true"/><span className="overview-file-name">{file.path}</span><span className="overview-file-type">{formatLabels[format] || format.toUpperCase() || '文件'}</span></li>;
      })}</ul> : <p className="overview-empty">当前资料库还没有文件。</p>}
    </div>, document.body)}
  </>;
}
