import { useEffect, useState } from 'react';
import { Check, Loader2, X, Cable, Settings2, Image } from 'lucide-react';
type Configuration = { base: string; model: string; effort: string; max_tokens: number; auto_continue: number; api_configured: boolean; key_hint: string };
async function request(path: string, body?: unknown) {
  const response = await fetch('/api/settings' + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.detail || '设置操作失败'); return data;
}
export default function ApiSettings({ close, refresh, onboarding = false, locked = false }: { close: () => void; refresh: () => Promise<unknown>; onboarding?: boolean; locked?: boolean }) {
  const [config, setConfig] = useState<Configuration>(); const [key, setKey] = useState(''); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; request('').then(c => { if (active) setConfig(c); }).catch(e => setError(e.message)); return () => { active = false; }; }, []);
  const dismiss = () => { if (!saving) close(); };
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) close(); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [saving, close]);
  async function save(test = false, clear = false) {
    if (!config || locked) return; setSaving(true); setError(''); setMessage(test ? '正在保存配置并测试文本连接…' : '正在保存…');
    try {
      const result = await request('', { base: config.base, model: config.model, effort: config.effort, max_tokens: config.max_tokens, auto_continue: config.auto_continue, key, clear_key: clear });
      setConfig(result); setKey(''); await refresh();
      if (test) { const verified = await request('/test', {}); setMessage(verified.message); }
      else setMessage(clear ? '密钥已清除，可继续浏览图谱和资料。' : `已保存 ${result.model}，下一次问答直接使用此模型。`);
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onClick={dismiss}><div className="settings-modal api-settings" role="dialog" aria-modal="true" aria-label="模型与 API 设置" onClick={e => e.stopPropagation()}>
    <button className="modal-close" aria-label="关闭设置" disabled={saving} onClick={dismiss}><X size={20}/></button><div className="modal-icon"><Settings2 size={24}/></div><span className="dialog-kicker">{onboarding ? '开始使用 · 第一步' : '模型设置'}</span><h2>{onboarding ? '先连接你的 AI 模型' : '选择本次使用的模型'}</h2><p>配置后即可直接提问、连续追问，以及运行十题完整问答。没有密钥时，可以先浏览本地资料和知识图谱。</p>
    <div className="api-vision-note" role="note"><Image size={20} aria-hidden="true"/><div><strong>含图片资料构图，请选择支持图片输入的多模态模型</strong><p>处理架构图、扫描件或资料中的图片时，模型与 API 服务商的实际路由都需要支持图片输入（Vision / Image input）。纯文本模型可用于已有知识库的文字问答。</p><p>部分服务商在没有可用视觉路由时可能返回 404；API 地址或模型 ID 错误也可能导致 404。请核对服务商的能力说明。</p></div></div>
    {locked && <p className="api-error">当前任务仍在执行，请完成或停止后切换模型。</p>}
    {config && <form onSubmit={e => { e.preventDefault(); save(true); }}><fieldset disabled={saving || locked}>
      <label>API 地址<input autoFocus aria-label="API Base URL" required type="url" value={config.base} onChange={e => { setConfig({ ...config, base: e.target.value }); setMessage(''); }}/><small>OpenAI 兼容接口的 Base URL，例如 https://openrouter.ai/api/v1。含图片构图时，还需确认该接口允许图片输入并有可用视觉路由。</small></label>
      <label>模型名称<input aria-label="模型 ID" required value={config.model} placeholder="填写服务商提供的模型 ID" onChange={e => { setConfig({ ...config, model: e.target.value }); setMessage(''); }}/><small>含图片构图请选择标注支持 Vision / Image input 的模型；支持生成图片不等于支持读取图片。</small></label>
      <label>API 密钥 <span>{config.key_hint}</span><input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => { setKey(e.target.value); setMessage(''); }} placeholder={config.api_configured ? '留空沿用当前密钥' : '粘贴你的 API Key'}/></label>
      <details className="advanced-config"><summary>高级参数 · 长回答设置</summary><label>每次最大输出 tokens<input aria-label="最大输出 tokens" type="number" required min={1024} max={65536} step={1} value={config.max_tokens} onChange={e => setConfig({ ...config, max_tokens: Number(e.target.value) })}/><small>默认 16,384，需在服务商支持的范围内；推理模型可能共享思考与正文预算。</small></label><label>遇到长度限制时自动续写<select aria-label="自动续写次数" value={config.auto_continue} onChange={e => setConfig({ ...config, auto_continue: Number(e.target.value) })}><option value={0}>关闭，保留正文并提示截断</option><option value={1}>最多 1 次</option><option value={2}>最多 2 次（默认）</option><option value={3}>最多 3 次</option></select><small>续写沿用当前资料，增加的调用按服务商计费。仍未完成时会明确提示。</small></label><label>推理强度<select aria-label="推理参数" value={config.effort} onChange={e => setConfig({ ...config, effort: e.target.value })}><option value="">通用兼容</option><option value="low">OpenRouter · low</option><option value="medium">OpenRouter · medium</option><option value="high">OpenRouter · high</option></select></label></details>
      <div className="api-actions"><button className="primary" type="submit" disabled={!config.api_configured && !key}>{saving ? <Loader2 className="spin" size={16}/> : <Cable size={16}/>}保存并测试文本连接</button><button type="button" className="soft-button" onClick={() => save()}><Check size={16}/>仅保存</button></div>
      {config.api_configured && <button type="button" className="text-link clear-key" onClick={() => save(false, true)}>清除本机密钥</button>}
    </fieldset></form>}
    {message && <p className="api-success" role="status">{message}</p>}{error && <p className="api-error" role="alert">{error}</p>}
    <p className="api-security-note">密钥仅在本机加密保存。此处只测试文本连接，不发送图片；测试通过不代表已验证视觉能力。</p><button className="soft-button full" disabled={saving} onClick={dismiss}>{config?.api_configured ? '返回对话' : '暂不配置，浏览离线资料'}</button>
  </div></div>;
}
