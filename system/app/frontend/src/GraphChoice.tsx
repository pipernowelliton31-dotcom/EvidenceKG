import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export type GraphOption = { value: string; label: string; relation?: { source: string; verb: string; target: string } };

export function RelationRow({ source, verb, target }: { source: string; verb: string; target: string }) {
  return <span className="graph-choice-relation"><span className="graph-choice-end">{source}</span><span className="graph-choice-verb">{verb}</span><span className="graph-choice-end">{target}</span></span>;
}

export default function GraphChoice({ label, placeholder, value, options, onChange, disabled = false, searchable = true }: {
  label: string; placeholder: string; value: string; options: GraphOption[];
  onChange: (value: string) => void; disabled?: boolean; searchable?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>();
  const selected = options.find(option => option.value === value);
  const matches = useMemo(() => {
    if (!searchable) return options;
    const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return options.filter(option => terms.every(term => option.label.toLocaleLowerCase().includes(term)));
  }, [options, search, searchable]);
  function dismiss(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  function choose(option: GraphOption) { dismiss(true); onChange(option.value); }
  function show(last = false) {
    if (disabled) return;
    setSearch(''); setPosition(undefined);
    setActive(last ? options.length - 1 : Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  }
  function navigate(event: ReactKeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setActive(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0);
    } else if (!searchable && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, matches.length - 1));
    } else if (event.key === 'Enter' || !searchable && event.key === ' ') {
      event.preventDefault(); if (matches[active]) choose(matches[active]);
    } else if (event.key === 'Tab') { trigger.current?.focus(); setOpen(false); }
  }
  useEffect(() => { setOpen(false); }, [value, disabled, searchable]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  useEffect(() => { if (open && position) (searchable ? input.current : list.current)?.focus(); }, [open, !!position, searchable]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect(), inset = 12, gap = 8;
      if (rect.bottom < inset || rect.top > innerHeight - inset) { setOpen(false); return; }
      const width = Math.min(Math.max(rect.width, 360), 760, innerWidth - inset * 2);
      const below = innerHeight - rect.bottom - gap - inset, above = rect.top - gap - inset;
      const upwards = below < 260 && above > below;
      const maxHeight = Math.max(0, Math.min(400, upwards ? above : below));
      const height = Math.min(panel.current.getBoundingClientRect().height, maxHeight);
      setPosition({ left: Math.max(inset, Math.min(rect.left, innerWidth - width - inset)),
        top: upwards ? rect.top - gap - height : rect.bottom + gap, width, maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { setActive(index => Math.max(0, Math.min(index, matches.length - 1))); }, [matches.length]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, id]);
  return <>
    <button ref={trigger} type="button" className="graph-choice-trigger" aria-label={label} aria-haspopup={searchable ? 'dialog' : 'listbox'} aria-expanded={open} aria-controls={open ? searchable ? id : `${id}-list` : undefined} disabled={disabled}
      onClick={() => open ? dismiss() : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp'); }
      }}>{selected?.relation
        ? <RelationRow source={selected.relation.source} verb={selected.relation.verb} target={selected.relation.target}/>
        : <span className={selected ? 'graph-choice-label' : 'graph-choice-placeholder'}>{selected?.label || placeholder}</span>}<ChevronDown size={16} aria-hidden="true"/></button>
    {open && createPortal(<div id={id} ref={panel} className="graph-choice-popover" role={searchable ? 'dialog' : undefined} aria-label={searchable ? label : undefined} style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onKeyDown={navigate}>
      {searchable && <div className="graph-choice-search"><Search size={17} aria-hidden="true"/><input ref={input} type="search" role="combobox" aria-label={`搜索${label}`} aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={matches[active] ? `${id}-option-${active}` : undefined} placeholder={`搜索${label}`} value={search}
        onChange={event => { setSearch(event.target.value); setActive(0); }}/></div>}
      <div ref={list} id={`${id}-list`} className="graph-choice-list" role="listbox" aria-label={label} tabIndex={searchable ? undefined : 0} aria-activedescendant={!searchable && matches[active] ? `${id}-option-${active}` : undefined}>{matches.map((option, index) => <div id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={value === option.value} className={`graph-choice-option ${index === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
        {option.relation ? <RelationRow source={option.relation.source} verb={option.relation.verb} target={option.relation.target}/> : <span className="graph-choice-label">{option.label}</span>}
        <Check size={16} className="graph-choice-check" aria-hidden="true"/>
      </div>)}</div>
      {!matches.length && <p className="graph-choice-empty" role="status">没有匹配项</p>}
    </div>, document.body)}
  </>;
}
