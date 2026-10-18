import { useEffect, useState } from 'react';
import { Check, Loader2, Cable, Image, ChevronDown } from 'lucide-react';
import Modal from './Modal';
type BuiltinProvider = { id: string; label: string; models: string[]; configured: boolean };
type Configuration = { base: string; model: string; effort: string; max_tokens: number; auto_continue: number; api_configured: boolean; key_hint: string;
  mode: 'custom' | 'builtin'; builtin_provider: string; builtin_providers: BuiltinProvider[];
  custom: { base: string; model: string; api_configured: boolean; key_hint: string } };
async function request(path: string, body?: unknown) {
  const response = await fetch('/api/settings' + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.detail || '设置操作失败'); return data;
}
export default function ApiSettings({ close, refresh, locked = false }: { close: () => void; refresh: () => Promise<unknown>; onboarding?: boolean; locked?: boolean }) {
  const [config, setConfig] = useState<Configuration>(); const [key, setKey] = useState(''); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; request('').then(c => { if (active) setConfig(c); }).catch(e => setError(e.message)); return () => { active = false; }; }, []);
  const builtin = config?.mode === 'builtin';
  const provider = config?.builtin_providers.find(p => p.id === config.builtin_provider);
  const canConnect = builtin ? !!provider?.configured : !!(config?.custom.api_configured || key.trim());
  function changeMode(enabled: boolean) {
    if (!config) return;
    const first = config.builtin_providers[0];
    setConfig(enabled ? { ...config, mode: 'builtin', builtin_provider: first.id, model: first.models[0] }
      : { ...config, ...config.custom, mode: 'custom' });
    setMessage(''); setError('');
  }
  const dismiss = () => { if (!saving) close(); };
  async function save(test = false, clear = false) {
    if (!config || locked) return; setSaving(true); setError(''); setMessage(test ? '正在保存配置并测试文本连接…' : '正在保存…');
    try {
      const result = await request('', { mode: config.mode, builtin_provider: config.builtin_provider, base: config.base, model: config.model, effort: config.effort, max_tokens: config.max_tokens, auto_continue: config.auto_continue, key: builtin ? '' : key, clear_key: clear });
      setConfig(result); setKey(''); await refresh();
      if (test) { await request('/test', {}); setMessage('连接测试成功'); }
      else setMessage(clear ? '密钥已清除，可继续浏览图谱和资料。' : `已保存 ${result.model}，下一次问答直接使用此模型。`);
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  return <Modal className="api-settings" title="模型设置" disabled={saving} onClose={dismiss}>
    <p className="settings-intro">连接模型，开始提问与连续追问。暂不配置时，也可浏览本地资料和知识图谱。</p>
    {locked && <p className="api-error">当前任务仍在执行，请完成或停止后切换模型。</p>}
    {config && <form onSubmit={e => { e.preventDefault(); save(true); }}><fieldset disabled={saving || locked}>
      <div className="builtin-api-mode"><button type="button" className="builtin-api-toggle" role="switch" aria-checked={builtin} aria-controls="model-connection-fields" onClick={() => changeMode(!builtin)}><span>使用内置API密钥进行测试</span><span className="builtin-api-switch" aria-hidden="true"/></button></div>
      <div id="model-connection-fields">
      {builtin ? <>
        <label>服务商<select aria-label="内置服务商" value={config.builtin_provider} onChange={e => { const next = config.builtin_providers.find(p => p.id === e.target.value)!; setConfig({ ...config, builtin_provider: next.id, model: next.models[0] }); setMessage(''); setError(''); }}>{config.builtin_providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>测试模型<select aria-label="内置测试模型" value={config.model} onChange={e => { setConfig({ ...config, model: e.target.value }); setMessage(''); }}>{provider?.models.map((model, index) => <option key={model} value={model}>{model}{index === 0 ? '（默认）' : ''}</option>)}</select></label>
        <p className="builtin-api-status" role="status">{provider?.configured ? '内置密钥已就绪' : `${provider?.label || ''} 内置密钥尚未配置`}</p>
      </> : <>
      <label>API 地址<input aria-label="API Base URL" required type="url" autoComplete="url" spellCheck={false} value={config.base} onChange={e => { setConfig({ ...config, base: e.target.value, custom: { ...config.custom, base: e.target.value } }); setMessage(''); }}/><small>填写 OpenAI 兼容接口的 Base URL，如 https://openrouter.ai/api/v1。</small></label>
      <label>模型名称<input aria-label="模型 ID" required spellCheck={false} value={config.model} placeholder="填写服务商提供的模型 ID" onChange={e => { setConfig({ ...config, model: e.target.value, custom: { ...config.custom, model: e.target.value } }); setMessage(''); }}/><small>使用服务商提供的准确模型 ID。</small></label>
      <label>API 密钥 <span className="key-hint">{config.key_hint}</span><input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => { setKey(e.target.value); setMessage(''); }} placeholder={config.api_configured ? '留空沿用当前密钥' : '粘贴你的 API Key'}/></label>
      </>}
      </div>
      <details className="settings-vision"><summary><Image size={18} aria-hidden="true"/><span>含图片的资料，请使用多模态模型</span><ChevronDown size={15}/></summary><div><p>架构图、扫描件和资料图片需要模型与 API 路由均支持图片输入（Vision / Image input）。纯文本模型可用于已有资料库的文字问答。</p><p>支持生成图片不等于支持读取图片。服务商返回 404 时，请核对 API 地址、模型 ID 与视觉路由。</p></div></details>
      <div className="settings-generation"><label>最大输出 tokens<input aria-label="最大输出 tokens" type="number" required min={1024} max={65536} step={1} value={config.max_tokens} onChange={e => setConfig({ ...config, max_tokens: Number(e.target.value) })}/></label><label>思考强度<select aria-label="思考强度" value={config.effort} onChange={e => setConfig({ ...config, effort: e.target.value })}><option value="">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div>
      <div className="api-actions"><button className="primary" type="submit" disabled={!canConnect}>{saving ? <Loader2 className="spin" size={16}/> : <Cable size={16}/>}保存并测试连接</button><button type="button" className="soft-button" disabled={builtin && !canConnect} onClick={e => { if (e.currentTarget.form?.reportValidity()) save(); }}><Check size={16}/>仅保存</button></div>
      {!builtin && config.custom.api_configured && <button type="button" className="text-link clear-key" onClick={() => save(false, true)}>清除本机密钥</button>}
    </fieldset></form>}
    {message && <p className="api-success" role="status">{message}</p>}{error && <p className="api-error" role="alert">{error}</p>}
    <button className="settings-return" disabled={saving} onClick={dismiss}>{config?.api_configured ? '返回对话' : '暂不配置，浏览离线资料'}</button>
  </Modal>;
}
