import { useEffect, useMemo, useState } from 'react';
import { Layers, MessageSquare, Network, ScanLine } from 'lucide-react';
import type { GraphData } from './GraphScene';
import GraphChoice, { RelationRow } from './GraphChoice';
import { relationLabel } from './relations';

export type GraphView = 'entities' | 'architecture' | 'all' | 'query';
const views = [
  { id: 'entities', label: '业务关系', Icon: Network },
  { id: 'architecture', label: '产品架构', Icon: Layers },
  { id: 'all', label: '完整图谱', Icon: ScanLine },
  { id: 'query', label: '本轮问答', Icon: MessageSquare },
] as const;

export default function GraphControls({ view, graph, ready, queryAvailable, loading, onViewChange, selectedId, onSelect, paths, pathIndex, onPathChange }: {
  view: GraphView; graph?: GraphData; ready: boolean; queryAvailable: boolean; loading: boolean;
  onViewChange: (view: GraphView) => void; selectedId: string; onSelect: (id: string) => void;
  paths: { path_id: string; steps: unknown[] }[]; pathIndex: number; onPathChange: (index: number) => void;
}) {
  const [entityId, setEntityId] = useState('');
  useEffect(() => { if (graph?.nodes.some(node => node.id === selectedId)) setEntityId(selectedId); }, [selectedId, graph]);
  const names = new Map(graph?.nodes.map(node => [node.id, node.name]));
  const entities = useMemo(() => (graph?.nodes || []).map(node => ({ value: node.id, label: node.name })), [graph]);
  const relatedEdges = useMemo(() => (graph?.edges || []).filter(edge => !entityId || edge.source === entityId || edge.target === entityId), [graph, entityId]);
  const relations = relatedEdges.map(edge => {
    const source = names.get(edge.source) || edge.source, target = names.get(edge.target) || edge.target, verb = relationLabel(edge.predicate);
    return { value: edge.id, label: `${source} · ${verb} · ${target}`, relation: { source, verb, target } };
  });
  function pickEntity(id: string) { setEntityId(id); if (id) onSelect(id); }
  function clear() { setEntityId(''); onSelect(''); }
  return <div className="graph-controls-bar">
    <div className="graph-view-row"><div className="graph-view-switch" role="group" aria-label="图谱视图" aria-busy={loading}>{views.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={view === id} disabled={!ready || id === 'query' && !queryAvailable || id === 'all' && loading} title={id === 'query' && !queryAvailable ? '完成问答后可用' : undefined} onClick={() => onViewChange(id)}><Icon size={16} aria-hidden="true"/><span>{id === 'all' && loading ? '加载中…' : label}</span></button>)}</div>
      <span className="graph-view-count" aria-live="polite">{graph?.nodes.length || 0} 个节点 · {graph?.edges.length || 0} 条关系</span>
    </div>
    <div className="graph-selection-row">
      <div className="graph-entity-field"><span className="graph-control-label">查找实体</span><GraphChoice label="实体" placeholder={entities.length ? '输入实体名称' : '暂无实体'} value={entityId} options={entities} onChange={pickEntity} disabled={!ready || !entities.length}/></div>
      <div className="graph-relation-field"><span className="graph-control-label">查找关系</span><GraphChoice label="关系" placeholder={relations.length ? '选择关系' : '暂无关系'} value={relations.some(option => option.value === selectedId) ? selectedId : ''} options={relations} onChange={onSelect} disabled={!ready || !relations.length}/></div>
      {view === 'query' && paths.length > 0 && <div className="graph-path-field"><span className="graph-control-label">关联路径</span><GraphChoice label="路径" placeholder="全部路径" value={String(pathIndex)} options={[{ value: '-1', label: '全部路径' }, ...paths.map((path, index) => ({ value: String(index), label: `路径 ${index + 1} · ${path.steps.length} 跳` }))]} onChange={value => onPathChange(Number(value))}/></div>}
      {(selectedId || entityId) && <button type="button" className="graph-clear-selection" onClick={clear}>清除选择</button>}
    </div>
    {entityId && <div className="graph-related-list" aria-label="该实体的关联关系">
      <p>{names.get(entityId) || '实体'} · {relations.length} 条关联</p>
      {relations.length ? relations.map(option => <button type="button" key={option.value} className={selectedId === option.value ? 'is-active' : ''} onClick={() => onSelect(option.value)}>
        {option.relation && <RelationRow source={option.relation.source} verb={option.relation.verb} target={option.relation.target}/>}
      </button>) : <p className="graph-related-empty">没有关联关系</p>}
    </div>}
  </div>;
}
