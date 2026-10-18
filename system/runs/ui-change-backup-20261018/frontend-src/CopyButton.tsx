import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({ text, label, className = '', iconOnly = false }: { text: string; label: string; className?: string; iconOnly?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { setStatus('idle'); }, [text]);
  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2400);
    return () => clearTimeout(timer);
  }, [status]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch { setStatus('failed'); }
  }
  const feedback = status === 'copied' ? '已复制' : status === 'failed' ? '复制失败，点击重试' : label;
  return <button type="button" className={`copy-button ${iconOnly ? 'icon-copy' : ''} ${className}`} data-status={status} disabled={!text} onClick={copy} aria-label={label} title={iconOnly ? undefined : label}>
    {status === 'copied' ? <Check size={14}/> : <Copy size={14}/>}
    {iconOnly ? <span className="copy-tooltip" aria-hidden="true">{feedback}</span> : <span className="copy-label">{feedback}</span>}
    <span className="visually-hidden" role="status">{status === 'idle' ? '' : feedback}</span>
  </button>;
}
