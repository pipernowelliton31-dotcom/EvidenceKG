import { useEffect, useRef, useState } from 'react';
import Graph, { graphPalettes, graphTypeLabels as typeLabels, type GraphData } from './GraphScene';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Download, FileText, FolderOpen, Layers, Loader2, MessageSquare, Network, Plus, Settings2, ShieldCheck, Square, Upload, X, FlaskConical, PanelLeftClose, PanelLeftOpen, Trash2, RotateCcw, ArrowLeft, ChevronsUpDown } from 'lucide-react';
import ApiSettings from './ApiSettings';
import DocumentReader, { type SourceDocument } from './DocumentReader';
import ChatTurn, { Execution, Sources, type Turn, type Evidence, type Activity } from './ChatTurn';
import { relationLabel } from './relations';
import DiamondBackground from './DiamondBackground';
import Modal from './Modal';
import UploadDestination from './UploadDestination';
import LibrarySwitcher from './LibrarySwitcher';
import { applyTheme, initialTheme, type Theme } from './theme';
import { Sun, Moon } from 'lucide-react';
type AnswerOrigin = { view: 'chat' | 'tests'; turnId?: string; testId?: string; scrollTop?: number; follow?: boolean };
type Project = { id: string; name: string; ready: boolean; read_only: boolean; can_append?: boolean; files: any[]; counts: Record<string, number>; units: number; benchmark_demo?: boolean; graph?: GraphData; entity_graph?: GraphData; source_scope?: any };
async function api(path: string, options?: RequestInit) { const response = await fetch('/api' + path, options); const data = await response.json(); if (!response.ok) throw new Error(data.detail || `请求失败 (${response.status})`); return data; }
const post = (path: string, body?: any) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const saveText = (text: string, name: string) => { const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const fileBadge = (format: string) => ({ docx: 'DOC', xlsx: 'XLS', pptx: 'PPT', jpeg: 'JPG' }[format] || format.toUpperCase().slice(0, 3));
function SourceScopeNotice({ project }: { project?: Project }) { return <details className="graph-source-scope"><summary><ShieldCheck size={14}/>{project?.source_scope?.verified ? <>来源已核验 · <span className="data-number">{project.source_scope.corpus_count}</span> 份业务资料</> : '来源范围'}<ChevronDown size={13}/></summary><div className="source-scope-popover">{project?.source_scope?.issues?.map((s: string) => <p key={s}>{s}</p>)}{project?.files.map(f => <p key={f.path}>{f.path}<small> · {f.role === 'corpus' ? '参与构图' : '不参与构图'}</small></p>)}</div></details>; }
export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const [boot, setBoot] = useState<any>(); const [projectId, setProjectId] = useState(''); const [project, setProject] = useState<Project>();
  const [view, setView] = useState('chat'); const [reading, setReading] = useState<SourceDocument>(); const [sourceLocation, setSourceLocation] = useState(''); const [readingFromAnswer, setReadingFromAnswer] = useState(false); const sourceReturnView = useRef('chat'); const graphReturnRef = useRef<AnswerOrigin>({ view: 'chat' }); const sourceAnswerRef = useRef<AnswerOrigin>({ view: 'chat' }); const [graphTurn, setGraphTurn] = useState<Turn>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 800);
  const [input, setInput] = useState(''); const [turns, setTurns] = useState<Turn[]>([]); const [history, setHistory] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState(''); const [runId, setRunId] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]); const [building, setBuilding] = useState(false); const [testing, setTesting] = useState(false); const [results, setResults] = useState<Record<string, Turn>>({});
  const [uploadOpen, setUploadOpen] = useState(false); const [uploading, setUploading] = useState(false); const [uploadProgress, setUploadProgress] = useState(0); const [backupOpen, setBackupOpen] = useState(false);
  const [uploadNew, setUploadNew] = useState(false); const [uploadNotice, setUploadNotice] = useState(''); const folderRef = useRef<HTMLInputElement>(null);
  const [pendingRemoval, setPendingRemoval] = useState<SourceDocument>(); const [deleting, setDeleting] = useState(false); const [removalError, setRemovalError] = useState(''); const [buildFailure, setBuildFailure] = useState('');
  const [graphMode, setGraphMode] = useState('entities'); const [queryView, setQueryView] = useState(false); const [selectedId, setSelectedId] = useState(''); const [detail, setDetail] = useState<any>(); const [drawer, setDrawer] = useState(false); const [graphExpanded, setGraphExpanded] = useState(false); const [fullView, setFullView] = useState(false); const [fullGraph, setFullGraph] = useState<GraphData>(); const [pathIndex, setPathIndex] = useState(-1);
  const uploadRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null); const streamRef = useRef<EventSource | undefined>(undefined); const activeRef = useRef(false); const parentRef = useRef<string | undefined>(undefined); const stopTesting = useRef(false); const batchId = useRef<string | undefined>(undefined); const projectRef = useRef(''); projectRef.current = projectId;
  const contentEnd = useRef<HTMLDivElement>(null); const scrollRef = useRef<HTMLDivElement>(null); const followScroll = useRef(true); const latest = turns.at(-1);
  const refresh = async () => { const data = await api('/bootstrap'); setBoot(data); return data; };
  const reloadHistory = (id = projectId) => api(`/history?project_id=${id}`).then(data => { if (projectRef.current === id) setHistory(data); });
  useEffect(() => { refresh().then(data => { setProjectId(data.default_project); if (!data.api_configured && !localStorage.getItem('evidence-onboarded-v2')) { setOnboarding(true); setSettingsOpen(true); } }).catch(e => setError(e.message)); return () => streamRef.current?.close(); }, []);
  useEffect(() => {
    setUploadNew(false); setUploadNotice(''); setPendingRemoval(undefined); setRemovalError(''); setBuildFailure('');
    graphReturnRef.current = { view: 'chat' }; sourceAnswerRef.current = { view: 'chat' };
    setReadingFromAnswer(false); setProject(undefined); setGraphTurn(undefined); setTurns([]); setHistory([]); setResults({}); setActivities([]); setReading(undefined); setDetail(undefined); setDrawer(false); setQueryView(false); setFullView(false); setFullGraph(undefined); parentRef.current = undefined;
    if (!projectId) return; const controller = new AbortController();
    api(`/projects/${projectId}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setProject(data); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    reloadHistory().catch(e => setError(e.message));
    const check = () => { if (document.hidden) return; api(`/projects/${projectId}/source-status`, { signal: controller.signal }).then(data => { if (controller.signal.aborted || data.ready) return; setProject(p => p && ({ ...p, ready: false, graph: { nodes: [], edges: [] }, entity_graph: { nodes: [], edges: [] }, source_scope: data.source_scope })); setFullGraph(undefined); setTurns([]); setDetail(undefined); }).catch(() => {}); };
    const timer = setInterval(check, 10000); return () => { controller.abort(); clearInterval(timer); };
  }, [projectId]);
  useEffect(() => { const container = scrollRef.current; if (view === 'chat' && followScroll.current && container) container.scrollTop = container.scrollHeight; }, [latest?.answer, latest?.events.length, turns.length]);
  useEffect(() => { if (!busy) return; const started = performance.now(); setElapsed(0); const timer = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 100) / 10), 100); return () => clearInterval(timer); }, [busy, runId]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { setGraphExpanded(false); setDrawer(false); if (window.innerWidth <= 800) setSidebarOpen(false); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  async function openLibrarySwitcher() { setLibraryOpen(true); try { await refresh(); } catch (e: any) { setError(e.message); } }
  const closeSettings = () => { setSettingsOpen(false); setOnboarding(false); localStorage.setItem('evidence-onboarded-v2', '1'); };
  function patchTurn(id: string, patch: Partial<Turn>) { setTurns(t => t.map(v => v.id === id ? { ...v, ...patch } : v)); }
  function listen(id: string, localId?: string): Promise<Turn | undefined> {
    streamRef.current?.close(); setRunId(id); const stream = new EventSource(`/api/runs/${id}/events`); streamRef.current = stream;
    let response: Partial<Turn> = { id, runId: id, answer: '', status: 'running', events: [] }; let lastEvent = 0;
    return new Promise((resolve, reject) => {
      const complete = (failure?: string) => { stream.close(); activeRef.current = false; setBusy(false); reloadHistory().catch(() => {}); if (localId) patchTurn(localId, response); if (failure) reject(new Error(failure)); else resolve(response as Turn); };
      let errors = 0;
      stream.onopen = () => { errors = 0; };
      stream.onmessage = e => {
        const event = JSON.parse(e.data); if (event.id <= lastEvent) return; lastEvent = event.id;
        if (event.type !== 'answer.delta') { response.events = [...response.events!, event]; setActivities(response.events); }
        if (event.type === 'retrieval.completed') Object.assign(response, { stats: event.stats, graph: event.graph, evidence: event.evidence, paths: event.paths, context: event.context });
        if (event.type === 'stage.started' && event.model) response.model = event.model;
        if (event.type === 'answer.delta') response.answer += event.text;
        if (event.type === 'answer.completed') Object.assign(response, { answer: event.answer, model: event.model, mode: event.mode });
        if (event.type === 'run.error') Object.assign(response, { status: 'failed', error: event.message });
        if (event.type === 'run.cancelled') response.status = 'cancelled';
        if (event.type === 'run.completed') response.status = 'completed';
        if (localId) patchTurn(localId, { ...response, id: localId });
        if (batchId.current) { const qid = batchId.current; setResults(r => ({ ...r, [qid]: { ...r[qid], ...response } })); }
        if (['run.completed', 'run.cancelled', 'run.error'].includes(event.type)) complete(event.type === 'run.error' ? event.message : undefined);
      };
      stream.onerror = () => { if (++errors >= 3 || stream.readyState === EventSource.CLOSED) { response.status = 'failed'; response.error = '连接中断，记录已保存。请从左侧对话历史重新打开。'; complete(response.error); } };
    });
  }
  async function ask(question = input, independent = false) {
    if (!question.trim() || activeRef.current || uploading || deleting) return;
    if (!boot?.api_configured) { setSettingsOpen(true); setError('连接模型后即可提问；当前可浏览本地资料和图谱。'); return; }
    if (!project?.ready) { setError('请先在资料页面完成解析与构图。'); return; }
    activeRef.current = true; setBusy(true); setRunId(''); setError(''); setActivities([]); setInput(''); setGraphTurn(undefined); graphReturnRef.current = { view: 'chat' }; setQueryView(true); followScroll.current = true;
    const localId = crypto.randomUUID(); const initial: Turn = { id: localId, question: question.trim(), answer: '', mode: 'answer', model: boot.model, status: 'running', events: [] };
    setTurns(t => independent ? [initial] : [...t, initial]);
    try {
      const data = await post('/runs', { project_id: projectId, question: question.trim(), mode: 'answer', parent_run_id: independent ? undefined : parentRef.current });
      const result = await listen(data.run_id, localId);
      if (result?.status === 'completed' && !independent) parentRef.current = data.run_id;
      return { ...initial, ...result } as Turn;
    } catch (e: any) { patchTurn(localId, { status: 'failed', error: e.message }); activeRef.current = false; setBusy(false); setError(e.message); throw e; }
  }
  async function cancel() { stopTesting.current = true; if (runId) { try { await post(`/runs/${runId}/cancel`); } catch (e: any) { setError(e.message); } } }
  function newChat() { if (busy || testing) return; parentRef.current = undefined; setGraphTurn(undefined); graphReturnRef.current = { view: 'chat' }; setTurns([]); setInput(''); setActivities([]); setDetail(undefined); setDrawer(false); setView('chat'); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); }
  function retryTurn(turn: Turn) {
    if (busy || testing || uploading || deleting) return;
    const index = turns.findIndex(t => t.id === turn.id);
    const previous = (index >= 0 ? turns.slice(0, index) : []).filter(t => t.status === 'completed').at(-1);
    parentRef.current = previous?.runId || previous?.id;
    setTurns(t => index >= 0 ? t.slice(0, index) : []); setView('chat');
    ask(turn.question).catch(() => {});
  }
  function requestRemoval(file: SourceDocument) {
    if (!project?.can_append || busy || testing || uploading || deleting) return;
    setRemovalError(''); setPendingRemoval(file);
  }
  async function removeFile() {
    if (!pendingRemoval || deleting || busy || uploading) return;
    const id = projectId; setDeleting(true); setRemovalError('');
    try {
      await post(`/projects/${id}/files/remove`, { path: pendingRemoval.path });
      const updated = await api(`/projects/${id}`);
      if (projectRef.current === id) {
        setProject(updated); setPendingRemoval(undefined); setReadingFromAnswer(false); setReading(undefined); setSourceLocation('');
        setTurns([]); setResults({}); setActivities([]); setGraphTurn(undefined); setFullGraph(undefined); setDetail(undefined); setDrawer(false); setQueryView(false); setFullView(false); parentRef.current = undefined;
        setBuildFailure(''); setError(''); setView('documents');
        setUploadNotice(updated.files.length ? '文件已从当前资料库删除。请重新生成图谱，使用剩余资料继续问答。' : '当前资料库已清空。上传新文件后，即可重新生成图谱。');
      }
      await refresh();
    } catch (e: any) { setRemovalError(e.message); } finally { setDeleting(false); }
  }
  async function loadHistory(id: string) {
    if (busy || testing) return;
    try { setGraphTurn(undefined); graphReturnRef.current = { view: 'chat' }; setPathIndex(-1); const data = await api(`/conversations/${id}`); const converted = data.turns.map((r: any) => { const retrieved = r.events.find((e: any) => e.type === 'retrieval.completed') || {}; const answer = r.events.find((e: any) => e.type === 'answer.completed'); return { ...retrieved, id: r.id, runId: r.id, question: r.question, answer: r.answer || answer?.answer || '', model: r.model, mode: answer?.mode || (r.model ? 'answer' : 'retrieve'), status: r.status, events: r.events.filter((e: any) => e.type !== 'answer.delta'), error: r.events.find((e: any) => e.type === 'run.error')?.message }; }); setTurns(converted); parentRef.current = [...converted].reverse().find(t => t.status === 'completed')?.id; setView('chat'); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); followScroll.current = true; }
    catch (e: any) { setError(e.message); }
  }
  async function batchTest() {
    if (!boot.api_configured) { setSettingsOpen(true); return; }
    stopTesting.current = false; setTesting(true); setResults({}); parentRef.current = undefined;
    for (const q of boot.questions) { if (stopTesting.current) break; batchId.current = q.id; setResults(r => ({ ...r, [q.id]: { question: q.question, answer: '', mode: 'answer', status: 'running', events: [] } }));
      try { const result = await ask(q.question, true); if (result) setResults(r => ({ ...r, [q.id]: result })); if (result?.status !== 'completed') break; }
      catch (e: any) { setResults(r => ({ ...r, [q.id]: { ...r[q.id], status: 'failed', error: e.message } })); break; }
    } batchId.current = undefined; setTesting(false);
  }
  function upload(files: FileList | File[] | null, importing = false) {
    if (!files?.length || uploading || busy || testing || deleting) return; setUploading(true); setUploadProgress(0); setError(''); setUploadNotice(''); setBuildFailure('');
    const form = new FormData(); Array.from(files).forEach(file => form.append(importing ? 'file' : 'files', file));
    if (!importing && project?.can_append && !uploadNew) form.append('project_id', projectId);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/projects/' + (importing ? 'import' : 'upload'));
    xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = async () => { try {
      const data = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(data.detail || '上传失败');
      await refresh();
      if (data.id === projectId) {
        setProject(await api(`/projects/${data.id}`));
        if (data.upload_result?.added.length) { setTurns([]); setResults({}); setActivities([]); setReadingFromAnswer(false); setReading(undefined); setGraphTurn(undefined); setFullGraph(undefined); setDetail(undefined); setDrawer(false); setQueryView(false); setFullView(false); parentRef.current = undefined; }
      } else setProjectId(data.id);
      const result = data.upload_result;
      if (result && data.id === projectId) setUploadNotice(`新增 ${result.added.length} 份，跳过 ${result.skipped.length} 份重复文件。${result.renamed.length ? '同名文件已另存：' + result.renamed.map((r: any) => r.to).join('、') + '。' : ''}${result.added.length ? '原文件已保留，请重新解析并生成图谱。' : '资料与图谱保持不变。'}`);
      setUploadOpen(false); setBackupOpen(false); setUploadNew(false); setView(importing ? 'graph' : 'documents');
    } catch (e: any) { setError(e.message); } finally { setUploading(false); } };
    xhr.onerror = () => { setUploading(false); setError('上传连接中断，请重试。'); }; xhr.send(form);
  }
  async function build() {
    if (!boot.api_configured) { setSettingsOpen(true); return; }
    if (activeRef.current || uploading || deleting || !project?.files.length) return; setBuilding(true); setBusy(true); activeRef.current = true; setActivities([]); setView('chat'); setError(''); setBuildFailure('');
    try { const data = await post(`/projects/${projectId}/build`); await listen(data.run_id); setProject(await api(`/projects/${projectId}`)); await refresh(); }
    catch (e: any) { setError(e.message); setBuildFailure(e.message); } finally { setBuilding(false); setBusy(false); activeRef.current = false; }
  }
  async function roleChange(path: string, role: string) { try { const roles = Object.fromEntries((project?.files || []).map(f => [f.path, f.path === path ? role : f.role])); setProject(await post(`/projects/${projectId}/roles`, { roles })); setReading(r => r?.path === path ? { ...r, role } : r); } catch (e: any) { setError(e.message); } }
  function openDocument(file: SourceDocument) { setReadingFromAnswer(false); setReading(file); setSourceLocation(''); setView('documents'); setDrawer(false); setGraphExpanded(false); if (window.innerWidth <= 800) setSidebarOpen(false); }
  function readEvidence(e: Evidence, origin?: AnswerOrigin) { sourceReturnView.current = view; sourceAnswerRef.current = origin ? rememberAnswerPosition(origin) : graphReturnRef.current; const file = project?.files.find(f => f.path === e.source); if (file) { openDocument(file); setReadingFromAnswer(true); setSourceLocation(e.location || ''); } else setError('此知识库备份未包含该原文件。'); }
  function rememberAnswerPosition(origin: AnswerOrigin): AnswerOrigin {
    const container = origin.view === 'chat' ? scrollRef.current : document.querySelector<HTMLElement>('.tests-page');
    return { ...origin, scrollTop: container?.scrollTop, follow: origin.view === 'chat' ? followScroll.current : undefined };
  }
  function openTurnGraph(turn: Turn, origin: AnswerOrigin) { graphReturnRef.current = rememberAnswerPosition(origin); setGraphTurn(turn); setFullView(false); setQueryView(true); setView('graph'); }
  function returnToAnswer(origin: AnswerOrigin = graphReturnRef.current) {
    setGraphExpanded(false); setDrawer(false); setView(origin.view);
    requestAnimationFrame(() => {
      const targetId = origin.testId ? `test-result-${origin.testId}` : `turn-${origin.turnId || latest?.runId || latest?.id}`;
      const target = document.getElementById(targetId);
      if (target instanceof HTMLDetailsElement) target.open = true;
      const container = origin.view === 'chat' ? scrollRef.current : target?.closest<HTMLElement>('.tests-page');
      if (container) {
        if (origin.scrollTop !== undefined) container.scrollTop = origin.scrollTop;
        if (origin.view === 'chat' && origin.follow !== undefined) followScroll.current = origin.follow;
      }
    });
  }
  async function selectItem(id: string) { setSelectedId(id); if (!id) { setDetail(undefined); return; } try { setDetail(await api(`/projects/${projectId}/evidence/${id}`)); setDrawer(true); } catch (e: any) { setError(e.message); } }
  async function changeGraphScope(scope: string) { setSelectedId(''); setDetail(undefined); if (scope !== 'all') { setFullView(false); setQueryView(scope === 'query'); return; } try { setFullGraph(await api(`/projects/${projectId}/graph`)); setPathIndex(-1); setFullView(true); } catch (e: any) { setError(e.message); } }
  const graphAnswer = graphTurn || latest;
  const displayGraph = project?.ready ? fullView ? fullGraph : queryView && graphAnswer ? graphAnswer.graph : graphMode === 'entities' ? project.entity_graph : project.graph : undefined;
  const displayNames = new Map((displayGraph?.nodes || []).map((n: { id: string; name: string }) => [n.id, n.name]));
  const seen = new Set<string>(); const conversations = history.filter(h => { const key = h.conversation_id || h.id; if (h.kind !== 'query' || seen.has(key)) return false; seen.add(key); return true; });
  const detailEvidence: Evidence[] = (detail?.evidence || []).map((e: any) => ({ id: e.evidence_id, source: e.source, location: e.location, excerpt: e.quote, source_url: e.source_url }));
  const colors = graphPalettes[theme];
  const navItems = [['chat', MessageSquare, '知识问答'], ['graph', Network, '知识图谱'], ['documents', FileText, '原始资料'], ['tests', FlaskConical, '十题问答']] as const;
  return <div className={`workspace workspace-v2 ${drawer ? '' : 'drawer-closed'} ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
    {theme === 'night' && <DiamondBackground/>}
    <input ref={folderRef} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={e => { upload(e.target.files); e.target.value = ''; }}/><input ref={uploadRef} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md" onChange={e => { upload(e.target.files); e.target.value = ''; }}/><input ref={importRef} type="file" hidden accept=".zip" onChange={e => { upload(e.target.files, true); e.target.value = ''; }}/>
    {sidebarOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭资料与对话侧栏" onClick={() => setSidebarOpen(false)}/>}
    <aside className="sidebar"><button type="button" className="sidebar-dismiss" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={19}/></button><a className="brand" href="/" aria-label="Evidence 首页"><span className="brand-symbol"><Network size={21}/></span>知源<span className="brand-en">Evidence</span></a>
      <div className="sidebar-section-label">资料库</div>
      <button type="button" className="library-switch-trigger" aria-label="切换知识库" aria-haspopup="dialog" aria-expanded={libraryOpen} disabled={busy || testing || uploading || deleting} onClick={openLibrarySwitcher}><span className="library-trigger-icon"><FolderOpen size={19}/></span><span className="library-trigger-copy"><span>当前资料库 <span className="library-trigger-hint">切换</span></span><strong title={project?.name}>{project?.name || '选择资料库'}</strong></span><ChevronsUpDown size={15}/></button>
      <button className="sidebar-upload" disabled={busy || testing || uploading || deleting} onClick={() => setUploadOpen(true)}><Upload size={16}/>上传资料</button>
      <div className="sidebar-section-label chat-section-label">对话</div>
      <button className="new-chat" disabled={busy || testing || uploading || deleting} onClick={newChat}><Plus size={18}/>新对话</button><p className="sidebar-chat-note">使用当前资料库开始新的问答</p>
      <nav>{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'nav-active' : ''} onClick={() => { setView(id); setGraphExpanded(false); setDrawer(false); if (window.innerWidth <= 800) setSidebarOpen(false); }}><Icon size={18}/>{label}</button>)}</nav>
      <div className="history-title"><MessageSquare size={15}/>最近对话<span>{conversations.length}</span></div><div className="sidebar-history">{conversations.length ? conversations.map(h => <button disabled={busy || testing} className={parentRef.current === h.id ? 'selected' : ''} key={h.id} title={h.question} onClick={() => loadHistory(h.id)}><MessageSquare size={14}/><span>{h.question}</span>{h.status === 'failed' && <i className="history-error"/>}</button>) : <p>你的对话会保存在这里</p>}</div>
      <section className="sidebar-files"><div className="sidebar-file-heading"><FolderOpen size={15}/>已上传文件<span>{project?.files.length || 0}</span></div><div className="file-list">{project?.files.map(f => <div className="sidebar-file-item" key={f.path}><button className="file-row" onClick={() => openDocument(f)} title={f.path}><span className={`file-icon ${f.format}`}>{fileBadge(f.format)}</span><span>{f.path.replace(/^测试集A_/, '')}</span></button>{project?.can_append && <button className="file-remove" aria-label={`删除文件 ${f.path}`} title="从当前资料库删除" disabled={busy || testing || uploading || deleting} onClick={() => requestRemoval(f)}><Trash2 size={15}/></button>}</div>)}{!project?.files.length && <p className="empty-file-note">还没有文件，上传资料开始。</p>}</div></section>
      <div className="sidebar-bottom"><button disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={17}/>模型设置<span className={boot?.api_configured ? 'configured-dot' : 'unconfigured-dot'}/></button></div>
    </aside>
    <section className="main"><header className="topbar"><div><button aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button><strong>{project?.name || '正在加载资料…'}</strong></div><div className="topbar-actions"><div className="theme-switch" role="group" aria-label="外观模式"><button type="button" aria-label="白天模式" aria-pressed={theme === 'day'} onClick={() => setTheme('day')}><Sun size={14}/><span>白天</span></button><button type="button" aria-label="夜间模式" aria-pressed={theme === 'night'} onClick={() => setTheme('night')}><Moon size={14}/><span>夜间</span></button></div><button className={`model-pill ${boot?.api_configured ? '' : 'needs-config'}`} disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={15}/><span>{boot?.api_configured ? boot.model : '配置模型 · 开始问答'}</span><ChevronDown size={13}/></button></div></header>
      <div className="mobile-nav">{navItems.map(([id, Icon, label]) => <button aria-label={label} className={view === id ? 'active' : ''} key={id} onClick={() => setView(id)}><Icon size={17}/>{label}</button>)}</div>
      {uploadNotice && view === 'documents' && <div className="upload-notice" role="status">{uploadNotice}<button aria-label="关闭上传提示" onClick={() => setUploadNotice('')}><X size={16}/></button></div>}
      {error && <div className="error-bar" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {view !== 'chat' && <div className="page-toolbar"><div>{view === 'graph' && graphAnswer && <button type="button" className="back-to-answer" onClick={() => returnToAnswer()}><ArrowLeft size={16}/>返回回答</button>}{view === 'documents' && readingFromAnswer && <button type="button" className="back-to-answer" onClick={() => sourceReturnView.current === 'graph' ? setView('graph') : returnToAnswer(sourceAnswerRef.current)}><ArrowLeft size={16}/>{sourceReturnView.current === 'graph' ? '返回图谱' : '返回回答'}</button>}<h1>{{ graph: '知识图谱', documents: '原始资料', tests: '十题完整问答' }[view]}</h1><p>{{ graph: '查看主体之间的关系，点击连线核对中文关系与原文。', documents: '上传、阅读和管理参与问答的文件。', tests: '使用当前模型逐题生成答案，并保留执行过程与来源。' }[view]}</p></div><div className="toolbar-actions">{view === 'graph' && <button className="soft-button" disabled={!project?.ready} onClick={() => window.location.assign(`/api/projects/${projectId}/export/html`)}><Download size={15}/>导出思维导图</button>}{view === 'documents' && <button className="primary" disabled={busy} onClick={() => setUploadOpen(true)}><Plus size={17}/>上传资料</button>}</div></div>}
      {view === 'documents' && <><div className="document-tools"><span><span className="data-number">{project?.files.length || 0}</span> 份文件 · <span className="data-number">{project?.files.filter(f => f.role === 'corpus').length || 0}</span> 份参与构图</span>{!project?.ready && <button className="primary" disabled={busy || testing || uploading || deleting || !project?.files.length} onClick={build}>{busy ? <Loader2 className="spin" size={15}/> : <Network size={15}/>}解析资料并生成图谱</button>}<details><summary>备份与恢复<ChevronDown size={13}/></summary><div><a href={`/api/projects/${projectId}/export`}>下载知识库备份 ZIP</a><button disabled={busy} onClick={() => setBackupOpen(true)}>从本系统备份恢复…</button></div></details></div>{sourceLocation && <div className="source-jump-note">来源位置：{sourceLocation}</div>}<DocumentReader location={sourceLocation} projectId={projectId} document={reading} files={project?.files || []} onSelect={openDocument} onClear={() => { setReading(undefined); setSourceLocation(''); setReadingFromAnswer(false); }} onRemove={project?.can_append ? requestRemoval : undefined} busy={busy || testing || uploading || deleting} onRole={!project?.read_only && reading ? role => roleChange(reading.path, role) : undefined}/></>}
      {<div hidden={view !== 'chat'} ref={scrollRef} tabIndex={0} aria-label="对话内容" className={`conversation ${turns.length ? 'has-turns' : ''}`} onScroll={() => { const el = scrollRef.current; if (el) followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 180; }}>
        {!turns.length && <div className="chat-welcome"><span className="welcome-icon"><Network size={27}/></span><h1>从你的资料，找到答案</h1><p>{project?.ready ? <>已收录 <span className="data-number">{project.source_scope?.corpus_count ?? project.files.filter(f => f.role === 'corpus').length}</span> 份业务资料。提问后，可查看关联关系与原文依据。</> : '添加资料并生成知识图谱，即可开始问答。'}</p>{!boot?.api_configured && <button className="connect-banner" onClick={() => setSettingsOpen(true)}><Settings2 size={18}/><span><strong>连接模型，开始对话</strong><small>暂未配置 API · 仍可浏览离线图谱和资料</small></span><ArrowUpRight size={17}/></button>}
          {!project?.ready && <button className="primary" disabled={busy || testing || uploading || deleting || !project?.files.length} onClick={build}><Network size={17}/>解析资料并生成图谱</button>}
        </div>}
        {(building || buildFailure || (!turns.length && activities.length > 0)) && <div className="build-progress"><Execution events={activities} running={building} elapsed={elapsed} error={buildFailure || undefined}/>
          {buildFailure && !building && <div className="retry-actions build-retry"><button className="primary" disabled={busy || testing || uploading || deleting} onClick={build}><RotateCcw size={15}/>继续生成图谱</button><span>已完成的批次会保留，从失败处继续。</span></div>}</div>}
        {turns.map((turn, i) => <ChatTurn key={turn.id || i} turn={turn} elapsed={elapsed} read={e => readEvidence(e, { view: 'chat', turnId: turn.runId || turn.id })} graph={() => openTurnGraph(turn, { view: 'chat', turnId: turn.runId || turn.id })} download={saveText} retry={() => retryTurn(turn)} retryDisabled={busy || testing || uploading || deleting}/>)}<div ref={contentEnd}/>
      </div>}
      {view === 'graph' && <div className={`graph-page ${graphExpanded ? 'graph-expanded' : ''}`}>
        {graphAnswer && <button type="button" className="back-to-answer graph-expanded-return" onClick={() => returnToAnswer()}><ArrowLeft size={16}/>返回回答</button>}
        <SourceScopeNotice project={project}/>
        <div className="graph-focus-toolbar"><button className="soft-button" aria-pressed={graphExpanded} onClick={() => setGraphExpanded(!graphExpanded)}>{graphExpanded ? <X size={14}/> : <Network size={14}/>} {graphExpanded ? "退出专注模式" : "展开图谱"}</button><small>网络来自收录资料 · 选择关系查看中文说明</small></div><div className="graph-view-tabs" aria-label="切换图谱视图"><button aria-pressed={graphMode === 'entities'} onClick={() => { setGraphMode('entities'); setFullView(false); setQueryView(false); setSelectedId(''); setDetail(undefined); }}><Network size={16}/><div><strong>主体关系网络</strong><small>产品 · 工具 · 客户 · 版本</small></div></button><button aria-pressed={graphMode === 'architecture'} onClick={() => { setGraphMode('architecture'); setFullView(false); setQueryView(false); setSelectedId(''); setDetail(undefined); }}><Layers size={16}/><div><strong>产品与工具架构</strong><small>保留原有分区视图</small></div></button></div>
        <div className="graph-toolbar"><span><i/>{fullView ? '原始抽取 · 含运营事件' : queryView && graphAnswer ? '当前问题的证据子图' : <><span className="data-number">{displayGraph?.nodes.length || 0}</span> 个主体 · <span className="data-number">{displayGraph?.edges.length || 0}</span> 条业务关系</>}</span><div className="graph-scope-controls"><select aria-label="图谱范围" disabled={!project?.ready} value={fullView ? 'all' : queryView && graphAnswer ? 'query' : 'context'} onChange={e => changeGraphScope(e.target.value)}><option value="context">收录资料的主体关系</option>{graphAnswer && <option value="query">当前问题关联子图</option>}<option value="all">全部抽取结果（含事件）</option></select>{queryView && graphAnswer && <select disabled={fullView || !graphAnswer.paths?.length} aria-label="选择关联路径" value={pathIndex} onChange={e => setPathIndex(Number(e.target.value))}><option value={-1}>全部相关路径</option>{graphAnswer.paths?.map((p: any, index: number) => <option key={p.path_id} value={index}>路径 {index + 1} · {p.steps.length} 跳</option>)}</select>}</div></div>
        <div className="relation-explorer"><label>查看两个主体的关系<select aria-label="选择主体关系" value={displayGraph?.edges.some((e: { id: string }) => e.id === selectedId) ? selectedId : ''} onChange={e => selectItem(e.target.value)}><option value="">选择关系，或直接点击图谱连线</option>{displayGraph?.edges.map((e: { id: string; source: string; target: string; predicate: string }) => <option key={e.id} value={e.id}>{String(displayNames.get(e.source))} —{relationLabel(e.predicate)}→ {String(displayNames.get(e.target))}</option>)}</select></label>{selectedId && <button className="text-link" onClick={() => selectItem('')}>清除选择</button>}</div>
        {detail?.relation && selectedId === detail.item.id && <div className="selected-relation" role="status"><strong>{detail.relation.source}</strong><span>— {detail.relation.label} →</span><strong>{detail.relation.target}</strong><small>{detail.evidence.length} 处原文依据 · 已突出两端与连线</small></div>}
        <div className="graph-canvas"><Graph theme={theme} key={`${projectId}:${fullView ? 'all' : queryView && graphAnswer ? 'query' : graphMode}`} graph={displayGraph} select={selectItem} selectedId={selectedId} path={!fullView && queryView && pathIndex >= 0 ? graphAnswer?.paths?.[pathIndex] : undefined}/></div>
        <div className="graph-legend">{(fullView || queryView && graphAnswer ? ['Product', 'AITool', 'Event', 'Actor', 'Version'] : graphMode === 'entities' ? ['Product', 'AITool', 'Actor', 'Version'] : ['Product', 'AITool']).map(t => <span key={t}><i style={{ background: colors[t] }}/>{typeLabels[t]}</span>)}<small>拖拽 / 缩放 · 点击连线看中文关系与原文</small></div>
      </div>}
      
      {view === 'chat' && <div className="composer-wrap"><div className={`composer ${busy ? 'running' : ''}`}><textarea aria-label="输入问题" placeholder={boot?.api_configured ? '询问资料中的问题，或继续追问…' : '先连接模型，再开始提问…'} value={input} disabled={busy || testing} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask().catch(() => {}); } }}/><div className="composer-bottom"><button className="composer-project" onClick={() => setView('documents')}><FolderOpen size={16}/>{project?.name || '资料库'}</button><div>{!busy && <span>Enter 发送 · Shift + Enter 换行</span>}{busy ? <button className="send" aria-label="停止生成" disabled={!runId} onClick={cancel}><Square size={15}/></button> : <button className="send" aria-label="发送问题" disabled={!input.trim() || testing} onClick={() => ask().catch(() => {})}><ArrowUp size={20}/></button>}</div></div></div></div>}
      {view === 'tests' && <div className="tests-page"><div className="test-intro"><div><strong>测试集 A · 10 个问题</strong><p>{boot?.api_configured ? `当前模型：${boot.model}` : '请先配置模型，再运行完整问答。离线图谱可直接浏览。'}</p><small>逐题调用模型；长回答可能自动续写，按服务商计费。生成完成不代表答案评分通过。</small></div><button className="primary" disabled={busy || testing || !project?.ready || !project?.benchmark_demo} onClick={batchTest}>{testing ? <Loader2 className="spin" size={16}/> : <FlaskConical size={16}/>}运行十题完整问答</button>{testing && <button className="soft-button" onClick={cancel}>停止测试</button>}</div>{testing && <Execution events={activities} running={busy} elapsed={elapsed}/>}<div className="test-list">{boot?.questions.map((q: any) => <details className="test-result-card" id={`test-result-${q.id}`} key={q.id}><summary><span>{q.id}</span><strong>{q.title}</strong><small className={results[q.id]?.status === 'failed' ? 'red' : ''}>{{ completed: '回答已生成', running: '正在回答', failed: '失败', cancelled: '已停止' }[results[q.id]?.status] || '待运行'}</small><ChevronDown size={15}/></summary><p>{q.question}</p>{results[q.id] ? <ChatTurn turn={results[q.id]} elapsed={elapsed} read={e => readEvidence(e, { view: 'tests', turnId: results[q.id].runId || results[q.id].id, testId: q.id })} graph={() => openTurnGraph(results[q.id], { view: 'tests', turnId: results[q.id].runId || results[q.id].id, testId: q.id })} download={saveText} retry={() => retryTurn(results[q.id])} retryDisabled={busy || testing || uploading || deleting}/> : <button disabled={busy || testing} className="soft-button" onClick={() => { setView('chat'); setInput(q.question); }}>在对话中提问<ArrowUpRight size={14}/></button>}</details>)}</div>{Object.values(results).some(t => t.answer) && <button className="soft-button" onClick={() => saveText(Object.entries(results).map(([id, t]) => `# ${id} ${t.question}\n\n模型：${t.model || boot.model}\n状态：${t.status}\n\n${t.answer || t.error || ''}`).join('\n\n---\n\n'), '测试集A-完整问答.md')}><Download size={15}/>导出本轮答案</button>}</div>}
    </section>
    {drawer && detail && <aside className="details"><div className="details-tabs"><strong>关系与原文依据</strong><button className="drawer-close" aria-label="关闭证据面板" onClick={() => setDrawer(false)}><X size={18}/></button></div><div className="details-content"><h3>{detail.relation ? `${detail.relation.source} — ${detail.relation.label} → ${detail.relation.target}` : detail.item?.name}</h3><p className="muted"><span className="data-number">{detail.fact_count}</span> 条关联事实</p><div className="fact-detail">{detail.facts?.map((f: any) => <p key={f.fact_id}>{f.qualifiers?.attribute || f.predicate_label}<span>{typeof f.value === 'object' ? f.value?.raw ?? JSON.stringify(f.value) : f.value ?? f.object_name}</span></p>)}</div><Sources evidence={detailEvidence} read={readEvidence}/></div></aside>}
    {libraryOpen && <LibrarySwitcher libraries={boot?.projects || []} currentId={projectId} onClose={() => setLibraryOpen(false)} onSelect={id => { if (id !== projectId) { setProjectId(id); setView('chat'); setGraphExpanded(false); } setLibraryOpen(false); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); }} onCreate={() => { setLibraryOpen(false); setUploadNew(true); setUploadOpen(true); }}/>}
    {settingsOpen && <ApiSettings close={closeSettings} refresh={refresh} onboarding={onboarding} locked={busy || testing}/>}
    {(uploadOpen || backupOpen) && <Modal title={backupOpen ? '恢复知识库备份' : '上传你的资料'} className="upload-modal" disabled={uploading} onClose={() => { setUploadOpen(false); setBackupOpen(false); }}>
      <p>{backupOpen ? '选择本系统导出的知识库备份 ZIP，恢复图谱和解析正文。' : '选择资料的归属，再上传文件。你可以补充现有资料，也可以用全新的文件开始。'}</p>
      {!backupOpen && <UploadDestination canAppend={!!project?.can_append} currentName={project?.name || '当前资料库'} createNew={uploadNew} disabled={uploading} onChange={setUploadNew}/>}
      <button className="upload-dropzone" disabled={uploading} onClick={() => (backupOpen ? importRef : uploadRef).current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files, backupOpen); }}>
        <Upload size={30}/><strong>{uploading ? `正在上传 ${uploadProgress}%` : backupOpen ? '选择备份 ZIP' : '选择文件或拖到这里'}</strong><span>{backupOpen ? '仅支持本系统导出的知识库备份' : 'PDF · DOCX · XLSX · PPTX · 图片 · 文本'}</span>{uploading && <progress value={uploadProgress} max={100}/>}
      </button>
      {!backupOpen && <><button className="soft-button full" disabled={uploading} onClick={() => folderRef.current?.click()}><FolderOpen size={16}/>选择文件夹</button><p className="upload-mode-note" role="status">{project?.can_append && !uploadNew ? '相同文件会跳过；同名但内容不同的文件另存。上传后需要重新生成图谱。' : '本次文件将创建独立资料库，你可以随时切回原资料库。'}</p></>}
      {error && <p className="api-error" role="alert">{error}</p>}
    </Modal>}
    {pendingRemoval && <Modal title="删除这份资料？" className="remove-modal" disabled={deleting} onClose={() => setPendingRemoval(undefined)}>
      <div className="removal-file"><FileText size={24}/><strong>{pendingRemoval.path}</strong></div>
      <p>将从当前资料库移除这份文件。删除后需要重新生成图谱，其他文件和资料库会保留。</p>
      {removalError && <p className="api-error" role="alert">{removalError}</p>}
      <div className="modal-actions"><button className="soft-button" disabled={deleting} onClick={() => setPendingRemoval(undefined)}>保留文件</button><button className="danger-button" disabled={deleting} onClick={removeFile}>{deleting ? <Loader2 size={16} className="spin"/> : <Trash2 size={16}/>} {deleting ? '正在删除…' : '删除文件'}</button></div>
    </Modal>}
  </div>;
}
