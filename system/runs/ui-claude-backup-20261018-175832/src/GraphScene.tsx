import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import { Maximize2, Minus, Pause, Play, Plus, Target } from 'lucide-react';
import { relationLabel } from './relations';

export type GraphNode = { id: string; name: string; type: string };
export type GraphEdge = { id: string; source: string; target: string; predicate: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; layout?: 'architecture' | 'network' };
export type GraphPath = { node_ids: string[]; steps: { edge_id: string }[] };
type Dot = GraphNode & SimulationNodeDatum & { radius: number; phase: number; dx: number; dy: number };
type Link = SimulationLinkDatum<Dot> & { id: string; predicate: string; source: Dot; target: Dot };
export const graphColors: Record<string, string> = { Product: '#eac67d', AITool: '#66e4d3', Event: '#ed789d', Actor: '#a897e7', Version: '#74b7e4', DataAsset: '#8bdcb0' };
export const graphPalettes: Record<'day' | 'night', Record<string, string>> = { night: graphColors, day: { Product: '#916721', AITool: '#147d73', Event: '#be4e75', Actor: '#7860b5', Version: '#347cb2', DataAsset: '#48845f' } };
export const graphTypeLabels: Record<string, string> = { Product: '产品', AITool: 'AI 工具', Event: '事件', Actor: '参与者', Version: '版本', DataAsset: '数据资产' };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const d = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = d ? clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / d, 0, 1) : 0;
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

/** Canvas draws the real graph. Layout is settled once; ambient motion never updates React state. */
export default function GraphScene({ graph, select, path, preview = false, selectedId = '', theme = 'day' }: {
  theme?: 'day' | 'night'; graph?: GraphData; select?: (id: string) => void; path?: GraphPath; preview?: boolean; selectedId?: string;
}) {
  const themeRef = useRef(theme); themeRef.current = theme;
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<{ zoom: (factor: number) => void; fit: () => void; focus: (id: string) => void; wake: () => void } | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [active, setActive] = useState('');
  const [hover, setHover] = useState<GraphNode>();
  const [category, setCategory] = useState('all');
  const [narrow, setNarrow] = useState(false);
  const flags = useRef({ paused, reduced }); flags.current = { paused, reduced };
  const selectRef = useRef(select); selectRef.current = select;
  const selectionRef = useRef(selectedId); selectionRef.current = selectedId;
  const data = useMemo(() => {
    const ids = path ? new Set(path.node_ids) : null;
    const architecture = graph?.layout === 'architecture' && !path;
    const nodes = (graph?.nodes || []).filter(n => (!ids || ids.has(n.id)) && (!architecture || preview || category === 'all' || n.type === category));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edgeIds = path ? new Set(path.steps.map(s => s.edge_id)) : null;
    return { nodes, edges: (graph?.edges || []).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target) && (!edgeIds || edgeIds.has(e.id))), architecture };
  }, [graph, path, category, preview]);
  useEffect(() => { const media = matchMedia('(max-width: 720px)'); const update = () => { setNarrow(media.matches); setCategory(media.matches ? 'Product' : 'all'); }; update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { controller.current?.wake(); }, [paused, reduced, theme]);
  useEffect(() => { setActive(''); setHover(undefined); }, [data]);
  useEffect(() => {
    const host = container.current, surface = canvas.current;
    if (!host || !surface) return;
    const context = surface.getContext('2d'); if (!context) return;
    const ctx = context;
    if (!data.nodes.length) { ctx.clearRect(0, 0, surface.width, surface.height); return; }
    const degree = new Map<string, number>();
    data.edges.forEach(e => { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); });
    const nodes: Dot[] = data.nodes.map((n, i) => ({ ...n, radius: 4 + Math.min(5, Math.sqrt(degree.get(n.id) || 0)), phase: i * 2.399, dx: 0, dy: 0 }));
    const layoutLinks: SimulationLinkDatum<Dot>[] = data.edges.map(e => ({ ...e }));
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<Dot, SimulationLinkDatum<Dot>>(layoutLinks).id(n => n.id).distance(path ? 155 : 110).strength(.38))
      .force('charge', forceManyBody().strength(-350))
      .force('collision', forceCollide<Dot>().radius(n => n.radius + 36))
      .force('x', forceX(0).strength(.07)).force('y', forceY(0).strength(.07))
      .force('center', forceCenter(0, 0)).stop();
    for (let i = 0; i < 160; i++) simulation.tick();
    const links = layoutLinks as Link[];
    if (path) nodes.forEach(n => { const index = path.node_ids.indexOf(n.id); n.x = (index - (nodes.length - 1) / 2) * 210; n.y = index % 2 ? 18 : -18; });
    const regions: { label: string; subtitle: string; x: number; y: number }[] = [];
    function arrangeArchitecture(viewWidth: number, viewHeight: number) {
      if (!data.architecture) return;
      regions.length = 0;
      const groups = ['Product', 'AITool', ...new Set(nodes.map(n => n.type).filter(t => !['Product', 'AITool'].includes(t)))];
      const present = groups.filter(type => nodes.some(n => n.type === type));
      present.forEach((type, group) => {
        const members = nodes.filter(n => n.type === type).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        const columns = Math.min(present.length === 1 && viewWidth >= 430 && viewHeight < 350 ? 6 : 3, members.length), rows = Math.ceil(members.length / columns);
        const center = (group - (present.length - 1) / 2) * 820;
        members.forEach((n, i) => { n.x = center + (i % columns - (columns - 1) / 2) * 220; n.y = (Math.floor(i / columns) - (rows - 1) / 2) * 105; });
        regions.push({ label: type === 'Product' ? 'PRODUCTS' : type === 'AITool' ? 'AI TOOLS' : type.toUpperCase(), subtitle: `${graphTypeLabels[type] || type} · ${members.length}`, x: center, y: -(rows - 1) / 2 * 105 - 62 });
      });
    }
    const sprites = new Map<string, HTMLCanvasElement>();
    Object.values(graphPalettes).flatMap(palette => Object.values(palette)).concat('#9ac7c0').forEach(color => {
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 96;
      const sc = sprite.getContext('2d')!; const g = sc.createRadialGradient(48, 48, 0, 48, 48, 48);
      g.addColorStop(0, color + '90'); g.addColorStop(.2, color + '42'); g.addColorStop(.65, color + '0b'); g.addColorStop(1, color + '00'); sc.fillStyle = g; sc.fillRect(0, 0, 96, 96); sprites.set(color, sprite);
    });
    let width = 1, height = 1, scale = 1, targetScale = 1, panX = 0, panY = 0, targetX = 0, targetY = 0;
    let raf = 0, last = 0, visible = true, dirty = true, disposed = false, pointer: { x: number; y: number; startX: number; startY: number; moved: boolean; dot?: Dot } | null = null;
    let hovered: Dot | undefined, focused: Dot | undefined, focusedEdge: Link | undefined;
    const connected = new Set<string>();
    const fit = () => {
      const xs = nodes.map(n => n.x || 0), ys = nodes.map(n => n.y || 0);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      targetScale = clamp(Math.min((width - (preview ? 75 : 100)) / Math.max(260, right - left + 110), (height - (data.architecture ? narrow && !preview ? 100 : 130 : 65)) / Math.max(220, bottom - top + (data.architecture ? 160 : 45))), .08, 1.5);
      targetX = -(left + right) / 2 * targetScale; targetY = -(top + bottom) / 2 * targetScale - (data.architecture && narrow && height < 250 ? 4 : 0); dirty = true; wake();
    };
    const world = (x: number, y: number) => ({ x: (x - width / 2 - panX) / scale, y: (y - height / 2 - panY) / scale });
    const hit = (x: number, y: number) => nodes.find(n => Math.hypot(n.dx - x, n.dy - y) < (n.radius + 9) / Math.max(.8, scale));
    const focus = (id: string) => { focused = nodes.find(n => n.id === id); focusedEdge = links.find(e => e.id === id); hovered = undefined;
      if (focusedEdge) { const a = focusedEdge.source, b = focusedEdge.target; targetScale = clamp(Math.min((width - 180) / Math.max(200, Math.abs((a.x || 0) - (b.x || 0)) + 150), (height - 100) / Math.max(100, Math.abs((a.y || 0) - (b.y || 0)) + 90)), .3, 2.4); targetX = -((a.x || 0) + (b.x || 0)) / 2 * targetScale; targetY = -((a.y || 0) + (b.y || 0)) / 2 * targetScale; }
      else if (focused) { targetScale = Math.max(targetScale, .85); targetX = -(focused.x || 0) * targetScale; targetY = -(focused.y || 0) * targetScale; }
      else fit(); dirty = true; wake(); };
    controller.current = { zoom(factor) { targetScale = clamp(targetScale * factor, .08, 3.5); dirty = true; wake(); }, fit, focus, wake };
    const resize = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect(); width = rect.width; height = rect.height;
      arrangeArchitecture(width, height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.7); surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fit(); if (selectionRef.current) focus(selectionRef.current);
    });
    function draw(time: number) {
      raf = 0; if (disposed || !visible || document.hidden) return;
      if (time - last < 32) { raf = requestAnimationFrame(draw); return; } last = time;
      const animated = !flags.current.paused && !flags.current.reduced;
      const settling = Math.abs(scale - targetScale) + Math.abs(panX - targetX) + Math.abs(panY - targetY) > .015;
      const ease = flags.current.reduced ? 1 : .13; scale += (targetScale - scale) * ease; panX += (targetX - panX) * ease; panY += (targetY - panY) * ease;
      ctx.clearRect(0, 0, width, height);
      const night = themeRef.current === 'night', palette = graphPalettes[themeRef.current];
      const paint = night ? { edge: '#7997b448', selected: '#8affdf', particle: '#7bb5cf', litParticle: '#b7fff1', heading: '#b8cad7', muted: '#8ba4b8', labelBg: '#0b1421ee', selectedText: '#f6fffb', relationBg: '#173b37', relationText: '#b3ffe1' } : { edge: '#b6c3d5b8', selected: '#576acb', particle: '#899bb9', litParticle: '#6174ce', heading: '#425879', muted: '#6b7e97', labelBg: '#f8faffef', selectedText: '#23375b', relationBg: '#e8ecfc', relationText: '#475db5' };
      const t = animated ? time / 1000 : 0;
      ctx.save(); ctx.translate(width / 2 + panX, height / 2 + panY); ctx.scale(scale, scale);
      nodes.forEach(n => { n.dx = (n.x || 0) + (animated ? Math.sin(t * .24 + n.phase) * 5 : 0); n.dy = (n.y || 0) + (animated ? Math.cos(t * .2 + n.phase) * 6 : 0); });
      const picked = hovered || focused; connected.clear();
      const hasSelection = !!focusedEdge || !!picked;
      if (focusedEdge) { connected.add(focusedEdge.source.id); connected.add(focusedEdge.target.id); }
      else if (picked) { connected.add(picked.id); links.forEach(e => { if (e.source.id === picked.id || e.target.id === picked.id) { connected.add(e.source.id); connected.add(e.target.id); } }); }
      links.forEach((e, i) => {
        const a = e.source, b = e.target, lit = focusedEdge ? e.id === focusedEdge.id : !!path || !!picked && (a.id === picked.id || b.id === picked.id);
        ctx.globalAlpha = hasSelection && !lit ? .09 : 1;
        ctx.strokeStyle = lit ? paint.selected : paint.edge; ctx.lineWidth = (lit ? focusedEdge ? 2.5 : 1.3 : .8) / scale;
        ctx.beginPath(); ctx.moveTo(a.dx, a.dy); ctx.lineTo(b.dx, b.dy); ctx.stroke();
        const angle = Math.atan2(b.dy - a.dy, b.dx - a.dx), ax = b.dx - Math.cos(angle) * (b.radius + 5), ay = b.dy - Math.sin(angle) * (b.radius + 5);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle - .45) * 5 / scale, ay - Math.sin(angle - .45) * 5 / scale); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle + .45) * 5 / scale, ay - Math.sin(angle + .45) * 5 / scale); ctx.stroke();
        if (animated && (lit || i % 3 === 0)) { const progress = (t * (lit ? .14 : .06) + i * .173) % 1; ctx.fillStyle = lit ? paint.litParticle : paint.particle; ctx.beginPath(); ctx.arc(a.dx + (b.dx - a.dx) * progress, a.dy + (b.dy - a.dy) * progress, lit ? 1.8 / scale : 1.1 / scale, 0, Math.PI * 2); ctx.fill(); }
      });
      nodes.forEach(n => {
        const color = palette[n.type] || '#9ac7c0', selected = focusedEdge ? connected.has(n.id) : picked?.id === n.id;
        ctx.globalAlpha = hasSelection && !connected.has(n.id) ? .15 : 1;
        const glow = (selected ? 65 : 28) / scale; if (night) ctx.drawImage(sprites.get(color)!, n.dx - glow / 2, n.dy - glow / 2, glow, glow);
        const radius = Math.max(n.radius, (selected ? 5 : 2.7) / scale);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.dx, n.dy, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#efffff'; ctx.beginPath(); ctx.arc(n.dx, n.dy, radius * .36, 0, Math.PI * 2); ctx.fill();
        if (selected) { ctx.strokeStyle = color + '70'; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.arc(n.dx, n.dy, n.radius + 7 + (animated ? Math.sin(t) * 2 : 0), 0, Math.PI * 2); ctx.stroke(); }
      });
      ctx.restore(); ctx.globalAlpha = 1;
      // Labels are placed in screen coordinates, so zoom never creates overlapping text.
      type Box = { x: number; y: number; w: number; h: number };
      const occupied: Box[] = [];
      const projectPoint = (x: number, y: number) => ({ x: width / 2 + panX + x * scale, y: height / 2 + panY + y * scale });
      const free = (b: Box) => b.x >= 12 && b.y >= (data.architecture && narrow && !preview ? height < 300 ? 75 : 82 : 46) && b.x + b.w <= width - 12 && b.y + b.h <= height - (preview ? 10 : 42) && !occupied.some(a => b.x < a.x + a.w + 6 && b.x + b.w + 6 > a.x && b.y < a.y + a.h + 5 && b.y + b.h + 5 > a.y);
      regions.forEach(region => {
        const p = projectPoint(region.x, region.y);
        ctx.font = '12px Bahnschrift, Microsoft YaHei, sans-serif';
        const w = ctx.measureText(region.label).width;
        const box = { x: p.x - w / 2 - 8, y: p.y - 18, w: w + 16, h: 34 };
        if (free(box)) { occupied.push(box); ctx.textAlign = 'center'; ctx.fillStyle = paint.heading; ctx.fillText(region.label, p.x, p.y - 5); ctx.font = '10px Bahnschrift, Microsoft YaHei, sans-serif'; ctx.fillStyle = paint.muted; ctx.fillText(region.subtitle, p.x, p.y + 10); }
      });
      const candidates = [...nodes].sort((a, b) => Number(b.id === picked?.id) - Number(a.id === picked?.id) || Number(connected.has(b.id)) - Number(connected.has(a.id)) || (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
      const limit = data.architecture || path ? nodes.length : Math.max(14, Math.min(34, Math.floor(width * height / 14000)));
      let labelCount = 0;
      candidates.forEach(n => {
        const selected = focusedEdge ? connected.has(n.id) : n.id === picked?.id;
        if (labelCount >= limit && !selected) return;
        if (!selected && !path && !data.architecture && (preview ? (degree.get(n.id) || 0) < 2 : nodes.length >= 100 && (degree.get(n.id) || 0) < 3)) return;
        const p = projectPoint(n.dx, n.dy), radius = n.radius * scale;
        const font = selected ? 14 : preview ? 11 : 12;
        ctx.font = `${font}px Bahnschrift, Microsoft YaHei, sans-serif`;
        let label = n.name;
        const maxWidth = selected ? Math.min(240, width - 40) : data.architecture ? clamp(220 * scale - 26, 50, 170) : 154;
        while (label.length > 1 && ctx.measureText(label + (label === n.name ? '' : '…')).width > maxWidth) label = label.slice(0, -1);
        if (label !== n.name) label += '…';
        const w = ctx.measureText(label).width + 12, h = font + 10;
        const below = { x: p.x - w / 2, y: p.y + radius + 9, w, h };
        const right = { x: p.x + radius + 9, y: p.y - h / 2, w, h };
        const left = { x: p.x - radius - 9 - w, y: p.y - h / 2, w, h };
        const above = { x: p.x - w / 2, y: p.y - radius - 9 - h, w, h };
        const box = (data.architecture ? [below, right, left, above] : [right, below, above, left]).find(free);
        if (!box) return;
        occupied.push(box); labelCount++;
        ctx.globalAlpha = hasSelection && !connected.has(n.id) ? .25 : 1;
        ctx.fillStyle = paint.labelBg; ctx.fillRect(box.x, box.y, w, h);
        ctx.textAlign = 'left'; ctx.fillStyle = selected ? paint.selectedText : palette[n.type] || '#9ac7c0'; ctx.fillText(label, box.x + 6, box.y + font + 1);
      });
      ctx.globalAlpha = 1;
      links.forEach(e => {
        if (focusedEdge ? e.id !== focusedEdge.id : !path && !(picked && (e.source.id === picked.id || e.target.id === picked.id))) return;
        const p = projectPoint((e.source.dx + e.target.dx) / 2, (e.source.dy + e.target.dy) / 2);
        ctx.font = '10px Bahnschrift, Microsoft YaHei, sans-serif';
        const label = relationLabel(e.predicate), w = ctx.measureText(label).width + 16, box = { x: p.x - w / 2, y: p.y - 10, w, h: 21 };
        if (!free(box)) return;
        occupied.push(box); ctx.fillStyle = paint.relationBg; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.fillStyle = paint.relationText; ctx.textAlign = 'center'; ctx.fillText(label, p.x, p.y + 4);
      });
      dirty = false;
      if (animated || settling) raf = requestAnimationFrame(draw);
    }
    function wake() { if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(draw); }
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); else { cancelAnimationFrame(raf); raf = 0; } }, { threshold: .01 });
    const tabVisibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { dirty = true; wake(); } };
    const eventPoint = (event: PointerEvent) => { const rect = surface.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => { if (preview) return; const p = eventPoint(event), w = world(p.x, p.y); pointer = { ...p, startX: p.x, startY: p.y, moved: false, dot: hit(w.x, w.y) }; surface.setPointerCapture(event.pointerId); };
    const move = (event: PointerEvent) => {
      if (preview) return; const p = eventPoint(event), w = world(p.x, p.y);
      if (pointer) { const dx = p.x - pointer.x, dy = p.y - pointer.y; if (Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > 3) pointer.moved = true; if (pointer.dot) { pointer.dot.x = w.x; pointer.dot.y = w.y; } else { targetX += dx; targetY += dy; } pointer.x = p.x; pointer.y = p.y; dirty = true; wake(); }
      else { const next = hit(w.x, w.y); if (next?.id !== hovered?.id) { hovered = next; setHover(next); surface.style.cursor = next ? 'pointer' : 'grab'; dirty = true; wake(); } }
    };
    const up = (event: PointerEvent) => {
      if (!pointer) return;
      if (!pointer.moved) { const p = eventPoint(event), w = world(p.x, p.y); const node = hit(w.x, w.y); if (node) { focusedEdge = undefined; focused = node; setActive(node.id); selectRef.current?.(node.id); } else { const edge = links.find(e => pointSegment(w.x, w.y, e.source.dx, e.source.dy, e.target.dx, e.target.dy) < 6 / scale); if (edge) { focused = undefined; focusedEdge = edge; selectRef.current?.(edge.id); } } }
      pointer = null; dirty = true; wake();
    };
    const wheel = (event: WheelEvent) => { if (preview) return; event.preventDefault(); targetScale = clamp(targetScale * Math.exp(-event.deltaY * .0012), .08, 3.5); dirty = true; wake(); };
    const leave = () => { if (!pointer) { hovered = undefined; setHover(undefined); dirty = true; wake(); } };
    const cancel = () => { pointer = null; leave(); };
    surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', move); surface.addEventListener('pointerleave', leave); surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', cancel); surface.addEventListener('wheel', wheel, { passive: false });
    resize.observe(host); visibility.observe(host); document.addEventListener('visibilitychange', tabVisibility); wake();
    return () => { disposed = true; simulation.stop(); resize.disconnect(); visibility.disconnect(); cancelAnimationFrame(raf); controller.current = null; document.removeEventListener('visibilitychange', tabVisibility); surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave); surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', cancel); surface.removeEventListener('wheel', wheel); void dirty; };
  }, [data, preview, path, narrow]);
  useEffect(() => { controller.current?.focus(selectedId); setActive(data.nodes.some(n => n.id === selectedId) ? selectedId : ''); }, [selectedId, data]);

  return <div ref={container} className={`constellation ${preview ? 'constellation-preview' : ''}`}>
    <canvas ref={canvas} aria-label={`动态知识图谱，${data.nodes.length}个实体，${data.edges.length}条关系`} role="img"/>
    {!data.nodes.length && <div className="graph-empty"><Target size={32}/><p>构图或检索后，实体关联会在这里展开</p></div>}
    {!preview && <>
      <div className="graph-caption"><span className="live-dot"/> {data.architecture ? '产品与工具架构' : paused || reduced ? '主体关系 · 已暂停' : '主体关系网络'}<small>{data.nodes.length} 个主体 / {data.edges.length} 条关系</small></div>
      {data.architecture && <div className="graph-category-tabs" aria-label="架构实体分类">{[['all', '全部'], ['Product', '产品'], ['AITool', 'AI 工具']].map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label} <span>{graph?.nodes.filter(n => id === 'all' || n.type === id).length || 0}</span></button>)}</div>}
      <div className="graph-controls"><button aria-label="放大图谱" onClick={() => controller.current?.zoom(1.3)}><Plus size={16}/></button><button aria-label="缩小图谱" onClick={() => controller.current?.zoom(1 / 1.3)}><Minus size={16}/></button><button aria-label="适应图谱" onClick={() => controller.current?.fit()}><Maximize2 size={15}/></button><span/><button aria-label={paused ? '播放图谱动画' : '暂停图谱动画'} onClick={() => setPaused(!paused)}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button></div>
      <div className="graph-node-picker"><select aria-label="选择图谱实体" value={active} onChange={e => { setActive(e.target.value); controller.current?.focus(e.target.value); if (e.target.value) selectRef.current?.(e.target.value); }}><option value="">定位实体 / 查看证据</option>{data.nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
      {hover && <div className="graph-hover"><i style={{ background: graphPalettes[theme][hover.type] }}/><strong>{hover.name}</strong><span>{graphTypeLabels[hover.type] || hover.type} · 点击查看来源</span></div>}
    </>}
  </div>;
}
