import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
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
  return <button type="button" className={`copy-button ${className}`} disabled={!text} onClick={copy} aria-label={label} title={label}>
    {status === 'copied' ? <Check size={14}/> : <Copy size={14}/>}
    <span aria-live="polite">{status === 'copied' ? '已复制' : status === 'failed' ? '复制失败，点击重试' : label}</span>
  </button>;
}
