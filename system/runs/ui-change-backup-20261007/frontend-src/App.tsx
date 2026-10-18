import { useEffect, useRef, useState } from 'react';
import Graph, { graphPalettes, graphTypeLabels as typeLabels, type GraphData } from './GraphScene';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Download, FileText, FolderOpen, Layers, Loader2, MessageSquare, Network, Plus, Settings2, ShieldCheck, Square, Upload, X, FlaskConical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import ApiSettings from './ApiSettings';
import DocumentReader, { type SourceDocument } from './DocumentReader';
import ChatTurn, { Execution, Sources, type Turn, type Evidence, type Activity } from './ChatTurn';
import { relationLabel } from './relations';
import DiamondBackground from './DiamondBackground';
import { applyTheme, initialTheme, type Theme } from './theme';
import { Sun, Moon } from 'lucide-react';
type Project = { id: string; name: string; ready: boolean; read_only: boolean; can_append?: boolean; files: any[]; counts: Record<string, number>; units: number; benchmark_demo?: boolean; graph?: GraphData; entity_graph?: GraphData; source_scope?: any };
async function api(path: string, options?: RequestInit) { const response = await fetch('/api' + path, options); const data = await response.json(); if (!response.ok) throw new Error(data.detail || `请求失败 (${response.status})`); return data; }
const post = (path: string, body?: any) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const saveText = (text: string, name: string) => { const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const fileBadge = (format: string) => ({ docx: 'DOC', xlsx: 'XLS', pptx: 'PPT', jpeg: 'JPG' }[format] || format.toUpperCase().slice(0, 3));
function SourceScopeNotice({ project }: { project?: Project }) { return <details className="graph-source-scope"><summary><ShieldCheck size={14}/>{project?.source_scope?.verified ? `来源已核验 · ${project.source_scope.corpus_count} 份业务资料` : '来源范围'}<ChevronDown size={13}/></summary><div className="source-scope-popover">{project?.source_scope?.issues?.map((s: string) => <p key={s}>{s}</p>)}{project?.files.map(f => <p key={f.path}>{f.path}<small> · {f.role === 'corpus' ? '参与构图' : '不参与构图'}</small></p>)}</div></details>; }
export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const [boot, setBoot] = useState<any>(); const [projectId, setProjectId] = useState(''); const [project, setProject] = useState<Project>();
  const [view, setView] = useState('chat'); const [reading, setReading] = useState<SourceDocument>(); const [sourceLocation, setSourceLocation] = useState(''); const sourceReturnView = useRef('chat'); const [graphTurn, setGraphTurn] = useState<Turn>();
  const [settingsOpen, setSettingsOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 800);
  const [input, setInput] = useState(''); const [turns, setTurns] = useState<Turn[]>([]); const [history, setHistory] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState(''); const [runId, setRunId] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]); const [building, setBuilding] = useState(false); const [testing, setTesting] = useState(false); const [results, setResults] = useState<Record<string, Turn>>({});
  const [uploadOpen, setUploadOpen] = useState(false); const [uploading, setUploading] = useState(false); const [uploadProgress, setUploadProgress] = useState(0); const [backupOpen, setBackupOpen] = useState(false);
  const [uploadNew, setUploadNew] = useState(false); const [uploadNotice, setUploadNotice] = useState(''); const folderRef = useRef<HTMLInputElement>(null);
  const [graphMode, setGraphMode] = useState('entities'); const [queryView, setQueryView] = useState(false); const [selectedId, setSelectedId] = useState(''); const [detail, setDetail] = useState<any>(); const [drawer, setDrawer] = useState(false); const [graphExpanded, setGraphExpanded] = useState(false); const [fullView, setFullView] = useState(false); const [fullGraph, setFullGraph] = useState<GraphData>(); const [pathIndex, setPathIndex] = useState(-1);
  const uploadRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null); const streamRef = useRef<EventSource | undefined>(undefined); const activeRef = useRef(false); const parentRef = useRef<string | undefined>(undefined); const stopTesting = useRef(false); const batchId = useRef<string | undefined>(undefined); const projectRef = useRef(''); projectRef.current = projectId;
  const contentEnd = useRef<HTMLDivElement>(null); const scrollRef = useRef<HTMLDivElement>(null); const followScroll = useRef(true); const latest = turns.at(-1);
  const refresh = async () => { const data = await api('/bootstrap'); setBoot(data); return data; };
  const reloadHistory = (id = projectId) => api(`/history?project_id=${id}`).then(data => { if (projectRef.current === id) setHistory(data); });
  useEffect(() => { refresh().then(data => { setProjectId(data.default_project); if (!data.api_configured && !localStorage.getItem('evidence-onboarded-v2')) { setOnboarding(true); setSettingsOpen(true); } }).catch(e => setError(e.message)); return () => streamRef.current?.close(); }, []);
  useEffect(() => {
    setUploadNew(false); setUploadNotice('');
    setProject(undefined); setGraphTurn(undefined); setTurns([]); setHistory([]); setResults({}); setActivities([]); setReading(undefined); setDetail(undefined); setDrawer(false); setQueryView(false); setFullView(false); setFullGraph(undefined); parentRef.current = undefined;
    if (!projectId) return; const controller = new AbortController();
    api(`/projects/${projectId}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setProject(data); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    reloadHistory().catch(e => setError(e.message));
    const check = () => { if (document.hidden) return; api(`/projects/${projectId}/source-status`, { signal: controller.signal }).then(data => { if (controller.signal.aborted || data.ready) return; setProject(p => p && ({ ...p, ready: false, graph: { nodes: [], edges: [] }, entity_graph: { nodes: [], edges: [] }, source_scope: data.source_scope })); setFullGraph(undefined); setTurns([]); setDetail(undefined); }).catch(() => {}); };
    const timer = setInterval(check, 10000); return () => { controller.abort(); clearInterval(timer); };
  }, [projectId]);
  useEffect(() => { if (followScroll.current) contentEnd.current?.scrollIntoView({ block: 'end' }); }, [latest?.answer, latest?.events.length, turns.length]);
  useEffect(() => { if (!busy) return; const started = Date.now(); setElapsed(0); const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 300); return () => clearInterval(timer); }, [busy, runId]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setGraphExpanded(false); setDrawer(false); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  const closeSettings = () => { setSettingsOpen(false); setOnboarding(false); localStorage.setItem('evidence-onboarded-v2', '1'); };
  function patchTurn(id: string, patch: Partial<Turn>) { setTurns(t => t.map(v => v.id === id ? { ...v, ...patch } : v)); }
  function listen(id: string, localId?: string): Promise<Turn | undefined> {
    streamRef.current?.close(); setRunId(id); const stream = new EventSource(`/api/runs/${id}/events`); streamRef.current = stream;
    let response: Partial<Turn> = { id, answer: '', status: 'running', events: [] }; let lastEvent = 0;
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
    if (!question.trim() || activeRef.current || uploading) return;
    if (!boot?.api_configured) { setSettingsOpen(true); setError('连接模型后即可提问；当前可浏览本地资料和图谱。'); return; }
    if (!project?.ready) { setError('请先在资料页面完成解析与构图。'); return; }
    activeRef.current = true; setBusy(true); setRunId(''); setError(''); setActivities([]); setInput(''); setGraphTurn(undefined); setQueryView(true); followScroll.current = true;
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
  function newChat() { if (busy || testing) return; parentRef.current = undefined; setGraphTurn(undefined); setTurns([]); setInput(''); setActivities([]); setDetail(undefined); setDrawer(false); setView('chat'); setError(''); }
  async function loadHistory(id: string) {
    if (busy || testing) return;
    try { setGraphTurn(undefined); setPathIndex(-1); const data = await api(`/conversations/${id}`); const converted = data.turns.map((r: any) => { const retrieved = r.events.find((e: any) => e.type === 'retrieval.completed') || {}; const answer = r.events.find((e: any) => e.type === 'answer.completed'); return { ...retrieved, id: r.id, question: r.question, answer: r.answer || answer?.answer || '', model: r.model, mode: answer?.mode || (r.model ? 'answer' : 'retrieve'), status: r.status, events: r.events.filter((e: any) => e.type !== 'answer.delta'), error: r.events.find((e: any) => e.type === 'run.error')?.message }; }); setTurns(converted); parentRef.current = [...converted].reverse().find(t => t.status === 'completed')?.id; setView('chat'); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); followScroll.current = true; }
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
    if (!files?.length || uploading || busy || testing) return; setUploading(true); setUploadProgress(0); setError(''); setUploadNotice('');
    const form = new FormData(); Array.from(files).forEach(file => form.append(importing ? 'file' : 'files', file));
    if (!importing && project?.can_append && !uploadNew) form.append('project_id', projectId);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/projects/' + (importing ? 'import' : 'upload'));
    xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = async () => { try {
      const data = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(data.detail || '上传失败');
      await refresh();
      if (data.id === projectId) {
        setProject(await api(`/projects/${data.id}`));
        if (data.upload_result?.added.length) { setTurns([]); setResults({}); setActivities([]); setReading(undefined); setGraphTurn(undefined); setFullGraph(undefined); setDetail(undefined); setDrawer(false); setQueryView(false); setFullView(false); parentRef.current = undefined; }
      } else setProjectId(data.id);
      const result = data.upload_result;
      if (result && data.id === projectId) setUploadNotice(`新增 ${result.added.length} 份，跳过 ${result.skipped.length} 份重复文件。${result.renamed.length ? '同名文件已另存：' + result.renamed.map((r: any) => r.to).join('、') + '。' : ''}${result.added.length ? '原文件已保留，请重新解析并生成图谱。' : '资料与图谱保持不变。'}`);
      setUploadOpen(false); setBackupOpen(false); setUploadNew(false); setView(importing ? 'graph' : 'documents');
    } catch (e: any) { setError(e.message); } finally { setUploading(false); } };
    xhr.onerror = () => { setUploading(false); setError('上传连接中断，请重试。'); }; xhr.send(form);
  }
  async function build() {
    if (!boot.api_configured) { setSettingsOpen(true); return; }
    if (activeRef.current || uploading) return; setBuilding(true); setBusy(true); activeRef.current = true; setActivities([]); setView('chat'); setError('');
    try { const data = await post(`/projects/${projectId}/build`); await listen(data.run_id); setProject(await api(`/projects/${projectId}`)); }
    catch (e: any) { setError(e.message); } finally { setBuilding(false); setBusy(false); activeRef.current = false; }
  }
  async function roleChange(path: string, role: string) { try { const roles = Object.fromEntries((project?.files || []).map(f => [f.path, f.path === path ? role : f.role])); setProject(await post(`/projects/${projectId}/roles`, { roles })); setReading(r => r?.path === path ? { ...r, role } : r); } catch (e: any) { setError(e.message); } }
  function openDocument(file: SourceDocument) { setReading(file); setSourceLocation(''); setView('documents'); setDrawer(false); setGraphExpanded(false); }
  function readEvidence(e: Evidence) { sourceReturnView.current = view; const file = project?.files.find(f => f.path === e.source); if (file) { openDocument(file); setSourceLocation(e.location || ''); } else setError('此知识库备份未包含该原文件。'); }
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
    <aside className="sidebar"><a className="brand" href="/" aria-label="Evidence 首页"><span className="brand-symbol"><Network size={21}/></span>知源<span className="brand-en">Evidence</span></a>
      <div className="workspace-select"><FolderOpen size={17}/><select aria-label="切换知识库" value={projectId} disabled={busy || testing || uploading} onChange={e => setProjectId(e.target.value)}>{boot?.projects.map((p: Project) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <button className="new-chat" disabled={busy || testing} onClick={newChat}><Plus size={18}/>新对话</button>
      <button className="sidebar-upload" disabled={busy || uploading} onClick={() => setUploadOpen(true)}><Upload size={16}/>添加资料</button>
      <nav>{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'nav-active' : ''} onClick={() => { setView(id); setGraphExpanded(false); setDrawer(false); if (window.innerWidth <= 800) setSidebarOpen(false); }}><Icon size={18}/>{label}</button>)}</nav>
      <div className="history-title">最近对话 <span>{conversations.length}</span></div><div className="sidebar-history">{conversations.length ? conversations.map(h => <button disabled={busy || testing} className={parentRef.current === h.id ? 'selected' : ''} key={h.id} title={h.question} onClick={() => loadHistory(h.id)}><MessageSquare size={14}/><span>{h.question}</span>{h.status === 'failed' && <i className="history-error"/>}</button>) : <p>你的对话会保存在这里</p>}</div>
      <details className="sidebar-files"><summary><FolderOpen size={15}/>资料文件<span>{project?.files.length || 0}</span><ChevronDown size={13}/></summary><div className="file-list">{project?.files.map(f => <button className="file-row" key={f.path} onClick={() => openDocument(f)} title={f.path}><span className={`file-icon ${f.format}`}>{fileBadge(f.format)}</span><span>{f.path.replace(/^测试集A_/, '')}</span></button>)}</div></details>
      <div className="sidebar-bottom"><button disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={17}/>模型设置<span className={boot?.api_configured ? 'configured-dot' : 'unconfigured-dot'}/></button></div>
    </aside>
    <section className="main"><header className="topbar"><div><button aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button><strong>{project?.name || '正在加载资料…'}</strong></div><div className="topbar-actions"><div className="theme-switch" role="group" aria-label="外观模式"><button type="button" aria-label="白天模式" aria-pressed={theme === 'day'} onClick={() => setTheme('day')}><Sun size={14}/><span>白天</span></button><button type="button" aria-label="夜间模式" aria-pressed={theme === 'night'} onClick={() => setTheme('night')}><Moon size={14}/><span>夜间</span></button></div><button className={`model-pill ${boot?.api_configured ? '' : 'needs-config'}`} disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={15}/><span>{boot?.api_configured ? boot.model : '配置模型 · 开始问答'}</span><ChevronDown size={13}/></button></div></header>
      <div className="mobile-nav">{navItems.map(([id, Icon, label]) => <button aria-label={label} className={view === id ? 'active' : ''} key={id} onClick={() => setView(id)}><Icon size={17}/>{label}</button>)}</div>
      {uploadNotice && view === 'documents' && <div className="upload-notice" role="status">{uploadNotice}<button aria-label="关闭上传提示" onClick={() => setUploadNotice('')}><X size={16}/></button></div>}
      {error && <div className="error-bar" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {view !== 'chat' && <div className="page-toolbar"><div><h1>{{ graph: '知识图谱', documents: '原始资料', tests: '十题完整问答' }[view]}</h1><p>{{ graph: '查看主体之间的关系，点击连线核对中文关系与原文。', documents: '上传、阅读和管理参与问答的文件。', tests: '使用当前模型逐题生成答案，并保留执行过程与来源。' }[view]}</p></div><div className="toolbar-actions">{view === 'graph' && <button className="soft-button" disabled={!project?.ready} onClick={() => window.location.assign(`/api/projects/${projectId}/export/html`)}><Download size={15}/>导出思维导图</button>}{view === 'documents' && <button className="primary" disabled={busy} onClick={() => setUploadOpen(true)}><Plus size={17}/>添加资料</button>}</div></div>}
      {view === 'documents' && <><div className="document-tools"><span>{project?.files.length || 0} 份文件 · {project?.files.filter(f => f.role === 'corpus').length || 0} 份参与构图</span>{!project?.ready && <button className="primary" disabled={busy} onClick={build}>{busy ? <Loader2 className="spin" size={15}/> : <Network size={15}/>}解析资料并生成图谱</button>}<details><summary>备份与恢复<ChevronDown size={13}/></summary><div><a href={`/api/projects/${projectId}/export`}>下载知识库备份 ZIP</a><button disabled={busy} onClick={() => setBackupOpen(true)}>从本系统备份恢复…</button></div></details></div>{sourceLocation && <div className="source-jump-note">来源位置：{sourceLocation}<button onClick={() => setView(sourceReturnView.current)}>返回回答</button></div>}<DocumentReader location={sourceLocation} projectId={projectId} document={reading} files={project?.files || []} onSelect={openDocument} busy={busy} onRole={!project?.read_only && reading ? role => roleChange(reading.path, role) : undefined}/></>}
      {view === 'chat' && <div ref={scrollRef} tabIndex={0} aria-label="对话内容" className={`conversation ${turns.length ? 'has-turns' : ''}`} onScroll={() => { const el = scrollRef.current; if (el) followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 180; }}>
        {!turns.length && <div className="chat-welcome"><span className="welcome-icon"><Network size={27}/></span><h1>从你的资料，找到答案</h1><p>{project?.ready ? `已收录 ${project.source_scope?.corpus_count || project.files.filter(f => f.role === 'corpus').length} 份业务资料。提问后，可查看关联关系与原文依据。` : '添加资料并生成知识图谱，即可开始问答。'}</p>{!boot?.api_configured && <button className="connect-banner" onClick={() => setSettingsOpen(true)}><Settings2 size={18}/><span><strong>连接模型，开始对话</strong><small>暂未配置 API · 仍可浏览离线图谱和资料</small></span><ArrowUpRight size={17}/></button>}
          {project?.ready ? <div className="suggestion-grid">{boot?.questions.slice(0, 4).map((q: any) => <button key={q.id} onClick={() => { setInput(q.question); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(); }}><span>{q.title.replace(/（.*?）/, '')}</span><p>{q.question.slice(0, 70)}{q.question.length > 70 ? '…' : ''}</p><ArrowUpRight size={16}/></button>)}</div> : <button className="primary" disabled={busy} onClick={build}><Network size={17}/>解析资料并生成图谱</button>}
          {(building || activities.length > 0) && <Execution events={activities} running={building} elapsed={elapsed} error={error || undefined}/>}</div>}
        {turns.map((turn, i) => <ChatTurn key={turn.id || i} turn={turn} elapsed={elapsed} read={readEvidence} graph={() => { setGraphTurn(turn); setFullView(false); setQueryView(true); setView('graph'); }} download={saveText}/>)}<div ref={contentEnd}/>
      </div>}
      {view === 'graph' && <div className={`graph-page ${graphExpanded ? 'graph-expanded' : ''}`}>
        <SourceScopeNotice project={project}/>
        <div className="graph-focus-toolbar"><button className="soft-button" aria-pressed={graphExpanded} onClick={() => setGraphExpanded(!graphExpanded)}>{graphExpanded ? <X size={14}/> : <Network size={14}/>} {graphExpanded ? "退出专注模式" : "展开图谱"}</button><small>网络来自收录资料 · 选择关系查看中文说明</small></div><div className="graph-view-tabs" aria-label="切换图谱视图"><button aria-pressed={graphMode === 'entities'} onClick={() => { setGraphMode('entities'); setFullView(false); setQueryView(false); setSelectedId(''); setDetail(undefined); }}><Network size={16}/><div><strong>主体关系网络</strong><small>产品 · 工具 · 客户 · 版本</small></div></button><button aria-pressed={graphMode === 'architecture'} onClick={() => { setGraphMode('architecture'); setFullView(false); setQueryView(false); setSelectedId(''); setDetail(undefined); }}><Layers size={16}/><div><strong>产品与工具架构</strong><small>保留原有分区视图</small></div></button></div>
        <div className="graph-toolbar"><span><i/>{fullView ? '原始抽取 · 含运营事件' : queryView && graphAnswer ? '当前问题的证据子图' : `${displayGraph?.nodes.length || 0} 个主体 · ${displayGraph?.edges.length || 0} 条业务关系`}</span><div className="graph-scope-controls"><select aria-label="图谱范围" disabled={!project?.ready} value={fullView ? 'all' : queryView && graphAnswer ? 'query' : 'context'} onChange={e => changeGraphScope(e.target.value)}><option value="context">收录资料的主体关系</option>{graphAnswer && <option value="query">当前问题关联子图</option>}<option value="all">全部抽取结果（含事件）</option></select>{queryView && graphAnswer && <select disabled={fullView || !graphAnswer.paths?.length} aria-label="选择关联路径" value={pathIndex} onChange={e => setPathIndex(Number(e.target.value))}><option value={-1}>全部相关路径</option>{graphAnswer.paths?.map((p: any, index: number) => <option key={p.path_id} value={index}>路径 {index + 1} · {p.steps.length} 跳</option>)}</select>}</div></div>
        <div className="relation-explorer"><label>查看两个主体的关系<select aria-label="选择主体关系" value={displayGraph?.edges.some((e: { id: string }) => e.id === selectedId) ? selectedId : ''} onChange={e => selectItem(e.target.value)}><option value="">选择关系，或直接点击图谱连线</option>{displayGraph?.edges.map((e: { id: string; source: string; target: string; predicate: string }) => <option key={e.id} value={e.id}>{String(displayNames.get(e.source))} —{relationLabel(e.predicate)}→ {String(displayNames.get(e.target))}</option>)}</select></label>{selectedId && <button className="text-link" onClick={() => selectItem('')}>清除选择</button>}</div>
        {detail?.relation && selectedId === detail.item.id && <div className="selected-relation" role="status"><strong>{detail.relation.source}</strong><span>— {detail.relation.label} →</span><strong>{detail.relation.target}</strong><small>{detail.evidence.length} 处原文依据 · 已突出两端与连线</small></div>}
        <div className="graph-canvas"><Graph theme={theme} key={`${projectId}:${fullView ? 'all' : queryView && graphAnswer ? 'query' : graphMode}`} graph={displayGraph} select={selectItem} selectedId={selectedId} path={!fullView && queryView && pathIndex >= 0 ? graphAnswer?.paths?.[pathIndex] : undefined}/></div>
        <div className="graph-legend">{(fullView || queryView && graphAnswer ? ['Product', 'AITool', 'Event', 'Actor', 'Version'] : graphMode === 'entities' ? ['Product', 'AITool', 'Actor', 'Version'] : ['Product', 'AITool']).map(t => <span key={t}><i style={{ background: colors[t] }}/>{typeLabels[t]}</span>)}<small>拖拽 / 缩放 · 点击连线看中文关系与原文</small></div>
        {graphAnswer && <div className="graph-query-status"><div><span className="eyebrow">当前问题</span><p>{graphAnswer.question}</p><small>{graphAnswer.status === 'running' ? '正在沿线索检索…' : `${graphAnswer.stats?.facts || 0} 条事实 / ${graphAnswer.paths?.length || 0} 条路径 / ${graphAnswer.evidence?.length || 0} 处证据`}</small></div><button className="text-link" onClick={() => setView('chat')}>查看回答 <ArrowUpRight size={15}/></button></div>}
      </div>}
      
      {['chat', 'graph'].includes(view) && <div className="composer-wrap"><div className={`composer ${busy ? 'running' : ''}`}><textarea aria-label="输入问题" placeholder={boot?.api_configured ? '询问资料中的问题，或继续追问…' : '先连接模型，再开始提问…'} value={input} disabled={busy || testing} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask().catch(() => {}); } }}/><div className="composer-bottom"><button className="composer-project" onClick={() => setView('documents')}><FolderOpen size={16}/>{project?.name || '资料库'}</button><div><span>{busy ? `${elapsed.toFixed(0)} 秒` : 'Enter 发送 · Shift + Enter 换行'}</span>{busy ? <button className="send" aria-label="停止生成" disabled={!runId} onClick={cancel}><Square size={15}/></button> : <button className="send" aria-label="发送问题" disabled={!input.trim() || testing} onClick={() => ask().catch(() => {})}><ArrowUp size={20}/></button>}</div></div></div></div>}
      {view === 'tests' && <div className="tests-page"><div className="test-intro"><div><strong>测试集 A · 10 个问题</strong><p>{boot?.api_configured ? `当前模型：${boot.model}` : '请先配置模型，再运行完整问答。离线图谱可直接浏览。'}</p><small>逐题调用模型；长回答可能自动续写，按服务商计费。生成完成不代表答案评分通过。</small></div><button className="primary" disabled={busy || testing || !project?.ready || !project?.benchmark_demo} onClick={batchTest}>{testing ? <Loader2 className="spin" size={16}/> : <FlaskConical size={16}/>}运行十题完整问答</button>{testing && <button className="soft-button" onClick={cancel}>停止测试</button>}</div>{testing && <Execution events={activities} running={busy} elapsed={elapsed}/>}<div className="test-list">{boot?.questions.map((q: any) => <details className="test-result-card" key={q.id}><summary><span>{q.id}</span><strong>{q.title}</strong><small className={results[q.id]?.status === 'failed' ? 'red' : ''}>{{ completed: '回答已生成', running: '正在回答', failed: '失败', cancelled: '已停止' }[results[q.id]?.status] || '待运行'}</small><ChevronDown size={15}/></summary><p>{q.question}</p>{results[q.id] ? <ChatTurn turn={results[q.id]} elapsed={elapsed} read={readEvidence} graph={() => { setGraphTurn(results[q.id]); setFullView(false); setQueryView(true); setView('graph'); }} download={saveText}/> : <button disabled={busy || testing} className="soft-button" onClick={() => { setView('chat'); setInput(q.question); }}>在对话中提问<ArrowUpRight size={14}/></button>}</details>)}</div>{Object.values(results).some(t => t.answer) && <button className="soft-button" onClick={() => saveText(Object.entries(results).map(([id, t]) => `# ${id} ${t.question}\n\n模型：${t.model || boot.model}\n状态：${t.status}\n\n${t.answer || t.error || ''}`).join('\n\n---\n\n'), '测试集A-完整问答.md')}><Download size={15}/>导出本轮答案</button>}</div>}
    </section>
    {drawer && detail && <aside className="details"><div className="details-tabs"><strong>关系与原文依据</strong><button className="drawer-close" aria-label="关闭证据面板" onClick={() => setDrawer(false)}><X size={18}/></button></div><div className="details-content"><h3>{detail.relation ? `${detail.relation.source} — ${detail.relation.label} → ${detail.relation.target}` : detail.item?.name}</h3><p className="muted">{detail.fact_count} 条关联事实</p><div className="fact-detail">{detail.facts?.map((f: any) => <p key={f.fact_id}>{f.qualifiers?.attribute || f.predicate_label}<span>{typeof f.value === 'object' ? f.value?.raw ?? JSON.stringify(f.value) : f.value ?? f.object_name}</span></p>)}</div><Sources evidence={detailEvidence} read={readEvidence}/></div></aside>}
    {settingsOpen && <ApiSettings close={closeSettings} refresh={refresh} onboarding={onboarding} locked={busy || testing}/>}
    {(uploadOpen || backupOpen) && <div className="modal-backdrop" onClick={() => { if (!uploading) { setUploadOpen(false); setBackupOpen(false); } }}><div className="settings-modal upload-modal" role="dialog" aria-modal="true" aria-label={backupOpen ? '从备份恢复' : '添加资料'} onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭上传" disabled={uploading} onClick={() => { setUploadOpen(false); setBackupOpen(false); }}><X size={19}/></button><h2>{backupOpen ? '恢复知识库备份' : '添加你的资料'}</h2><p>{backupOpen ? '选择本系统“下载知识库备份”生成的 ZIP，恢复其中的图谱和解析正文。备份不包含全部原始文件；普通文档请用“添加资料”。' : project?.can_append && !uploadNew ? '本批文件会追加到当前资料库。相同文件跳过；同名但内容不同会另存，原文件保留。追加后需要重新构图。' : '本批文件组成新的资料库，原来的资料库保留。之后可分批追加到这个新资料库。'}</p>{!backupOpen && project?.can_append && <label className="upload-target">上传到<select aria-label="上传目标" disabled={uploading} value={uploadNew ? 'new' : 'current'} onChange={e => setUploadNew(e.target.value === 'new')}><option value="current">追加到当前资料库 · {project.name}</option><option value="new">新建独立资料库</option></select></label>}<button className="upload-dropzone" disabled={uploading} onClick={() => (backupOpen ? importRef : uploadRef).current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files, backupOpen); }}><Upload size={30}/><strong>{uploading ? `正在上传 ${uploadProgress}%` : backupOpen ? '选择备份 ZIP' : '选择文件或拖到这里'}</strong><span>{backupOpen ? '仅支持本系统导出的知识库备份' : 'PDF · DOC · XLS · PPT · 图片 · 文本'}</span>{uploading && <progress value={uploadProgress} max={100}/>}</button>{!backupOpen && <button className="soft-button full" disabled={uploading} onClick={() => folderRef.current?.click()}><FolderOpen size={16}/>选择文件夹</button>}{error && <p className="api-error">{error}</p>}</div></div>}
  </div>;
}
