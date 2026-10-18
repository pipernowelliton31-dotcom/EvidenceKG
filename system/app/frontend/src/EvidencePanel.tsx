import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, ExternalLink, FileText, Loader2, Maximize2, Minimize2, Network, X } from 'lucide-react';
import Graph, { type GraphData, graphPalettes, graphTypeLabels } from './GraphScene';
import DocumentReader, { type SourceDocument } from './DocumentReader';
import { type Evidence, type Turn } from './ChatTurn';
import { relationLabel } from './relations';
import { type Theme } from './theme';
import GraphChoice from './GraphChoice';

export type EvidencePanelState = {
  projectId: string;
  tab: 'sources' | 'document' | 'graph';
  turn?: Turn;
  graph?: GraphData;
  evidence?: Evidence;
  relationId?: string;
  origin?: { view: string; turnId?: string; testId?: string };
};
type Props = {
  state: EvidencePanelState; theme: Theme; files: SourceDocument[];
  ready: boolean; entityGraph?: GraphData; architectureGraph?: GraphData;
  onClose: () => void; onManage: (file?: SourceDocument, location?: string) => void;
};

function originalUrl(evidence: Evidence) {
  const page = /(?:^|;\s*)page=(\d+)/.exec(evidence.location || '');
  return evidence.source_url ? evidence.source_url + (/\.pdf$/i.test(evidence.source) && page ? `#page=${page[1]}` : '') : undefined;
}

export default function EvidencePanel({ state, theme, files, ready, entityGraph, architectureGraph, onClose, onManage }: Props) {
  const [tab, setTab] = useState(state.tab);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => Math.max(420, Math.min(620, (window.innerWidth - 256) * .45)));
  const [overlay, setOverlay] = useState(() => window.innerWidth < 1200);
  const [selectedFile, setSelectedFile] = useState(() => files.find(file => file.path === state.evidence?.source));
  const [location, setLocation] = useState(state.evidence?.location || '');
  const [readerError, setReaderError] = useState(state.evidence && !files.some(file => file.path === state.evidence?.source) ? '此知识库备份未包含该原文件，可查看来源摘录。' : '');
  const [scope, setScope] = useState(state.graph ? 'context' : state.turn?.graph ? 'query' : 'entities');
  const [pathIndex, setPathIndex] = useState(-1);
  const [selectedId, setSelectedId] = useState(state.relationId || '');
  const [detail, setDetail] = useState<any>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allGraph, setAllGraph] = useState<GraphData>();
  const [graphError, setGraphError] = useState('');
  const [graphLoading, setGraphLoading] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const modal = overlay || expanded;
  useEffect(() => {
    const media = matchMedia('(max-width: 1199px)');
    const update = () => { setOverlay(media.matches); setWidth(value => Math.max(420, Math.min(value, window.innerWidth * .55))); };
    media.addEventListener('change', update); window.addEventListener('resize', update);
    return () => { media.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('.evidence-close')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Existing settings/upload dialogs take precedence over this work area.
      if (document.querySelector('.modal-backdrop')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (!modal || event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || []).filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [modal]);
  useEffect(() => {
    setDetail(undefined); setError('');
    if (!selectedId || !ready) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/projects/${state.projectId}/evidence/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.detail || '读取关系依据失败'); return data; })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedId, state.projectId, ready]);
  useEffect(() => {
    if (scope !== 'all' || !ready) return;
    const controller = new AbortController(); setGraphLoading(true); setGraphError('');
    fetch(`/api/projects/${state.projectId}/graph`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.detail || '读取图谱失败'); return data; })
      .then(data => { if (!controller.signal.aborted) setAllGraph(data); })
      .catch(error => { if (!controller.signal.aborted) setGraphError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setGraphLoading(false); });
    return () => controller.abort();
  }, [scope, ready, state.projectId]);

  const graph: GraphData | undefined = !ready ? undefined : scope === 'context' ? state.graph : scope === 'query' ? state.turn?.graph : scope === 'architecture' ? architectureGraph : scope === 'all' ? allGraph : entityGraph;
  const names = new Map<string, string>((graph?.nodes || []).map((node: { id: string; name: string }) => [node.id, node.name]));
  const relationEvidence: Evidence[] = (detail?.evidence || []).map((item: any) => ({ id: item.evidence_id, source: item.source, location: item.location, excerpt: item.quote, source_url: item.source_url }));
  const sources = selectedId ? relationEvidence : state.turn?.evidence || (state.evidence ? [state.evidence] : []);
  function read(evidence: Evidence) {
    const file = files.find(file => file.path === evidence.source);
    setReaderError(file ? '' : '此知识库备份未包含该原文件，可返回来源查看摘录。');
    setSelectedFile(file); setLocation(evidence.location || ''); setTab('document');
  }
  function selectRelation(id: string) { setSelectedId(id); }
  function sourceList(evidence: Evidence[]) {
    return <div className="evidence-list">{evidence.map((item, index) => <article className="evidence-source" key={`${item.id}-${index}`}>
      <div className="evidence-source-heading"><span>{index + 1}</span><div><strong>{item.source.replace(/^测试集A_/, '')}</strong><small>{item.location || '原文位置'}</small></div></div>
      <p className="evidence-quote">{item.excerpt || '请打开原文核对该位置。'}</p>
      {item.source_url && /\.(png|jpe?g|webp)$/i.test(item.source) && <img className="evidence-source-image" src={item.source_url} alt={item.source} loading="lazy"/>}
      <div className="evidence-source-actions"><button onClick={() => read(item)}><BookOpen size={15}/>阅读原文</button>{item.source_url && <a href={originalUrl(item)} target="_blank" rel="noreferrer"><ExternalLink size={14}/>原始文件</a>}</div>
    </article>)}</div>;
  }
  const detailSection = <>{loading && <p className="panel-status" role="status"><Loader2 size={16} className="spin"/>读取原文依据…</p>}{error && <p className="api-error" role="alert">{error}</p>}
    {detail && <div className="panel-relation"><div className="panel-relation-heading"><strong>{detail.relation ? `${detail.relation.source} — ${detail.relation.label} → ${detail.relation.target}` : detail.item?.name}</strong><button className="icon-button" aria-label="清除关系选择" onClick={() => setSelectedId('')}><X size={16}/></button></div>
      <small>{detail.fact_count} 条关联事实</small><div className="fact-detail">{detail.facts?.map((fact: any) => <p key={fact.fact_id}>{fact.qualifiers?.attribute || fact.predicate_label}<span>{typeof fact.value === 'object' ? fact.value?.raw ?? JSON.stringify(fact.value) : fact.value ?? fact.object_name}</span></p>)}</div>
    </div>}</>;
  return <>
    {modal && <div className="evidence-backdrop" onClick={onClose} aria-hidden="true"/>}
    <aside ref={panel} className={`evidence-panel ${expanded ? 'is-expanded' : ''}`} style={{ '--evidence-width': `${width}px` } as CSSProperties} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label="证据工作区">
      {!modal && <div className="evidence-resize" role="separator" aria-label="调整证据面板宽度" aria-orientation="vertical" aria-valuemin={420} aria-valuemax={Math.floor(window.innerWidth * .55)} aria-valuenow={Math.round(width)} tabIndex={0}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => Math.max(420, Math.min(window.innerWidth * .55, value + (event.key === 'ArrowLeft' ? 24 : -24)))); } }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(420, Math.min(window.innerWidth * .55, window.innerWidth - event.clientX))); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}/>}
      <header className="evidence-header"><div><BookOpen size={18}/><strong>证据工作区</strong></div><div>
        <button className="icon-button" aria-label={expanded ? '收起为侧面板' : '展开证据工作区'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
        <button className="icon-button evidence-close" aria-label="关闭证据工作区" onClick={onClose}><X size={19}/></button>
      </div></header>
      {state.turn && <p className="evidence-question" title={state.turn.question}>{state.origin?.testId ? `${state.origin.testId} · ` : ''}{state.turn.question}</p>}
      <div className="evidence-tabs" role="tablist" aria-label="证据视图">{(['sources', 'document', 'graph'] as const).map(id => <button key={id} id={`evidence-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`evidence-view-${id}`} onClick={() => setTab(id)}>{id === 'sources' ? <FileText size={16}/> : id === 'document' ? <BookOpen size={16}/> : <Network size={16}/>}{{ sources: '来源', document: '原文', graph: '关联图谱' }[id]}</button>)}</div>
      <div className="evidence-body">
        <section id="evidence-view-sources" role="tabpanel" aria-labelledby="evidence-tab-sources" hidden={tab !== 'sources'}>
          {selectedId && <button className="text-link" onClick={() => setSelectedId('')}><ArrowLeft size={14}/>全部回答来源</button>}
          {detailSection}
          {!selectedId && <p className="panel-caption">{new Set(sources.map(item => item.source)).size} 份资料 · {sources.length} 处依据</p>}
          {sourceList(sources)}{!loading && !sources.length && <div className="panel-empty"><FileText size={26}/><p>{selectedId ? '此关系暂无可展示的原文摘录。' : '选择图谱中的实体或关系，查看对应依据。'}</p></div>}
        </section>
        <section id="evidence-view-document" role="tabpanel" aria-labelledby="evidence-tab-document" hidden={tab !== 'document'}>
          {readerError && <p className="api-error" role="alert">{readerError}</p>}
          <div className="panel-document-tools"><span>{location || '阅读资料原文'}</span><button className="text-link" onClick={() => onManage(selectedFile, location)}>资料管理<ArrowUpRight size={14}/></button></div>
          <DocumentReader embedded active={tab === 'document'} projectId={state.projectId} document={selectedFile} files={files} location={location}
            onSelect={file => { setSelectedFile(file); setLocation(''); setReaderError(''); }} onClear={() => { setSelectedFile(undefined); setLocation(''); setReaderError(''); }}/>
        </section>
        <section id="evidence-view-graph" role="tabpanel" aria-labelledby="evidence-tab-graph" hidden={tab !== 'graph'}>
          <div className="panel-graph-tools"><label>图谱范围<GraphChoice label="证据面板图谱范围" placeholder="选择图谱" disabled={!ready || tab !== 'graph'} value={scope} searchable={false} options={[
            ...(state.graph ? [{ value: 'context', label: '当前选中的图谱' }] : []),
            ...(state.turn?.graph ? [{ value: 'query', label: '本轮问答' }] : []),
            { value: 'entities', label: '业务关系' }, { value: 'architecture', label: '产品架构' }, { value: 'all', label: '完整图谱' },
          ]} onChange={value => { setScope(value); setPathIndex(-1); setSelectedId(''); }}/></label>
          {scope === 'query' && !!state.turn?.paths?.length && <label>关联路径<GraphChoice label="关联路径" placeholder="全部路径" value={String(pathIndex)} disabled={tab !== 'graph'} searchable={false} options={[{ value: '-1', label: '全部路径' }, ...state.turn.paths.map((path, index) => ({ value: String(index), label: `路径 ${index + 1} · ${path.steps.length} 跳` }))]} onChange={value => { setPathIndex(Number(value)); setSelectedId(''); }}/></label>}</div>
          {graphLoading && scope === 'all' && <p className="panel-status"><Loader2 className="spin" size={16}/>读取图谱…</p>}{graphError && scope === 'all' && <p className="api-error">{graphError}</p>}
          <div className="panel-graph-canvas">{tab === 'graph' && <Graph theme={theme} graph={graph} selectedId={selectedId} select={selectRelation} path={scope === 'query' && pathIndex >= 0 ? state.turn?.paths?.[pathIndex] : undefined}/>}</div>
          <div className="panel-legend">{Object.entries(graphTypeLabels).filter(([type]) => graph?.nodes.some((node: { type: string }) => node.type === type)).map(([type, label]) => <span key={type}><i style={{ background: graphPalettes[theme][type] }}/>{label}</span>)}</div>
          <label className="panel-relation-select">查看主体关系<GraphChoice label="主体关系" placeholder="选择关系" value={graph?.edges.some(edge => edge.id === selectedId) ? selectedId : ''} disabled={!ready || tab !== 'graph' || !graph?.edges.length} searchable options={(graph?.edges || []).map(edge => {
            const source = names.get(edge.source) || edge.source, target = names.get(edge.target) || edge.target, verb = relationLabel(edge.predicate);
            return { value: edge.id, label: `${source} · ${verb} · ${target}`, relation: { source, verb, target } };
          })} onChange={selectRelation}/></label>
          {detailSection}{selectedId && sourceList(relationEvidence)}
        </section>
      </div>
    </aside>
  </>;
}
