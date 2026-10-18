import { useEffect, useState } from 'react';
import { Check, Loader2, Cable, Settings2, Image, ChevronDown } from 'lucide-react';
import Modal from './Modal';
type Configuration = { base: string; model: string; effort: string; max_tokens: number; auto_continue: number; api_configured: boolean; key_hint: string };
async function request(path: string, body?: unknown) {
  const response = await fetch('/api/settings' + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.detail || '设置操作失败'); return data;
}
export default function ApiSettings({ close, refresh, onboarding = false, locked = false }: { close: () => void; refresh: () => Promise<unknown>; onboarding?: boolean; locked?: boolean }) {
  const [config, setConfig] = useState<Configuration>(); const [key, setKey] = useState(''); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; request('').then(c => { if (active) setConfig(c); }).catch(e => setError(e.message)); return () => { active = false; }; }, []);
  const dismiss = () => { if (!saving) close(); };
  async function save(test = false, clear = false) {
    if (!config || locked) return; setSaving(true); setError(''); setMessage(test ? '正在保存配置并测试文本连接…' : '正在保存…');
    try {
      const result = await request('', { base: config.base, model: config.model, effort: config.effort, max_tokens: config.max_tokens, auto_continue: config.auto_continue, key, clear_key: clear });
      setConfig(result); setKey(''); await refresh();
      if (test) { await request('/test', {}); setMessage('连接测试成功'); }
      else setMessage(clear ? '密钥已清除，可继续浏览图谱和资料。' : `已保存 ${result.model}，下一次问答直接使用此模型。`);
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  return <Modal className="api-settings" title={onboarding ? '先连接你的 AI 模型' : '选择本次使用的模型'} disabled={saving} onClose={dismiss} headingLead={<div className="settings-heading-lead"><span className="modal-icon"><Settings2 size={21}/></span><span className="dialog-kicker">{onboarding ? '开始使用 · 第一步' : '模型设置'}</span></div>}>
    <p className="settings-intro">连接模型，开始提问与连续追问。暂不配置时，也可浏览本地资料和知识图谱。</p>
    {locked && <p className="api-error">当前任务仍在执行，请完成或停止后切换模型。</p>}
    {config && <form onSubmit={e => { e.preventDefault(); save(true); }}><fieldset disabled={saving || locked}>
      <label>API 地址<input aria-label="API Base URL" required type="url" autoComplete="url" spellCheck={false} value={config.base} onChange={e => { setConfig({ ...config, base: e.target.value }); setMessage(''); }}/><small>填写 OpenAI 兼容接口的 Base URL，如 https://openrouter.ai/api/v1。</small></label>
      <label>模型名称<input aria-label="模型 ID" required spellCheck={false} value={config.model} placeholder="填写服务商提供的模型 ID" onChange={e => { setConfig({ ...config, model: e.target.value }); setMessage(''); }}/><small>使用服务商提供的准确模型 ID。</small></label>
      <label>API 密钥 <span className="key-hint">{config.key_hint}</span><input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => { setKey(e.target.value); setMessage(''); }} placeholder={config.api_configured ? '留空沿用当前密钥' : '粘贴你的 API Key'}/></label>
      <details className="settings-vision"><summary><Image size={18} aria-hidden="true"/><span>含图片的资料，请使用多模态模型</span><ChevronDown size={15}/></summary><div><p>架构图、扫描件和资料图片需要模型与 API 路由均支持图片输入（Vision / Image input）。纯文本模型可用于已有资料库的文字问答。</p><p>支持生成图片不等于支持读取图片。服务商返回 404 时，请核对 API 地址、模型 ID 与视觉路由。</p></div></details>
      <div className="settings-generation"><label>最大输出 tokens<input aria-label="最大输出 tokens" type="number" required min={1024} max={65536} step={1} value={config.max_tokens} onChange={e => setConfig({ ...config, max_tokens: Number(e.target.value) })}/></label><label>思考强度<select aria-label="思考强度" value={config.effort} onChange={e => setConfig({ ...config, effort: e.target.value })}><option value="">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div>
      <div className="api-actions"><button className="primary" type="submit" disabled={!config.api_configured && !key}>{saving ? <Loader2 className="spin" size={16}/> : <Cable size={16}/>}保存并测试连接</button><button type="button" className="soft-button" onClick={e => { if (e.currentTarget.form?.reportValidity()) save(); }}><Check size={16}/>仅保存</button></div>
      {config.api_configured && <button type="button" className="text-link clear-key" onClick={() => save(false, true)}>清除本机密钥</button>}
    </fieldset></form>}
    {message && <p className="api-success" role="status">{message}</p>}{error && <p className="api-error" role="alert">{error}</p>}
    <button className="settings-return" disabled={saving} onClick={dismiss}>{config?.api_configured ? '返回对话' : '暂不配置，浏览离线资料'}</button>
  </Modal>;
}
