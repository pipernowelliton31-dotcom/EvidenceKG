import { CheckCircle2, Loader2, ChevronDown, FileText, ArrowUpRight, Copy, Download, AlertCircle, Wrench, Square } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export type Evidence = { id: string; source: string; location?: string; excerpt: string; source_url?: string };
export type Activity = { type: string; message?: string; elapsed_s: number; [key: string]: any };
export type Turn = { id?: string; question: string; answer: string; mode: string; model?: string; stats?: any; graph?: any; evidence?: Evidence[]; paths?: any[]; context?: string; status: string; events: Activity[]; error?: string };
const stageNames: Record<string, string> = { validate: '核验资料', retrieve: '查找依据', plan: '分析问题', records: '查阅记录', entities: '匹配主体', paths: '检查关联', sources: '整理来源', answer: '生成回答' };
export function Execution({ events, running, elapsed, error, status, mode }: { events: Activity[]; running: boolean; elapsed: number; error?: string; status?: string; mode?: string }) {
  const visible = events.filter(e => ['stage.started', 'stage.completed', 'tool.completed', 'retrieval.completed', 'stage.progress', 'format.warning', 'run.error', 'cancel.requested'].includes(e.type));
  const last = visible.at(-1);
  const operations = visible.filter(e => e.type === 'tool.completed' || e.type === 'stage.completed');
  return <details className="execution-card" open={running ? true : undefined}>
    <summary><span className={`execution-icon ${error ? 'error' : ''}`}>{running ? <Loader2 className="spin" size={17}/> : error ? <AlertCircle size={17}/> : status === 'cancelled' ? <Square size={15}/> : <CheckCircle2 size={17}/>}</span><strong aria-live="polite">{running ? last?.message || '已收到问题，正在准备资料…' : error ? '本次回答未完成' : status === 'cancelled' ? '已停止生成' : mode === 'retrieve' ? '历史检索记录 · 未生成模型回答' : '已完成本轮检索与回答'}</strong><small>{elapsed.toFixed(1)} 秒</small><ChevronDown size={14}/></summary>
    <div className="execution-body"><div className="execution-caption"><Wrench size={14}/>执行过程 · {operations.length} 个步骤已完成</div>
      {visible.map((e, i) => <details className="execution-step" key={i}><summary><span className={`step-dot ${e.type === 'stage.started' && i === visible.length - 1 && running ? 'active' : ''}`}/><span><em>{stageNames[e.stage] || '执行记录'}</em>{e.message}</span><small>{e.elapsed_s.toFixed(1)}s</small><ChevronDown size={12}/></summary><div className="step-detail">{e.details?.entities && <p>匹配主体：{e.details.entities.join('、') || '无'}</p>}{e.details?.sources && <p>读取资料：{e.details.sources.join('、') || '无'}</p>}{e.stats && <p>事实 {e.stats.facts} 条 · 路径 {e.stats.paths} 条 · 原文 {e.stats.raw_units} 段</p>}<pre>{JSON.stringify(e.details || { stage: e.stage, plan: e.plan, model: e.model, message: e.message }, null, 2)}</pre></div></details>)}
      {running && last?.stage === 'answer' && last?.type === 'stage.started' && <p className="provider-wait">正在等待模型服务返回内容；收到正文后会逐字显示。</p>}{error && <p className="api-error">{error}</p>}
    </div>
  </details>;
}
export function Sources({ evidence, read }: { evidence: Evidence[]; read: (e: Evidence) => void }) {
  if (!evidence.length) return null;
  return <details className="answer-sources"><summary><FileText size={16}/><strong>查看来源与原文</strong><span>{new Set(evidence.map(e => e.source)).size} 份资料 · {evidence.length} 处依据</span><ChevronDown size={15}/></summary><div className="answer-source-list">{evidence.map((e, i) => <details className="inline-source" key={`${e.id}-${i}`}><summary><b>{String(i + 1).padStart(2, '0')}</b><span>{e.source.replace(/^测试集A_/, '')}<small>{e.location || '原文位置'}</small></span><ChevronDown size={14}/></summary><div className="inline-excerpt"><pre>{e.excerpt || '请打开原文核对该位置。'}</pre><button onClick={() => read(e)}><FileText size={14}/>在页面阅读原文</button>{e.source_url && <a href={e.source_url + (/\.pdf$/i.test(e.source) && /(?:^|;\s*)page=(\d+)/.test(e.location || '') ? '#page=' + /(?:^|;\s*)page=(\d+)/.exec(e.location || '')![1] : '')} target="_blank" rel="noreferrer">打开原始文件<ArrowUpRight size={13}/></a>}{e.source_url && /\.(png|jpg|jpeg|webp)$/i.test(e.source) && <img src={e.source_url} alt={e.source}/>}</div></details>)}</div></details>;
}
export default function ChatTurn({ turn, elapsed, read, graph, download }: { turn: Turn; elapsed: number; read: (e: Evidence) => void; graph: () => void; download: (text: string, name: string) => void }) {
  const [copied, setCopied] = useState(false);
  return <article className="turn"><div className="user-message"><p>{turn.question}</p></div><div className="assistant-heading"><span className="assistant-mark">知</span><strong>资料助手</strong><span title={turn.model}>{turn.model || (turn.mode === 'retrieve' ? '历史离线检索' : '')}</span></div>
    <Execution events={turn.events} running={turn.status === 'running'} elapsed={turn.status === 'running' ? elapsed : turn.events.at(-1)?.elapsed_s || 0} error={turn.error || (turn.status === 'failed' ? '任务未完成，可重新发送问题。' : undefined)} status={turn.status} mode={turn.mode}/>
    {turn.answer && <div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{turn.answer}</Markdown></div>}
    {turn.status === 'running' && turn.answer && <span className="stream-caret" aria-label="正在生成"/>}
    {turn.status !== 'running' && (turn.answer.trim() || turn.mode === 'retrieve') && <Sources evidence={turn.evidence || []} read={read}/>}
    {(turn.status === 'completed' || turn.answer) && <div className="answer-actions"><button onClick={async () => { await navigator.clipboard.writeText(turn.answer); setCopied(true); }}><Copy size={14}/>{copied ? '已复制' : '复制回答'}</button><button onClick={() => download(`# ${turn.question}\n\n${turn.answer}\n\n## 来源\n${turn.evidence?.map(e => `- ${e.source} · ${e.location || ''}`).join('\n') || ''}`, '问答记录.md')}><Download size={14}/>导出回答</button>{!!turn.paths?.length && <button onClick={graph}>查看关联图谱<ArrowUpRight size={14}/></button>}</div>}
  </article>;
}
