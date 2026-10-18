import { useId } from 'react';
import { FolderPlus, Layers } from 'lucide-react';

export default function UploadDestination({ canAppend, currentName, createNew, disabled, onChange }: { canAppend: boolean; currentName: string; createNew: boolean; disabled: boolean; onChange: (createNew: boolean) => void }) {
  const group = useId();
  return <fieldset className="upload-destinations" disabled={disabled}>
    <legend>选择上传方式</legend>
    <label className={`upload-choice ${canAppend && !createNew ? 'selected' : ''} ${!canAppend ? 'unavailable' : ''}`}>
      <input type="radio" name={group} value="current" checked={canAppend && !createNew} disabled={!canAppend} onChange={() => onChange(false)}/>
      <Layers size={21}/><div><strong>追加到当前资料库</strong><span>{canAppend ? currentName : '当前资料库只读，请选择新建'}</span><small>保留已有文件，加入本次资料。</small></div>
    </label>
    <label className={`upload-choice ${createNew || !canAppend ? 'selected' : ''}`}>
      <input type="radio" name={group} value="new" checked={createNew || !canAppend} onChange={() => onChange(true)}/>
      <FolderPlus size={21}/><div><strong>新建独立资料库</strong><span>用一组全新的文件开始</span><small>本次文件单独收录，原资料库保留。</small></div>
    </label>
  </fieldset>;
}
