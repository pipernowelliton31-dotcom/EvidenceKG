import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import { Maximize2, Minus, Pause, Play, Plus, Target } from 'lucide-react';
import { relationLabel } from './relations';

export type GraphNode = { id: string; name: string; type: string };
export type GraphEdge = { id: string; source: string; target: string; predicate: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; layout?: 'architecture' | 'network' };
export type GraphPath = { node_ids: string[]; steps: { edge_id: string }[] };
type Dot = GraphNode & SimulationNodeDatum & { radius: number; phase: number; dx: number; dy: number; dz: number; depth: number };
type Link = SimulationLinkDatum<Dot> & { id: string; predicate: string; source: Dot; target: Dot };
export const graphColors: Record<string, string> = { Product: '#d6ab77', AITool: '#92b9a6', Event: '#d49289', Actor: '#b6a3c7', Version: '#9bb4c9', DataAsset: '#a9b885' };
export const graphPalettes: Record<'day' | 'night', Record<string, string>> = { night: graphColors, day: { Product: '#a56635', AITool: '#447c73', Event: '#ad6260', Actor: '#807098', Version: '#517b98', DataAsset: '#738048' } };
export const graphTypeLabels: Record<string, string> = { Product: '产品', AITool: 'AI 工具', Event: '事件', Actor: '参与者', Version: '版本', DataAsset: '数据资产' };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const d = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = d ? clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / d, 0, 1) : 0;
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}
function wrapAngle(delta: number) {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

const TILT = 0.40;
const PERSPECTIVE = 1680;
const AUTO_SPIN = 0.024;
const DRAG_SPIN = 0.0048;
const DRAG_SPIN_VEL = 0.0022;
const SPIN_FRICTION = 0.9;
const PITCH_LIMIT = 1.15;

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
  useEffect(() => { const host = container.current; if (!host) return; const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 720)); observer.observe(host); return () => observer.disconnect(); }, []);
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { controller.current?.wake(); }, [paused, reduced, theme]);
  useEffect(() => { setHover(undefined); }, [data]);
  useEffect(() => {
    const host = container.current, surface = canvas.current;
    if (!host || !surface) return;
    const context = surface.getContext('2d'); if (!context) return;
    const ctx = context;
    if (!data.nodes.length) { ctx.clearRect(0, 0, surface.width, surface.height); return; }
    const globe = !data.architecture && !path;
    const degree = new Map<string, number>();
    data.edges.forEach(e => { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); });
    const nodes: Dot[] = data.nodes.map((n, i) => ({ ...n, radius: 4 + Math.min(5, Math.sqrt(degree.get(n.id) || 0)), phase: i * 2.399, dx: 0, dy: 0, dz: 0, depth: 1 }));
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
    const spriteFor = (color: string) => {
      const existing = sprites.get(color);
      if (existing) return existing;
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 96;
      const sc = sprite.getContext('2d')!; const g = sc.createRadialGradient(48, 48, 0, 48, 48, 48);
      g.addColorStop(0, color + '90'); g.addColorStop(.2, color + '42'); g.addColorStop(.65, color + '0b'); g.addColorStop(1, color + '00'); sc.fillStyle = g; sc.fillRect(0, 0, 96, 96); sprites.set(color, sprite);
      return sprite;
    };
    let width = 1, height = 1, scale = 1, targetScale = 1, panX = 0, panY = 0, targetX = 0, targetY = 0;
    let rotation = 0, rotationVel = 0, pitch = 0, pitchVel = 0, turnTo: number | undefined, layoutRadius = 220;
    let raf = 0, last = 0, visible = true, dirty = true, disposed = false, pointer: { x: number; y: number; startX: number; startY: number; moved: boolean; dot?: Dot } | null = null;
    let hovered: Dot | undefined, focused: Dot | undefined, focusedEdge: Link | undefined;
    let paintTheme: string | undefined;
    let themePaint: Record<string, string> = {};
    const readPaint = () => {
      if (paintTheme !== themeRef.current) {
        paintTheme = themeRef.current;
        const styles = getComputedStyle(host);
        themePaint = Object.fromEntries(Object.entries({
          edge: '--graph-edge', selected: '--accent', particle: '--fg-muted', litParticle: '--accent',
          heading: '--fg-2', muted: '--fg-muted', labelBg: '--graph-label-bg', selectedText: '--fg',
          relationBg: '--graph-selection-bg', relationText: '--graph-selection-fg',
          nodeFallback: '--graph-node-fallback', nodeCore: '--on-accent',
        }).map(([name, token]) => [name, styles.getPropertyValue(token).trim()]));
      }
      return themePaint;
    };
    const connected = new Set<string>();
    const measureLayout = () => { layoutRadius = Math.max(180, ...nodes.map(n => Math.hypot(n.x || 0, n.y || 0))); };
    const nodeLon = (n: Dot) => clamp((n.x || 0) / Math.max(1, layoutRadius), -1, 1) * Math.PI * 0.92;
    const projectLayout = (x: number, y: number, theta: number, phi: number) => {
      if (!globe) return { x, y, z: 0, depth: 1 };
      const lon = clamp(x / layoutRadius, -1, 1) * Math.PI * 0.92;
      const lat = clamp(-y / layoutRadius, -1, 1) * Math.PI * 0.42;
      const cl = Math.cos(lat), R = layoutRadius;
      let X = R * cl * Math.sin(lon), Y = R * Math.sin(lat), Z = R * cl * Math.cos(lon);
      const c = Math.cos(theta), s = Math.sin(theta);
      const x1 = X * c - Z * s, y1 = Y, z1 = X * s + Z * c;
      const tilt = TILT + phi;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const y2 = y1 * ct - z1 * st, z2 = y1 * st + z1 * ct;
      const depth = PERSPECTIVE / Math.max(420, PERSPECTIVE - z2);
      return { x: x1 * depth, y: -y2 * depth, z: z2, depth };
    };
    const projectNodes = (t: number, animated: boolean) => {
      nodes.forEach(n => {
        const wx = (n.x || 0) + (animated && !globe ? Math.sin(t * .24 + n.phase) * 5 : 0);
        const wy = (n.y || 0) + (animated && !globe ? Math.cos(t * .2 + n.phase) * 6 : 0);
        const p = projectLayout(wx, wy, rotation, pitch);
        n.dx = p.x; n.dy = p.y; n.dz = p.z; n.depth = p.depth;
      });
    };
    const fit = () => {
      measureLayout();
      if (globe) {
        const span = layoutRadius * 2.15;
        targetScale = clamp(Math.min((width - (preview ? 75 : 110)) / span, (height - 80) / span), .08, 1.5);
        targetX = 0; targetY = 0;
      } else {
        const xs = nodes.map(n => n.x || 0), ys = nodes.map(n => n.y || 0);
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
        targetScale = clamp(Math.min((width - (preview ? 75 : 100)) / Math.max(260, right - left + 110), (height - (data.architecture ? narrow && !preview ? 100 : 130 : 65)) / Math.max(220, bottom - top + (data.architecture ? 160 : 45))), .08, 1.5);
        targetX = -(left + right) / 2 * targetScale; targetY = -(top + bottom) / 2 * targetScale - (data.architecture && narrow && height < 250 ? 4 : 0);
      }
      dirty = true; wake();
    };
    const fromScreen = (sx: number, sy: number) => ({ x: (sx - width / 2 - panX) / scale, y: (sy - height / 2 - panY) / scale });
    const hit = (x: number, y: number) => [...nodes].filter(n => Math.hypot(n.dx - x, n.dy - y) < (n.radius * n.depth + 10) / Math.max(.8, scale)).sort((a, b) => b.dz - a.dz)[0];
    const focus = (id: string) => {
      focused = nodes.find(n => n.id === id); focusedEdge = links.find(e => e.id === id); hovered = undefined; measureLayout();
      if (globe) {
        const node = focused || (focusedEdge && (focusedEdge.source.dz >= focusedEdge.target.dz ? focusedEdge.source : focusedEdge.target));
        if (node) turnTo = nodeLon(node);
        targetScale = Math.max(targetScale, .7); targetX = 0; targetY = 0;
      } else if (focusedEdge) {
        const a = focusedEdge.source, b = focusedEdge.target;
        targetScale = clamp(Math.min((width - 180) / Math.max(200, Math.abs((a.x || 0) - (b.x || 0)) + 150), (height - 100) / Math.max(100, Math.abs((a.y || 0) - (b.y || 0)) + 90)), .3, 2.4);
        targetX = -((a.x || 0) + (b.x || 0)) / 2 * targetScale; targetY = -((a.y || 0) + (b.y || 0)) / 2 * targetScale;
      } else if (focused) { targetScale = Math.max(targetScale, .85); targetX = -(focused.x || 0) * targetScale; targetY = -(focused.y || 0) * targetScale; }
      else fit(); dirty = true; wake();
    };
    controller.current = { zoom(factor) { targetScale = clamp(targetScale * factor, .08, 3.5); dirty = true; wake(); }, fit, focus, wake };
    const resize = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect(); width = rect.width; height = rect.height;
      arrangeArchitecture(width, height); measureLayout();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.7); surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fit(); if (selectionRef.current) focus(selectionRef.current);
    });
    function draw(time: number) {
      raf = 0; if (disposed || !visible || document.hidden) return;
      if (time - last < 32) { raf = requestAnimationFrame(draw); return; }
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0.016); last = time;
      const animated = !flags.current.paused && !flags.current.reduced;
      if (turnTo != null) {
        const delta = wrapAngle(turnTo - rotation);
        rotation += delta * (flags.current.reduced ? 1 : .14);
        if (Math.abs(delta) < 0.008) { rotation = turnTo; turnTo = undefined; }
        rotationVel = 0;
      } else if (animated) {
        rotation += AUTO_SPIN * dt;
        if (Math.abs(rotationVel) > 0.00005) {
          rotation += rotationVel * dt;
          rotationVel *= Math.pow(SPIN_FRICTION, dt * 60);
        }
        if (Math.abs(pitchVel) > 0.00005) {
          pitch = clamp(pitch + pitchVel * dt, -PITCH_LIMIT, PITCH_LIMIT);
          pitchVel *= Math.pow(SPIN_FRICTION, dt * 60);
        }
      } else { rotationVel = 0; pitchVel = 0; }
      const settling = Math.abs(scale - targetScale) + Math.abs(panX - targetX) + Math.abs(panY - targetY) > .015 || turnTo != null || (animated && (Math.abs(rotationVel) > 0.00008 || Math.abs(pitchVel) > 0.00008));
      const ease = flags.current.reduced ? 1 : .13; scale += (targetScale - scale) * ease; panX += (targetX - panX) * ease; panY += (targetY - panY) * ease;
      ctx.clearRect(0, 0, width, height);
      const night = themeRef.current === 'night', palette = graphPalettes[themeRef.current], paint = readPaint();
      const t = animated ? time / 1000 : 0;
      projectNodes(t, animated);
      const picked = hovered || focused; connected.clear();
      const hasSelection = !!focusedEdge || !!picked;
      if (focusedEdge) { connected.add(focusedEdge.source.id); connected.add(focusedEdge.target.id); }
      else if (picked) { connected.add(picked.id); links.forEach(e => { if (e.source.id === picked.id || e.target.id === picked.id) { connected.add(e.source.id); connected.add(e.target.id); } }); }
      const facingOf = (n: Dot) => globe ? clamp((n.dz / layoutRadius + 1) / 2, 0, 1) : 1;
      ctx.save(); ctx.translate(width / 2 + panX, height / 2 + panY); ctx.scale(scale, scale);
      [...links].sort((a, b) => (a.source.dz + a.target.dz) - (b.source.dz + b.target.dz)).forEach((e, i) => {
        const a = e.source, b = e.target, lit = focusedEdge ? e.id === focusedEdge.id : !!path || !!picked && (a.id === picked.id || b.id === picked.id);
        const facing = (facingOf(a) + facingOf(b)) / 2;
        ctx.globalAlpha = (hasSelection && !lit ? .09 : 1) * (0.22 + 0.78 * facing);
        ctx.strokeStyle = lit ? paint.selected : paint.edge; ctx.lineWidth = (lit ? focusedEdge ? 2.5 : 1.3 : .8) / scale;
        ctx.beginPath(); ctx.moveTo(a.dx, a.dy); ctx.lineTo(b.dx, b.dy); ctx.stroke();
        const angle = Math.atan2(b.dy - a.dy, b.dx - a.dx), ax = b.dx - Math.cos(angle) * (b.radius * b.depth + 5), ay = b.dy - Math.sin(angle) * (b.radius * b.depth + 5);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle - .45) * 5 / scale, ay - Math.sin(angle - .45) * 5 / scale); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle + .45) * 5 / scale, ay - Math.sin(angle + .45) * 5 / scale); ctx.stroke();
        if (animated && facing > .28 && (lit || i % 3 === 0)) { const progress = (t * (lit ? .14 : .06) + i * .173) % 1; ctx.fillStyle = lit ? paint.litParticle : paint.particle; ctx.beginPath(); ctx.arc(a.dx + (b.dx - a.dx) * progress, a.dy + (b.dy - a.dy) * progress, (lit ? 1.8 : 1.1) / scale, 0, Math.PI * 2); ctx.fill(); }
      });
      [...nodes].sort((a, b) => a.dz - b.dz).forEach(n => {
        const color = palette[n.type] || paint.nodeFallback, selected = focusedEdge ? connected.has(n.id) : picked?.id === n.id;
        const facing = facingOf(n);
        ctx.globalAlpha = (hasSelection && !connected.has(n.id) ? .15 : 1) * (0.2 + 0.8 * facing);
        const size = n.depth * (0.72 + 0.28 * facing);
        const glow = (selected ? 65 : 28) / scale * size; if (night) ctx.drawImage(spriteFor(color), n.dx - glow / 2, n.dy - glow / 2, glow, glow);
        const radius = Math.max(n.radius * size, (selected ? 5 : 2.7) / scale);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.dx, n.dy, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = paint.nodeCore; ctx.beginPath(); ctx.arc(n.dx, n.dy, radius * .36, 0, Math.PI * 2); ctx.fill();
        if (selected) { ctx.strokeStyle = color + '70'; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.arc(n.dx, n.dy, n.radius * size + 7 + (animated ? Math.sin(t) * 2 : 0), 0, Math.PI * 2); ctx.stroke(); }
      });
      ctx.restore(); ctx.globalAlpha = 1;
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
        const facing = facingOf(n);
        if (!selected && globe && facing < .32) return;
        if (labelCount >= limit && !selected) return;
        if (!selected && !path && !data.architecture && (preview ? (degree.get(n.id) || 0) < 2 : nodes.length >= 100 && (degree.get(n.id) || 0) < 3)) return;
        const p = projectPoint(n.dx, n.dy), radius = n.radius * n.depth * scale;
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
        ctx.globalAlpha = (hasSelection && !connected.has(n.id) ? .25 : 1) * (0.35 + 0.65 * facing);
        ctx.fillStyle = paint.labelBg; ctx.fillRect(box.x, box.y, w, h);
        ctx.textAlign = 'left'; ctx.fillStyle = selected ? paint.selectedText : paint.heading; ctx.fillText(label, box.x + 6, box.y + font + 1);
      });
      ctx.globalAlpha = 1;
      links.forEach(e => {
        if (focusedEdge ? e.id !== focusedEdge.id : !path && !(picked && (e.source.id === picked.id || e.target.id === picked.id))) return;
        if (globe && (facingOf(e.source) + facingOf(e.target)) / 2 < .28) return;
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
    const down = (event: PointerEvent) => { if (preview) return; const p = eventPoint(event), w = fromScreen(p.x, p.y); pointer = { ...p, startX: p.x, startY: p.y, moved: false, dot: hit(w.x, w.y) }; surface.setPointerCapture(event.pointerId); };
    const move = (event: PointerEvent) => {
      if (preview) return; const p = eventPoint(event), w = fromScreen(p.x, p.y);
      if (pointer) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y;
        if (Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > 3) pointer.moved = true;
        if (pointer.dot) {
          const k = 1 / (scale * Math.max(.45, pointer.dot.depth));
          pointer.dot.x = (pointer.dot.x || 0) + dx * k;
          pointer.dot.y = (pointer.dot.y || 0) + dy * k;
        } else if (globe) {
          turnTo = undefined;
          rotation += -dx * DRAG_SPIN;
          pitch = clamp(pitch + dy * DRAG_SPIN, -PITCH_LIMIT, PITCH_LIMIT);
          if (!flags.current.paused && !flags.current.reduced) {
            rotationVel += -dx * DRAG_SPIN_VEL;
            pitchVel += dy * DRAG_SPIN_VEL;
          }
          dirty = true;
        } else {
          targetX += dx; targetY += dy;
        }
        pointer.x = p.x; pointer.y = p.y; dirty = true; wake();
      }
      else { const next = hit(w.x, w.y); if (next?.id !== hovered?.id) { hovered = next; setHover(next); surface.style.cursor = next ? 'pointer' : 'grab'; dirty = true; wake(); } }
    };
    const up = (event: PointerEvent) => {
      if (!pointer) return;
      if (!pointer.moved) { const p = eventPoint(event), w = fromScreen(p.x, p.y); const node = hit(w.x, w.y); if (node) { focusedEdge = undefined; focused = node; selectRef.current?.(node.id); } else { const edge = links.find(e => pointSegment(w.x, w.y, e.source.dx, e.source.dy, e.target.dx, e.target.dy) < 6 / scale); if (edge) { focused = undefined; focusedEdge = edge; selectRef.current?.(edge.id); } } }
      pointer = null; dirty = true; wake();
    };
    const wheel = (event: WheelEvent) => { if (preview) return; event.preventDefault(); targetScale = clamp(targetScale * Math.exp(-event.deltaY * .0012), .08, 3.5); dirty = true; wake(); };
    const leave = () => { if (!pointer) { hovered = undefined; setHover(undefined); dirty = true; wake(); } };
    const cancel = () => { pointer = null; leave(); };
    surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', move); surface.addEventListener('pointerleave', leave); surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', cancel); surface.addEventListener('wheel', wheel, { passive: false });
    resize.observe(host); visibility.observe(host); document.addEventListener('visibilitychange', tabVisibility); measureLayout(); wake();
    return () => { disposed = true; simulation.stop(); resize.disconnect(); visibility.disconnect(); cancelAnimationFrame(raf); controller.current = null; document.removeEventListener('visibilitychange', tabVisibility); surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave); surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', cancel); surface.removeEventListener('wheel', wheel); void dirty; };
  }, [data, preview, path, narrow]);
  useEffect(() => { controller.current?.focus(selectedId); }, [selectedId, data]);

  return <div ref={container} className={`constellation ${preview ? 'constellation-preview' : ''}`}>
    <canvas ref={canvas} aria-label={`动态知识图谱，${data.nodes.length}个实体，${data.edges.length}条关系`} role="img"/>
    {!data.nodes.length && <div className="graph-empty"><Target size={32}/><p>构图或检索后，实体关联会在这里展开</p></div>}
    {!preview && <>
      <div className="graph-caption"><span className="live-dot"/> {data.architecture ? '产品与工具架构' : '主体关系网络'}<small>{data.nodes.length} 个主体 / {data.edges.length} 条关系</small></div>
      {data.architecture && <div className="graph-category-tabs" aria-label="架构实体分类">{[['all', '全部'], ['Product', '产品'], ['AITool', 'AI 工具']].map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label} <span>{graph?.nodes.filter(n => id === 'all' || n.type === id).length || 0}</span></button>)}</div>}
      <div className="graph-controls"><button aria-label="放大图谱" onClick={() => controller.current?.zoom(1.3)}><Plus size={16}/></button><button aria-label="缩小图谱" onClick={() => controller.current?.zoom(1 / 1.3)}><Minus size={16}/></button><button aria-label="适应图谱" onClick={() => controller.current?.fit()}><Maximize2 size={15}/></button><span/><button aria-label={paused ? '播放图谱动画' : '暂停图谱动画'} onClick={() => setPaused(!paused)}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button></div>
      {hover && <div className="graph-hover"><i style={{ background: graphPalettes[theme][hover.type] }}/><strong>{hover.name}</strong><span>{graphTypeLabels[hover.type] || hover.type} · 点击查看来源</span></div>}
    </>}
  </div>;
}
