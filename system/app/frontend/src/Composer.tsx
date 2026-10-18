import { useLayoutEffect, useRef } from 'react';
import { ArrowUp, FolderOpen, Plus, Square } from 'lucide-react';

type Props = {
  value: string; onChange: (value: string) => void; onSend: () => void; onStop: () => void;
  running: boolean; canStop: boolean; disabled: boolean; configured: boolean;
  projectName: string; onLibrary: () => void; onUpload: () => void; uploadDisabled: boolean;
};

export default function Composer(props: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(200, Math.max(62, field.scrollHeight))}px`;
  }, [props.value]);
  return <div className="composer-wrap">
    <div className={`composer ${props.running ? 'running' : ''}`}>
      <textarea ref={textarea} aria-label="输入问题" placeholder={props.configured ? '想从资料中了解什么？' : '输入问题，连接模型后开始对话…'}
        value={props.value} disabled={props.running || props.disabled} onChange={e => props.onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); props.onSend(); } }}/>
      <div className="composer-bottom">
        <div className="composer-context">
          <button className="composer-attach" aria-label="上传资料" title="上传文件或文件夹" disabled={props.uploadDisabled} onClick={props.onUpload}><Plus size={20}/></button>
          <button className="composer-project" onClick={props.onLibrary} title={props.projectName}><FolderOpen size={15}/><span>{props.projectName}</span></button>
        </div>
        <div className="composer-submit">{!props.running && <span>Shift + Enter 换行</span>}
          {props.running ? <button className="send" aria-label="停止生成" disabled={!props.canStop} onClick={props.onStop}><Square size={16}/></button>
            : <button className="send" aria-label="发送问题" disabled={!props.value.trim() || props.disabled} onClick={props.onSend}><ArrowUp size={20}/></button>}
        </div>
      </div>
    </div>
    <p className="composer-note">回答基于当前资料库，请结合原文核对重要信息。</p>
  </div>;
}
