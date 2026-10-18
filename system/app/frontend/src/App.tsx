import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import Graph, { graphPalettes, graphTypeLabels as typeLabels, type GraphData } from './GraphScene';
import { ArrowUp, ArrowUpRight, Braces, Check, ChevronDown, ChevronRight, Download, FileText, FolderOpen, Loader2, MessageSquare, MoreHorizontal, Network, Plus, Settings2, Share2, ShieldCheck, Upload, X, FlaskConical, PanelLeftClose, PanelLeftOpen, Trash2, RotateCcw, ArrowLeft, ChevronsUpDown } from 'lucide-react';
import ApiSettings from './ApiSettings';
import DocumentReader, { type SourceDocument } from './DocumentReader';
import ChatTurn, { Execution, type Turn, type Evidence, type Activity } from './ChatTurn';
import GraphControls, { type GraphView } from './GraphControls';
import { droppedFiles, validateUpload } from './uploadFiles';
import { chatMarkdown, conversationHtml, conversationLog } from './conversationExport';
import Modal from './Modal';
import UploadDestination from './UploadDestination';
import LibrarySwitcher from './LibrarySwitcher';
import Composer from './Composer';
import EvidencePanel, { type EvidencePanelState } from './EvidencePanel';
import { applyTheme, initialTheme, type Theme } from './theme';
import { Sun, Moon } from 'lucide-react';
type AnswerOrigin = { view: 'chat' | 'tests'; turnId?: string; testId?: string; scrollTop?: number; follow?: boolean };
type Project = { id: string; name: string; ready: boolean; read_only: boolean; can_append?: boolean; files: any[]; counts: Record<string, number>; units: number; benchmark_demo?: boolean; graph?: GraphData; entity_graph?: GraphData; source_scope?: any };
async function api(path: string, options?: RequestInit) { const response = await fetch('/api' + path, options); const data = await response.json(); if (!response.ok) throw new Error(data.detail || `请求失败 (${response.status})`); return data; }
const post = (path: string, body?: any) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const del = (path: string) => api(path, { method: 'DELETE' });
const saveText = (text: string, name: string, mime = 'text/markdown') => { const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const fileBadge = (format: string) => ({ docx: 'DOC', xlsx: 'XLS', pptx: 'PPT', jpeg: 'JPG' }[format] || format.toUpperCase().slice(0, 3));
const SIDEBAR_WIDTH_KEY = 'evidence-sidebar-width';
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 420;
const SIDEBAR_WIDTH_DEFAULT = 290;
const readSidebarWidth = () => {
  const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = saved ? Number.parseInt(saved, 10) : SIDEBAR_WIDTH_DEFAULT;
  if (!Number.isFinite(parsed)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, parsed));
};
function SourceScopeNotice({ project }: { project?: Project }) { return <details className="graph-source-scope"><summary><ShieldCheck size={14}/>{project?.source_scope?.verified ? <>来源已核验 · <span className="data-number">{project.source_scope.corpus_count}</span> 份业务资料</> : '来源范围'}<ChevronDown size={13}/></summary><div className="source-scope-popover">{project?.source_scope?.issues?.map((s: string) => <p key={s}>{s}</p>)}{project?.files.map(f => <p key={f.path}>{f.path}<small> · {f.role === 'corpus' ? '参与构图' : '不参与构图'}</small></p>)}</div></details>; }
export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const [boot, setBoot] = useState<any>(); const [projectId, setProjectId] = useState(''); const [project, setProject] = useState<Project>();
  const benchmarkAvailable = projectId === 'host' && project?.id === projectId && !!project.benchmark_demo;
  const [view, setView] = useState('chat'); const [reading, setReading] = useState<SourceDocument>(); const [sourceLocation, setSourceLocation] = useState(''); const [readingFromAnswer, setReadingFromAnswer] = useState(false); const sourceReturnView = useRef('chat'); const graphReturnRef = useRef<AnswerOrigin>({ view: 'chat' }); const sourceAnswerRef = useRef<AnswerOrigin>({ view: 'chat' }); const [graphTurn, setGraphTurn] = useState<Turn>();
  const [evidencePanel, setEvidencePanel] = useState<EvidencePanelState>();
  const [panelRevision, setPanelRevision] = useState(0);
  const graphSelectionRequest = useRef(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 800);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const sidebarResizing = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const onSidebarResizePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth <= 800 || !sidebarOpen) return;
    e.preventDefault();
    sidebarResizing.current = true;
    document.body.classList.add('sidebar-resizing');
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSidebarResizePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sidebarResizing.current) return;
    const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, e.clientX));
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  };
  const endSidebarResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sidebarResizing.current) return;
    sidebarResizing.current = false;
    document.body.classList.remove('sidebar-resizing');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
  };
  const workspaceStyle = sidebarOpen ? ({ '--rail-width': `${sidebarWidth}px` } as CSSProperties) : undefined;
  const [input, setInput] = useState(''); const [turns, setTurns] = useState<Turn[]>([]); const [history, setHistory] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState(''); const [runId, setRunId] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]); const [building, setBuilding] = useState(false); const [testing, setTesting] = useState(false); const [results, setResults] = useState<Record<string, Turn>>({});
  const [uploadOpen, setUploadOpen] = useState(false); const [uploading, setUploading] = useState(false); const [uploadProgress, setUploadProgress] = useState(0); const [backupOpen, setBackupOpen] = useState(false);
  const [uploadNew, setUploadNew] = useState(false); const [uploadNotice, setUploadNotice] = useState(''); const folderRef = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false); const [exporting, setExporting] = useState<'log' | 'chat' | 'html'>();
  const [pendingRemoval, setPendingRemoval] = useState<SourceDocument>(); const [deleting, setDeleting] = useState(false); const [removalError, setRemovalError] = useState(''); const [buildFailure, setBuildFailure] = useState('');
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<{ runId: string; conversationId: string; question: string }>();
  const [pendingClearHistory, setPendingClearHistory] = useState(false);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [historyDeleteError, setHistoryDeleteError] = useState('');
  const [historyMenu, setHistoryMenu] = useState<{ id: string; conversationId: string; question: string; top: number; left: number }>();
  const activeConversationRef = useRef<string | undefined>(undefined);
  const [graphMode, setGraphMode] = useState<GraphView>('entities'); const [selectedId, setSelectedId] = useState(''); const [detail, setDetail] = useState<any>(); const [fullGraph, setFullGraph] = useState<GraphData>(); const [pathIndex, setPathIndex] = useState(-1);
  const [graphLoading, setGraphLoading] = useState(false); const graphViewRequest = useRef(0);
  useEffect(() => { graphViewRequest.current++; setGraphLoading(false); }, [projectId, graphMode]);
  const uploadRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null); const streamRef = useRef<EventSource | undefined>(undefined); const activeRef = useRef(false); const parentRef = useRef<string | undefined>(undefined); const stopTesting = useRef(false); const batchId = useRef<string | undefined>(undefined); const projectRef = useRef(''); projectRef.current = projectId;
  const contentEnd = useRef<HTMLDivElement>(null); const scrollRef = useRef<HTMLDivElement>(null); const followScroll = useRef(true); const latest = turns.at(-1);
  const refresh = async () => { const data = await api('/bootstrap'); setBoot(data); return data; };
  const reloadHistory = (id = projectId) => api(`/history?project_id=${id}`).then(data => { if (projectRef.current === id) setHistory(data); });
  useEffect(() => { refresh().then(data => { setProjectId(data.default_project); if (!data.api_configured && !localStorage.getItem('evidence-onboarded-v2')) { setOnboarding(true); setSettingsOpen(true); } }).catch(e => setError(e.message)); return () => streamRef.current?.close(); }, []);
  useEffect(() => {
    setView(current => current === 'tests' ? 'chat' : current);
    setUploadNew(false); setUploadNotice(''); setPendingRemoval(undefined); setRemovalError(''); setBuildFailure('');
    graphReturnRef.current = { view: 'chat' }; sourceAnswerRef.current = { view: 'chat' };
    setReadingFromAnswer(false); setProject(undefined); setGraphTurn(undefined); setTurns([]); setHistory([]); setResults({}); setActivities([]); setReading(undefined); setDetail(undefined); setEvidencePanel(undefined); setGraphMode('entities'); setPathIndex(-1); setSelectedId(''); setFullGraph(undefined); parentRef.current = undefined;
    if (!projectId) return; const controller = new AbortController();
    api(`/projects/${projectId}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setProject(data); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    reloadHistory().catch(e => setError(e.message));
    const check = () => { if (document.hidden) return; api(`/projects/${projectId}/source-status`, { signal: controller.signal }).then(data => { if (controller.signal.aborted || data.ready) return; setProject(p => p && ({ ...p, ready: false, graph: { nodes: [], edges: [] }, entity_graph: { nodes: [], edges: [] }, source_scope: data.source_scope })); setFullGraph(undefined); setTurns(current => current.filter(turn => turn.mode === 'general' || turn.mode === 'auto')); setDetail(undefined); setEvidencePanel(undefined); }).catch(() => {}); };
    const timer = setInterval(check, 10000); return () => { controller.abort(); clearInterval(timer); };
  }, [projectId]);
  useEffect(() => { const container = scrollRef.current; if (view === 'chat' && followScroll.current && container) container.scrollTop = container.scrollHeight; }, [latest?.answer, latest?.events.length, turns.length]);
  useEffect(() => { if (!busy) return; const started = performance.now(); setElapsed(0); const timer = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 100) / 10), 100); return () => clearInterval(timer); }, [busy, runId]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { setEvidencePanel(undefined); setHistoryMenu(undefined); if (window.innerWidth <= 800) setSidebarOpen(false); } }; const pointer = (e: PointerEvent) => { const target = e.target as Element | null; if (target?.closest('.history-item-menu-panel') || target?.closest('.history-item-more')) return; setHistoryMenu(undefined); }; window.addEventListener('keydown', escape); document.addEventListener('pointerdown', pointer); return () => { window.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', pointer); }; }, []);
  async function openLibrarySwitcher() { setLibraryOpen(true); try { await refresh(); } catch (e: any) { setError(e.message); } }
  const closeSettings = () => { setSettingsOpen(false); setOnboarding(false); localStorage.setItem('evidence-onboarded-v2', '1'); };
  function patchTurn(id: string, patch: Partial<Turn>) { setTurns(t => t.map(v => v.id === id ? { ...v, ...patch } : v)); }
  function listen(id: string, localId?: string): Promise<Turn | undefined> {
    if (localId) patchTurn(localId, { runId: id });
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
        if (event.type === 'stage.started' && event.mode) response.mode = event.mode;
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
  async function ask(question = input, independent = false, mode: 'auto' | 'answer' = 'auto') {
    if (!question.trim() || activeRef.current || uploading || deleting) return;
    if (!boot?.api_configured) { setSettingsOpen(true); setError('连接模型后即可提问；当前可浏览本地资料和图谱。'); return; }
    if (mode === 'answer' && !project?.ready) { setError('请先在资料页面完成解析与构图。'); return; }
    activeRef.current = true; setBusy(true); setRunId(''); setError(''); setActivities([]); setInput(''); setGraphTurn(undefined); graphReturnRef.current = { view: 'chat' }; setGraphMode('query'); setPathIndex(-1); setSelectedId(''); followScroll.current = true;
    const localId = crypto.randomUUID(); const initial: Turn = { id: localId, question: question.trim(), answer: '', mode, model: boot.model, status: 'running', events: [] };
    setTurns(t => independent ? [initial] : [...t, initial]);
    try {
      const data = await post('/runs', { project_id: projectId, question: question.trim(), mode, parent_run_id: independent ? undefined : parentRef.current });
      const result = await listen(data.run_id, localId);
      if (result?.status === 'completed' && !independent) {
        parentRef.current = data.run_id;
        if (!activeConversationRef.current) activeConversationRef.current = data.run_id;
      }
      return { ...initial, ...result } as Turn;
    } catch (e: any) { patchTurn(localId, { status: 'failed', error: e.message }); activeRef.current = false; setBusy(false); setError(e.message); throw e; }
  }
  async function cancel() { stopTesting.current = true; if (runId) { try { await post(`/runs/${runId}/cancel`); } catch (e: any) { setError(e.message); } } }
  function newChat() { if (busy || testing) return; parentRef.current = undefined; activeConversationRef.current = undefined; setGraphTurn(undefined); setGraphMode('entities'); setPathIndex(-1); setSelectedId(''); graphReturnRef.current = { view: 'chat' }; setTurns([]); setInput(''); setActivities([]); setDetail(undefined); setEvidencePanel(undefined); setView('chat'); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); }
  function clearLoadedConversation(deletedIds: string[], conversationId?: string) {
    const hit = conversationId && activeConversationRef.current === conversationId;
    const turnHit = turns.some(turn => deletedIds.includes(turn.runId || turn.id || ''));
    const parentHit = parentRef.current && deletedIds.includes(parentRef.current);
    if (hit || turnHit || parentHit) newChat();
  }
  async function deleteConversation() {
    if (!pendingDeleteConversation || historyDeleting || busy || testing) return;
    const { runId, conversationId } = pendingDeleteConversation;
    setHistoryDeleting(true); setHistoryDeleteError('');
    try {
      const data = await del(`/conversations/${runId}?project_id=${encodeURIComponent(projectId)}`);
      clearLoadedConversation(data.ids || [], conversationId);
      setPendingDeleteConversation(undefined);
      await reloadHistory();
    } catch (e: any) { setHistoryDeleteError(e.message); } finally { setHistoryDeleting(false); }
  }
  async function clearAllHistory() {
    if (historyDeleting || busy || testing) return;
    setHistoryDeleting(true); setHistoryDeleteError('');
    try {
      const data = await del(`/history?project_id=${encodeURIComponent(projectId)}`);
      clearLoadedConversation(data.ids || [], activeConversationRef.current);
      setResults({});
      setPendingClearHistory(false);
      await reloadHistory();
    } catch (e: any) { setHistoryDeleteError(e.message); } finally { setHistoryDeleting(false); }
  }
  function retryTurn(turn: Turn) {
    if (busy || testing || uploading || deleting) return;
    setEvidencePanel(undefined);
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
        setTurns([]); setResults({}); setActivities([]); setGraphTurn(undefined); setFullGraph(undefined); setDetail(undefined); setEvidencePanel(undefined); setGraphMode('entities'); parentRef.current = undefined;
        setBuildFailure(''); setError(''); setView('documents');
        setUploadNotice(updated.files.length ? '文件已从当前资料库删除。请重新生成图谱，使用剩余资料继续问答。' : '当前资料库已清空。上传新文件后，即可重新生成图谱。');
      }
      await refresh();
    } catch (e: any) { setRemovalError(e.message); } finally { setDeleting(false); }
  }
  async function loadHistory(id: string) {
    if (busy || testing) return;
    setEvidencePanel(undefined);
    try { setGraphTurn(undefined); graphReturnRef.current = { view: 'chat' }; setPathIndex(-1); const data = await api(`/conversations/${id}`); const converted = data.turns.map((r: any) => { const retrieved = r.events.find((e: any) => e.type === 'retrieval.completed') || {}; const answer = r.events.find((e: any) => e.type === 'answer.completed'); return { ...retrieved, id: r.id, runId: r.id, question: r.question, answer: r.answer || answer?.answer || '', model: r.model, mode: r.mode || answer?.mode || (r.model ? 'answer' : 'retrieve'), status: r.status, events: r.events.filter((e: any) => e.type !== 'answer.delta'), error: r.events.find((e: any) => e.type === 'run.error')?.message }; }); activeConversationRef.current = data.turns[0]?.conversation_id || data.turns[0]?.id; setTurns(converted); parentRef.current = [...converted].reverse().find(t => t.status === 'completed')?.id; setView('chat'); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); followScroll.current = true; }
    catch (e: any) { setError(e.message); }
  }
  async function batchTest() {
    if (!benchmarkAvailable || busy || testing || uploading || deleting) return;
    if (!boot.api_configured) { setSettingsOpen(true); return; }
    stopTesting.current = false; setTesting(true); setResults({}); parentRef.current = undefined;
    for (const q of boot.questions) { if (stopTesting.current) break; batchId.current = q.id; setResults(r => ({ ...r, [q.id]: { question: q.question, answer: '', mode: 'answer', status: 'running', events: [] } }));
      try { const result = await ask(q.question, true, 'answer'); if (result) setResults(r => ({ ...r, [q.id]: result })); if (result?.status !== 'completed') break; }
      catch (e: any) { setResults(r => ({ ...r, [q.id]: { ...r[q.id], status: 'failed', error: e.message } })); break; }
    } batchId.current = undefined; setTesting(false);
  }
  function openHistoryMenu(event: { currentTarget: HTMLButtonElement; stopPropagation: () => void }, item: { id: string; conversationId: string; question: string }) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const sidebar = event.currentTarget.closest('.sidebar')?.getBoundingClientRect();
    const width = 220;
    const height = 220;
    const gap = 8;
    const outward = (sidebar?.right ?? rect.right) + gap;
    const left = outward + width <= window.innerWidth - 12
      ? outward
      : Math.max(12, window.innerWidth - width - 12);
    setHistoryMenu(current => current?.id === item.id ? undefined : {
      ...item,
      top: Math.min(Math.max(12, rect.top), window.innerHeight - height - 12),
      left,
    });
  }
  async function exportConversation(format: 'log' | 'chat' | 'html', sourceRunId?: string) {
    if (busy || testing || exporting) return;
    if (!sourceRunId && !turns.length) return;
    setExporting(format); setError(''); setHistoryMenu(undefined);
    const labels = { chat: '聊天记录', log: '对话日志', html: '对话网页' };
    try {
      const records = sourceRunId
        ? (await api(`/conversations/${sourceRunId}`)).turns
        : await Promise.all(turns.map(turn => turn.runId ? api(`/history/${turn.runId}`) : Promise.resolve(turn)));
      if (!records?.length) throw new Error('没有可导出的对话内容');
      const name = (records[0].question || '对话').replace(/[\x00-\x1f<>:"/\\|?*]/g, '').slice(0, 40).trim() || '对话';
      const projectInfo = { id: projectId, name: project?.name || '资料库' };
      const content = format === 'html' ? conversationHtml(records, projectInfo) : format === 'chat' ? chatMarkdown(records) : conversationLog(records, projectInfo);
      const ext = format === 'html' ? 'html' : format === 'chat' ? 'md' : 'json';
      const mime = format === 'html' ? 'text/html' : format === 'chat' ? 'text/markdown' : 'application/json';
      saveText(content, `GraphMind-${labels[format]}-${name}.${ext}`, mime);
    } catch (e: any) { setError(`导出${labels[format]}失败：${e.message}`); } finally { setExporting(undefined); }
  }
  async function upload(source: FileList | File[] | null | Promise<File[]>, importing = false) {
    if (!source || uploadLock.current || busy || testing || deleting) return;
    uploadLock.current = true; setUploading(true); setUploadProgress(0); setError(''); setUploadNotice(''); setBuildFailure('');
    const captured = source instanceof Promise ? source : Array.from(source);
    let selected: ReturnType<typeof validateUpload>;
    try { selected = validateUpload(await captured, importing); }
    catch (e: any) { setError(e.message); setUploading(false); uploadLock.current = false; return; }
    const form = new FormData(); selected.files.forEach(file => form.append(importing ? 'file' : 'files', file, file.name));
    if (!importing && project?.can_append && !uploadNew) form.append('project_id', projectId);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/projects/' + (importing ? 'import' : 'upload'));
    xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = async () => { try {
      let data; try { data = JSON.parse(xhr.responseText); } catch { throw new Error(`上传失败（HTTP ${xhr.status}），请重试。`); }
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(typeof data.detail === 'string' ? data.detail : `上传失败（HTTP ${xhr.status}）`);
      await refresh();
      if (data.id === projectId) {
        setProject(await api(`/projects/${data.id}`));
        if (data.upload_result?.added.length) { setTurns([]); setResults({}); setActivities([]); setReadingFromAnswer(false); setReading(undefined); setGraphTurn(undefined); setFullGraph(undefined); setDetail(undefined); setEvidencePanel(undefined); setGraphMode('entities'); parentRef.current = undefined; }
      } else setProjectId(data.id);
      const result = data.upload_result;
      if (result && data.id === projectId) setUploadNotice(`新增 ${result.added.length} 份，跳过 ${result.skipped.length} 份重复文件。${result.renamed.length ? '同名文件已另存：' + result.renamed.map((r: any) => r.to).join('、') + '。' : ''}${result.added.length ? '原文件已保留，请重新解析并生成图谱。' : '资料与图谱保持不变。'}`);
      if (selected.skipped) setUploadNotice(note => `${note} 已忽略 ${selected.skipped} 个不受支持或隐藏的文件。`);
      setUploadOpen(false); setBackupOpen(false); setUploadNew(false); setView(importing ? 'graph' : 'documents');
    } catch (e: any) { setError(e.message); } finally { setUploading(false); uploadLock.current = false; } };
    xhr.onerror = () => { setUploading(false); uploadLock.current = false; setError('无法读取文件或上传连接中断，请重新选择文件夹后重试。'); };
    try { xhr.send(form); } catch { setUploading(false); uploadLock.current = false; setError('无法读取所选文件，请确认文件可访问后重试。'); }
  }
  async function build() {
    if (!boot.api_configured) { setSettingsOpen(true); return; }
    if (activeRef.current || uploading || deleting || !project?.files.length) return; setBuilding(true); setBusy(true); activeRef.current = true; setActivities([]); setView('chat'); setError(''); setBuildFailure('');
    try { const data = await post(`/projects/${projectId}/build`); await listen(data.run_id); setProject(await api(`/projects/${projectId}`)); await refresh(); }
    catch (e: any) { setError(e.message); setBuildFailure(e.message); } finally { setBuilding(false); setBusy(false); activeRef.current = false; }
  }
  async function roleChange(path: string, role: string) { try { const roles = Object.fromEntries((project?.files || []).map(f => [f.path, f.path === path ? role : f.role])); setProject(await post(`/projects/${projectId}/roles`, { roles })); setReading(r => r?.path === path ? { ...r, role } : r); } catch (e: any) { setError(e.message); } }
  function openDocument(file: SourceDocument) { setReadingFromAnswer(false); setReading(file); setSourceLocation(''); setView('documents'); setEvidencePanel(undefined); if (window.innerWidth <= 800) setSidebarOpen(false); }
  function showEvidence(turn: Turn | undefined, tab: EvidencePanelState['tab'], origin?: AnswerOrigin, evidence?: Evidence) {
    setPanelRevision(value => value + 1);
    setEvidencePanel({ projectId, tab, turn, evidence, origin });
  }
  function readEvidence(evidence: Evidence, origin?: AnswerOrigin) {
    const turn = origin?.testId ? results[origin.testId] : turns.find(turn => (turn.runId || turn.id) === origin?.turnId) || graphTurn;
    showEvidence(turn, 'document', origin, evidence);
  }
  function rememberAnswerPosition(origin: AnswerOrigin): AnswerOrigin {
    const container = origin.view === 'chat' ? scrollRef.current : document.querySelector<HTMLElement>('.tests-page');
    return { ...origin, scrollTop: container?.scrollTop, follow: origin.view === 'chat' ? followScroll.current : undefined };
  }
  function openTurnGraph(turn: Turn, origin: AnswerOrigin) { showEvidence(turn, 'graph', origin); }
  function returnToAnswer(origin: AnswerOrigin = graphReturnRef.current) {
    setEvidencePanel(undefined); setView(origin.view);
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
  async function selectItem(id: string) {
    const request = ++graphSelectionRequest.current;
    const projectAtStart = projectId;
    setSelectedId(id); setDetail(undefined);
    if (!id) { setEvidencePanel(undefined); return; }
    setPanelRevision(value => value + 1);
    setEvidencePanel({ projectId, tab: 'sources', turn: queryView ? graphTurn || latest : undefined, graph: visibleGraph, relationId: id, origin: { view: 'graph' } });
    try { const value = await api(`/projects/${projectId}/evidence/${encodeURIComponent(id)}`); if (request === graphSelectionRequest.current && projectRef.current === projectAtStart) setDetail(value); }
    catch (error: any) { if (request === graphSelectionRequest.current && projectRef.current === projectAtStart) setError(error.message); }
  }
  function clearGraphSelection() { graphSelectionRequest.current++; setSelectedId(''); setDetail(undefined); setEvidencePanel(undefined); }
  async function changeGraphView(next: GraphView) {
    if (!project?.ready || next === 'query' && !graphAnswer?.graph) return;
    const request = ++graphViewRequest.current, projectAtStart = projectId;
    clearGraphSelection(); setPathIndex(-1); setGraphLoading(false);
    if (next !== 'all' || fullGraph) { setGraphMode(next); return; }
    setGraphLoading(true);
    try {
      const graph = await api(`/projects/${projectId}/graph`);
      if (request !== graphViewRequest.current || projectRef.current !== projectAtStart) return;
      setFullGraph(graph); setGraphMode('all');
    } catch (e: any) { if (request === graphViewRequest.current && projectRef.current === projectAtStart) setError(e.message); }
    finally { if (request === graphViewRequest.current) setGraphLoading(false); }
  }
  const graphAnswer = graphTurn || latest;
  const activeGraphView = graphMode === 'query' && !graphAnswer?.graph ? 'entities' : graphMode;
  const queryView = activeGraphView === 'query';
  const displayGraph: GraphData | undefined = project?.ready ? activeGraphView === 'all' ? fullGraph : queryView ? graphAnswer?.graph : activeGraphView === 'entities' ? project.entity_graph : project.graph : undefined;
  const graphPath = queryView && pathIndex >= 0 ? graphAnswer?.paths?.[pathIndex] : undefined;
  const pathNodes = new Set<string>(graphPath?.node_ids), pathEdges = new Set<string>(graphPath?.steps.map((step: { edge_id: string }) => step.edge_id));
  const visibleGraph = graphPath && displayGraph ? { ...displayGraph, nodes: displayGraph.nodes.filter(node => pathNodes.has(node.id)), edges: displayGraph.edges.filter(edge => pathEdges.has(edge.id) && pathNodes.has(edge.source) && pathNodes.has(edge.target)) } : displayGraph;
  const seen = new Set<string>(); const conversations = history.filter(h => { const key = h.conversation_id || h.id; if (h.kind !== 'query' || seen.has(key)) return false; seen.add(key); return true; });

  const colors = graphPalettes[theme];
  const navItems = [['chat', MessageSquare, '知识问答'], ['graph', Network, '知识图谱'], ['documents', FileText, '原始资料'], ['tests', FlaskConical, '十题问答']] as const;
  const composer = <Composer value={input} onChange={setInput} onSend={() => { setView('chat'); ask().catch(() => {}); }} onStop={cancel}
    running={busy} canStop={!!runId} disabled={testing || uploading || deleting} configured={!!boot?.api_configured}
    projectName={project?.name || '资料库'} files={project?.files || []}
    onUpload={() => setUploadOpen(true)} uploadDisabled={busy || testing || uploading || deleting}/>;
  return <div className={`workspace workspace-v2 drawer-closed ${sidebarOpen ? '' : 'sidebar-hidden'} ${evidencePanel ? 'evidence-open' : ''}`} style={workspaceStyle}>
    <input ref={folderRef} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={e => { upload(e.target.files); e.target.value = ''; }}/><input ref={uploadRef} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md" onChange={e => { upload(e.target.files); e.target.value = ''; }}/><input ref={importRef} type="file" hidden accept=".zip" onChange={e => { upload(e.target.files, true); e.target.value = ''; }}/>
    {sidebarOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭资料与对话侧栏" onClick={() => setSidebarOpen(false)}/>}
    <aside className="sidebar"><button type="button" className="sidebar-dismiss" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={19}/></button><div className="brand" aria-label="GraphMind"><span className="brand-symbol" aria-hidden="true"><Network size={21}/></span><span className="brand-name">GraphMind</span></div>
      <div className="sidebar-content">      <div className="sidebar-section-label">资料库</div>
      <div className="sidebar-library-actions library-cluster">
      <button type="button" className="library-switch-trigger" aria-label="切换知识库" aria-haspopup="dialog" aria-expanded={libraryOpen} disabled={busy || testing || uploading || deleting} onClick={openLibrarySwitcher}><span className="library-trigger-icon"><FolderOpen size={19}/></span><span className="library-trigger-copy"><span>当前资料库 <span className="library-trigger-hint">切换</span></span><strong title={project?.name}>{project?.name || '选择资料库'}</strong></span><ChevronsUpDown size={15}/></button>
      <button className="sidebar-upload" disabled={busy || testing || uploading || deleting} onClick={() => setUploadOpen(true)}><Upload size={16}/>上传资料</button>
      </div>
      <div className="sidebar-section-label chat-section-label">对话</div>
      <div className="sidebar-primary-actions">
      <button className="new-chat" disabled={busy || testing || uploading || deleting} onClick={newChat}><Plus size={18}/>新对话</button>
      </div><p className="sidebar-chat-note">使用当前资料库开始新的问答</p>
      <nav>{navItems.map(([id, Icon, label]) => <button key={id} disabled={id === 'tests' && !benchmarkAvailable} title={id === 'tests' && !benchmarkAvailable ? '十题问答仅适用于测试集 A' : undefined} className={view === id ? 'nav-active' : ''} onClick={() => { if (id === 'tests' && !benchmarkAvailable) return; setView(id); setEvidencePanel(undefined); if (window.innerWidth <= 800) setSidebarOpen(false); }}><Icon size={18}/>{label}</button>)}</nav>
      <div className="history-title"><MessageSquare size={15}/>最近对话<span className="history-title-meta"><span className="history-count">{conversations.length}</span>{conversations.length > 0 && <button type="button" className="history-clear-all" aria-label="删除全部对话" title="删除全部对话" disabled={busy || testing || historyDeleting} onClick={() => { setHistoryDeleteError(''); setPendingClearHistory(true); }}><Trash2 size={14}/></button>}</span></div><div className="sidebar-history">{conversations.length ? conversations.map(h => { const convKey = h.conversation_id || h.id; const selected = activeConversationRef.current === convKey; return <div className={`sidebar-history-row${selected ? ' is-selected' : ''}${historyMenu?.id === h.id ? ' is-menu-open' : ''}`} key={h.id}><button type="button" className={`history-item${selected ? ' selected' : ''}`} disabled={busy || testing} title={h.question} onClick={() => loadHistory(h.id)}><MessageSquare size={14}/><span>{h.question}</span>{h.status === 'failed' && <i className="history-error"/>}</button><button type="button" className="history-item-more" aria-label="对话操作" aria-haspopup="menu" aria-expanded={historyMenu?.id === h.id} disabled={busy || testing} onClick={event => openHistoryMenu(event, { id: h.id, conversationId: convKey, question: h.question })}><MoreHorizontal size={16}/></button></div>; }) : <p>你的对话会保存在这里</p>}</div>
      <details className="sidebar-files"><summary className="sidebar-file-heading"><FolderOpen size={15}/>已上传文件<span>{project?.files.length || 0}</span><ChevronDown size={14}/></summary><div className="file-list">{project?.files.map(f => <div className="sidebar-file-item" key={f.path}><button className="file-row" onClick={() => openDocument(f)} title={f.path}><span className={`file-icon ${f.format}`}>{fileBadge(f.format)}</span><span>{f.path.replace(/^测试集A_/, '')}</span></button>{project?.can_append && <button className="file-remove" aria-label={`删除文件 ${f.path}`} title="从当前资料库删除" disabled={busy || testing || uploading || deleting} onClick={() => requestRemoval(f)}><Trash2 size={15}/></button>}</div>)}{!project?.files.length && <p className="empty-file-note">还没有文件，上传资料开始。</p>}</div></details>
      </div><div className="sidebar-bottom"><button disabled={!turns.length || busy || testing || !!exporting} title={turns.length ? '导出当前对话的完整日志、来源和执行细节' : '开始对话后可导出日志'} onClick={() => exportConversation('log')}>{exporting === 'log' ? <Loader2 className="spin" size={17}/> : <Download size={17}/>}<span>导出对话日志</span></button><button disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={17}/>模型设置<span className={boot?.api_configured ? 'configured-dot' : 'unconfigured-dot'}/></button></div>
      <button type="button" className="sidebar-resize-handle" aria-label="拖动调整侧栏宽度" onPointerDown={onSidebarResizePointerDown} onPointerMove={onSidebarResizePointerMove} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize}/>
    </aside>
    <section className={`main ${view === 'chat' && !turns.length && !building ? 'chat-start' : ''}${view === 'graph' ? ' graph-view' : ''}`}><header className="topbar"><div><button aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button><strong>{project?.name || '正在加载资料…'}</strong></div><div className="topbar-actions"><details className="export-menu"><summary aria-label="导出对话"><Download size={16}/><span>导出</span><ChevronDown size={12}/></summary><div>
          <button disabled={!turns.length || busy || testing || !!exporting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); exportConversation('html'); }}><Share2 size={16}/><span>分享网页<small>HTML · 可离线打开</small></span></button>
          <button disabled={!turns.length || busy || testing || !!exporting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); exportConversation('chat'); }}><FileText size={16}/><span>聊天记录<small>Markdown · 问题与回答</small></span></button>
          <button disabled={!turns.length || busy || testing || !!exporting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); exportConversation('log'); }}><Download size={16}/><span>完整对话日志<small>JSON · 来源与执行细节</small></span></button>
        </div></details><div className="theme-switch" role="group" aria-label="外观模式"><button type="button" aria-label="白天模式" aria-pressed={theme === 'day'} onClick={() => setTheme('day')}><Sun size={14}/><span>白天</span></button><button type="button" aria-label="夜间模式" aria-pressed={theme === 'night'} onClick={() => setTheme('night')}><Moon size={14}/><span>夜间</span></button></div><button className={`model-pill ${boot?.api_configured ? '' : 'needs-config'}`} disabled={busy || testing} onClick={() => setSettingsOpen(true)}><Settings2 size={15}/><span>{boot?.api_configured ? boot.model : '配置模型 · 开始问答'}</span><ChevronDown size={13}/></button></div></header>
      <div className="mobile-nav">{navItems.map(([id, Icon, label]) => <button aria-label={label} disabled={id === 'tests' && !benchmarkAvailable} title={id === 'tests' && !benchmarkAvailable ? '十题问答仅适用于测试集 A' : undefined} className={view === id ? 'active' : ''} key={id} onClick={() => { if (id === 'tests' && !benchmarkAvailable) return; setEvidencePanel(undefined); setView(id); }}><Icon size={17}/>{label}</button>)}</div>
      {uploadNotice && view === 'documents' && <div className="upload-notice" role="status">{uploadNotice}<button aria-label="关闭上传提示" onClick={() => setUploadNotice('')}><X size={16}/></button></div>}
      {error && <div className="error-bar" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {view !== 'chat' && <div className="page-toolbar"><div>{view === 'graph' && graphAnswer && <button type="button" className="back-to-answer" onClick={() => returnToAnswer()}><ArrowLeft size={16}/>返回回答</button>}{view === 'documents' && readingFromAnswer && <button type="button" className="back-to-answer" onClick={() => sourceReturnView.current === 'graph' ? setView('graph') : returnToAnswer(sourceAnswerRef.current)}><ArrowLeft size={16}/>{sourceReturnView.current === 'graph' ? '返回图谱' : '返回回答'}</button>}<h1>{{ graph: '知识图谱', documents: '原始资料', tests: '十题完整问答' }[view]}</h1><p>{{ graph: '查看主体之间的关系，点击连线核对中文关系与原文。', documents: '上传、阅读和管理参与问答的文件。', tests: '使用当前模型逐题生成答案，并保留执行过程与来源。' }[view]}</p></div><div className="toolbar-actions">{view === 'graph' && <details className={`export-menu graph-export-menu${project?.ready ? '' : ' is-disabled'}`} onToggle={event => { if (!project?.ready) (event.currentTarget as HTMLDetailsElement).open = false; }}><summary className="soft-button" aria-label="导出知识图谱"><Download size={15}/><span>导出</span><ChevronDown size={12}/></summary><div>
          <button type="button" disabled={!project?.ready} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); window.location.assign(`/api/projects/${projectId}/export/html`); }}><FileText size={16}/><span>思维导图 HTML<small>可离线浏览 · 适合展示</small></span></button>
          <button type="button" disabled={!project?.ready} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); window.location.assign(`/api/projects/${projectId}/export/json`); }}><Braces size={16}/><span>知识图谱 JSON<small>完整图谱数据 · 适合评委核验</small></span></button>
        </div></details>}{view === 'documents' && <button className="primary" disabled={busy} onClick={() => setUploadOpen(true)}><Plus size={17}/>上传资料</button>}</div></div>}
      {view === 'documents' && <><div className="document-tools"><span><span className="data-number">{project?.files.length || 0}</span> 份文件 · <span className="data-number">{project?.files.filter(f => f.role === 'corpus').length || 0}</span> 份参与构图</span>{!project?.ready && <button className="primary" disabled={busy || testing || uploading || deleting || !project?.files.length} onClick={build}>{busy ? <Loader2 className="spin" size={15}/> : <Network size={15}/>}解析资料并生成图谱</button>}<details><summary>备份与恢复<ChevronDown size={13}/></summary><div><a href={`/api/projects/${projectId}/export`}>下载知识库备份 ZIP</a><button disabled={busy} onClick={() => setBackupOpen(true)}>从本系统备份恢复…</button></div></details></div>{sourceLocation && <div className="source-jump-note">来源位置：{sourceLocation}</div>}<DocumentReader location={sourceLocation} projectId={projectId} document={reading} files={project?.files || []} onSelect={openDocument} onClear={() => { setReading(undefined); setSourceLocation(''); setReadingFromAnswer(false); }} onRemove={project?.can_append ? requestRemoval : undefined} busy={busy || testing || uploading || deleting} onRole={!project?.read_only && reading ? role => roleChange(reading.path, role) : undefined}/></>}
      {<div hidden={view !== 'chat'} ref={scrollRef} tabIndex={0} aria-label="对话内容" className={`conversation ${turns.length ? 'has-turns' : ''}`} onScroll={() => { const el = scrollRef.current; if (el) followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 180; }}>
        {!turns.length && <div className="chat-welcome"><span className="welcome-icon"><Network size={27}/></span><h1>从你的资料，找到答案</h1>{!boot?.api_configured && <button className="connect-banner" onClick={() => setSettingsOpen(true)}><Settings2 size={18}/><span><strong>连接模型，开始对话</strong><small>暂未配置 API · 仍可浏览离线图谱和资料</small></span><ArrowUpRight size={17}/></button>}
          {!project?.ready && <button className="primary" disabled={busy || testing || uploading || deleting || !project?.files.length} onClick={build}><Network size={17}/>解析资料并生成图谱</button>}
          {!building && composer}
        </div>}
        {(building || buildFailure || (!turns.length && activities.length > 0)) && <div className="build-progress"><Execution events={activities} running={building} elapsed={elapsed} error={buildFailure || undefined}/>
          {buildFailure && !building && <div className="retry-actions build-retry"><button className="primary" disabled={busy || testing || uploading || deleting} onClick={build}><RotateCcw size={15}/>继续生成图谱</button><span>已完成的批次会保留，从失败处继续。</span></div>}</div>}
        {turns.map((turn, i) => <ChatTurn key={turn.id || i} sources={() => showEvidence(turn, 'sources', { view: 'chat', turnId: turn.runId || turn.id })} turn={turn} elapsed={elapsed} read={e => readEvidence(e, { view: 'chat', turnId: turn.runId || turn.id })} graph={() => openTurnGraph(turn, { view: 'chat', turnId: turn.runId || turn.id })} download={saveText} retry={() => retryTurn(turn)} retryDisabled={busy || testing || uploading || deleting}/>)}<div ref={contentEnd}/>
      </div>}
      {view === 'graph' && <div className="graph-page">
        <SourceScopeNotice project={project}/>
        <GraphControls key={`${projectId}:${activeGraphView}`} view={activeGraphView} graph={visibleGraph} ready={!!project?.ready} queryAvailable={!!graphAnswer?.graph} loading={graphLoading} onViewChange={changeGraphView} selectedId={selectedId} onSelect={selectItem} paths={graphAnswer?.paths || []} pathIndex={pathIndex} onPathChange={index => { clearGraphSelection(); setPathIndex(index); }}/>
        {detail?.relation && selectedId === detail.item.id && <div className="selected-relation" role="status"><strong>{detail.relation.source}</strong><span>— {detail.relation.label} →</span><strong>{detail.relation.target}</strong><small>{detail.evidence.length} 处原文依据 · 已突出两端与连线</small></div>}
        <div className="graph-canvas"><Graph theme={theme} key={`${projectId}:${activeGraphView}`} graph={displayGraph} select={selectItem} selectedId={selectedId} path={graphPath}/></div>
        <div className="graph-legend">{[...new Set(visibleGraph?.nodes.map(node => node.type) || [])].map(t => <span key={t}><i style={{ background: colors[t] || 'var(--fg-muted)' }}/>{typeLabels[t] || t}</span>)}<small>拖拽旋转 / 缩放 · 点击连线看中文关系与原文</small></div>
      </div>}
      
      {view === 'chat' && (turns.length > 0 || building) && composer}
      {view === 'chat' && !turns.length && <footer className="main-page-footer"><p className="composer-note">回答基于当前资料库，请结合原文核对重要信息。</p><p className="composer-copyright">© 2026 GraphMind. All rights reserved.</p></footer>}
      {view === 'tests' && <div className="tests-page"><div className="test-intro"><div><strong>测试集 A · 10 个问题</strong><p>{boot?.api_configured ? `当前模型：${boot.model}` : '请先配置模型，再运行完整问答。离线图谱可直接浏览。'}</p><small>逐题调用模型；长回答可能自动续写，按服务商计费。生成完成不代表答案评分通过。</small></div><button className="primary" disabled={busy || testing || !project?.ready || !project?.benchmark_demo} onClick={batchTest}>{testing ? <Loader2 className="spin" size={16}/> : <FlaskConical size={16}/>}运行十题完整问答</button>{testing && <button className="soft-button" onClick={cancel}>停止测试</button>}</div>{testing && <Execution events={activities} running={busy} elapsed={elapsed}/>}<div className="test-list">{boot?.questions.map((q: any) => <details className="test-result-card" id={`test-result-${q.id}`} key={q.id}><summary><span>{q.id}</span><strong>{q.title}</strong><small className={results[q.id]?.status === 'failed' ? 'red' : ''}>{{ completed: '回答已生成', running: '正在回答', failed: '失败', cancelled: '已停止' }[results[q.id]?.status] || '待运行'}</small><ChevronDown size={15}/></summary><p>{q.question}</p>{results[q.id] ? <ChatTurn sources={() => showEvidence(results[q.id], 'sources', { view: 'tests', turnId: results[q.id].runId || results[q.id].id, testId: q.id })} turn={results[q.id]} elapsed={elapsed} read={e => readEvidence(e, { view: 'tests', turnId: results[q.id].runId || results[q.id].id, testId: q.id })} graph={() => openTurnGraph(results[q.id], { view: 'tests', turnId: results[q.id].runId || results[q.id].id, testId: q.id })} download={saveText} retry={() => retryTurn(results[q.id])} retryDisabled={busy || testing || uploading || deleting}/> : <button disabled={busy || testing} className="soft-button" onClick={() => { setView('chat'); setInput(q.question); }}>在对话中提问<ArrowUpRight size={14}/></button>}</details>)}</div>{Object.values(results).some(t => t.answer) && <div className="test-export-actions"><button type="button" className="soft-button" onClick={() => saveText(Object.entries(results).map(([id, t]) => `# ${id} ${t.question}\n\n模型：${t.model || boot.model}\n状态：${t.status}\n\n${t.answer || t.error || ''}`).join('\n\n---\n\n'), '测试集A-完整问答.md')}><Download size={15}/>导出本轮答案</button></div>}</div>}
    </section>
    {evidencePanel && evidencePanel.projectId === projectId && <EvidencePanel key={`${projectId}:${panelRevision}`} state={evidencePanel} theme={theme}
      files={project?.files || []} ready={!!project?.ready} entityGraph={project?.entity_graph} architectureGraph={project?.graph}
      onClose={() => setEvidencePanel(undefined)} onManage={(file, location) => { setEvidencePanel(undefined); setView('documents'); setReading(file); setSourceLocation(location || ''); setReadingFromAnswer(false); }}/>}
    {libraryOpen && <LibrarySwitcher libraries={boot?.projects || []} currentId={projectId} onClose={() => setLibraryOpen(false)} onSelect={id => { if (id !== projectId) { setProjectId(id); setView('chat'); } setLibraryOpen(false); setError(''); if (window.innerWidth <= 800) setSidebarOpen(false); }} onCreate={() => { setLibraryOpen(false); setUploadNew(true); setUploadOpen(true); }}/>}
    {settingsOpen && <ApiSettings close={closeSettings} refresh={refresh} onboarding={onboarding} locked={busy || testing}/>}
    {(uploadOpen || backupOpen) && <Modal title={backupOpen ? '恢复知识库备份' : '上传你的资料'} className="upload-modal" disabled={uploading} onClose={() => { setUploadOpen(false); setBackupOpen(false); }}>
      <p>{backupOpen ? '选择本系统导出的知识库备份 ZIP，恢复图谱和解析正文。' : '选择资料的归属，再上传文件。你可以补充现有资料，也可以用全新的文件开始。'}</p>
      {!backupOpen && <UploadDestination canAppend={!!project?.can_append} currentName={project?.name || '当前资料库'} createNew={uploadNew} disabled={uploading} onChange={setUploadNew}/>}
      <button className="upload-dropzone" disabled={uploading} onClick={() => (backupOpen ? importRef : uploadRef).current?.click()} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = uploading ? 'none' : 'copy'; }} onDrop={e => { e.preventDefault(); if (!uploadLock.current) upload(backupOpen ? Array.from(e.dataTransfer.files) : droppedFiles(e.dataTransfer), backupOpen); }}>
        <Upload size={30}/><strong>{uploading ? `正在读取并上传 ${uploadProgress}%` : backupOpen ? '选择备份 ZIP' : '选择文件，或拖入文件 / 文件夹'}</strong><span>{backupOpen ? '仅支持本系统导出的知识库备份' : 'PDF · DOCX · XLSX · PPTX · 图片 · 文本'}</span>{uploading && <progress value={uploadProgress} max={100}/>}
      </button>
      {!backupOpen && <><button className="soft-button full" disabled={uploading} onClick={() => folderRef.current?.click()}><FolderOpen size={16}/>选择文件夹</button><p className="upload-mode-note" role="status">{project?.can_append && !uploadNew ? '相同文件会跳过；同名但内容不同的文件另存。上传后需要重新生成图谱。' : '本次文件将创建独立资料库，你可以随时切回原资料库。'}</p></>}
      {error && <p className="api-error" role="alert">{error}</p>}
    </Modal>}
    {historyMenu && createPortal(<div className="history-item-menu-panel" role="menu" style={{ top: historyMenu.top, left: historyMenu.left }}>
      <button type="button" disabled={!!exporting} onClick={() => exportConversation('html', historyMenu.id)}><Share2 size={15}/>分享网页</button>
      <button type="button" disabled={!!exporting} onClick={() => exportConversation('chat', historyMenu.id)}><FileText size={15}/>导出聊天记录</button>
      <button type="button" disabled={!!exporting} onClick={() => exportConversation('log', historyMenu.id)}><Download size={15}/>导出完整日志</button>
      <hr/>
      <button type="button" className="history-menu-delete" disabled={busy || testing || historyDeleting} onClick={() => { setHistoryMenu(undefined); setHistoryDeleteError(''); setPendingDeleteConversation({ runId: historyMenu.id, conversationId: historyMenu.conversationId, question: historyMenu.question }); }}><Trash2 size={15}/>删除对话</button>
    </div>, document.body)}
    {pendingDeleteConversation && <Modal title="删除这条对话？" className="remove-modal" disabled={historyDeleting} onClose={() => !historyDeleting && setPendingDeleteConversation(undefined)}>
      <div className="removal-file"><MessageSquare size={24}/><strong>{pendingDeleteConversation.question}</strong></div>
      <p>将永久删除这条对话的全部轮次，包括服务器上的本地记录。此操作无法撤销。</p>
      {historyDeleteError && <p className="api-error" role="alert">{historyDeleteError}</p>}
      <div className="modal-actions"><button className="soft-button" disabled={historyDeleting} onClick={() => setPendingDeleteConversation(undefined)}>保留对话</button><button className="danger-button" disabled={historyDeleting} onClick={deleteConversation}>{historyDeleting ? <Loader2 size={16} className="spin"/> : <Trash2 size={16}/>} {historyDeleting ? '正在删除…' : '删除对话'}</button></div>
    </Modal>}
    {pendingClearHistory && <Modal title="清空全部对话？" className="remove-modal" disabled={historyDeleting} onClose={() => !historyDeleting && setPendingClearHistory(false)}>
      <p>将永久删除当前资料库下的全部问答对话记录（含本地保存的 JSON），当前聊天窗口也会被清空。此操作无法撤销。</p>
      {historyDeleteError && <p className="api-error" role="alert">{historyDeleteError}</p>}
      <div className="modal-actions"><button className="soft-button" disabled={historyDeleting} onClick={() => setPendingClearHistory(false)}>取消</button><button className="danger-button" disabled={historyDeleting} onClick={clearAllHistory}>{historyDeleting ? <Loader2 size={16} className="spin"/> : <Trash2 size={16}/>} {historyDeleting ? '正在清空…' : '清空全部'}</button></div>
    </Modal>}
    {pendingRemoval && <Modal title="删除这份资料？" className="remove-modal" disabled={deleting} onClose={() => setPendingRemoval(undefined)}>
      <div className="removal-file"><FileText size={24}/><strong>{pendingRemoval.path}</strong></div>
      <p>将从当前资料库移除这份文件。删除后需要重新生成图谱，其他文件和资料库会保留。</p>
      {removalError && <p className="api-error" role="alert">{removalError}</p>}
      <div className="modal-actions"><button className="soft-button" disabled={deleting} onClick={() => setPendingRemoval(undefined)}>保留文件</button><button className="danger-button" disabled={deleting} onClick={removeFile}>{deleting ? <Loader2 size={16} className="spin"/> : <Trash2 size={16}/>} {deleting ? '正在删除…' : '删除文件'}</button></div>
    </Modal>}
  </div>;
}
