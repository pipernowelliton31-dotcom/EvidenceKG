import { useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, FolderOpen, Plus, Search, X } from 'lucide-react';
import Modal from './Modal';

type Library = { id: string; name: string; ready: boolean; read_only: boolean; files: unknown[] };

export default function LibrarySwitcher({ libraries, currentId, onSelect, onCreate, onClose }: { libraries: Library[]; currentId: string; onSelect: (id: string) => void; onCreate: () => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const matching = libraries.filter(library => library.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ordered = [...matching].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
  return <Modal title="选择你的资料库" className="library-modal" onClose={onClose} initialFocusSelector="input">
    <p>每个资料库拥有独立的文件、图谱与对话。选择一个，继续你的探索。</p>
    <div className="library-search"><Search size={18}/><input type="search" aria-label="搜索资料库" placeholder="搜索资料库名称" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={16}/></button>}</div>
    <div className="library-list-heading"><span>{search.trim() ? '搜索结果' : '你的资料库'}</span><span><span className="data-number">{matching.length}</span> 个</span></div>
    <ul className="library-grid">{ordered.map(library => {
      const selected = library.id === currentId;
      return <li key={library.id}><button type="button" className={`library-card ${selected ? 'selected' : ''}`} aria-label={`切换到资料库 ${library.name}`} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(library.id)}>
        <span className="library-card-top"><span className="library-card-icon"><FolderOpen size={20}/></span><span className={`library-state ${library.ready ? 'ready' : ''}`}>{library.ready ? '可问答' : '待生成图谱'}</span></span>
        <strong>{library.name}</strong>
        <span className="library-card-bottom"><span><span className="data-number">{library.files.length}</span> 份文件{library.read_only && ' · 只读'}</span><span className="library-selection">{selected ? <><Check size={14}/>当前使用</> : <>进入<ArrowUpRight size={14}/></>}</span></span>
      </button></li>;
    })}</ul>
    {!matching.length && <div className="library-empty"><FolderOpen size={25}/><strong>{search.trim() ? '没有找到这个资料库' : '从第一份资料开始'}</strong><p>{search.trim() ? '试试其他名称，或清空搜索查看全部资料库。' : '上传文件，建立自己的知识与依据。'}</p></div>}
    <button type="button" className="library-create" onClick={onCreate}><span className="library-create-icon"><Plus size={20}/></span><span><strong>新建独立资料库</strong><small>上传一组新文件，独立开始</small></span><ChevronRight size={18}/></button>
  </Modal>;
}
