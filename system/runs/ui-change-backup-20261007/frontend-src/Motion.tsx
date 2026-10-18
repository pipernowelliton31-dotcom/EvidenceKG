import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowDown, ArrowUpRight, FileText, GitBranch, Layers, Search } from 'lucide-react';
import GraphScene, { type GraphData } from './GraphScene';
import GlareHover from './react-bits/GlareHover';
gsap.registerPlugin(ScrollTrigger);

export function Opening({ complete, replay }: { complete: () => void; replay: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const callback = useRef(complete); callback.current = complete;
  useLayoutEffect(() => {
    setDone(false);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setDone(true); callback.current(); return; }
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' }, onComplete: () => { setDone(true); callback.current(); } });
      tl.fromTo('.opening-gem', { scale: .55, rotation: -32, y: 20 }, { scale: 1, rotation: 0, y: 0, duration: 1.8, ease: 'expo.out' }, 0)
        .to('.opening-gem path', { strokeDashoffset: 0, duration: 1.9, stagger: .1 }, 0)
        .fromTo('.opening-word span', { yPercent: 145, scaleY: .3, rotate: 9 }, { yPercent: 0, scaleY: 1, rotate: 0, duration: 1.55, stagger: .045 }, .3)
        .fromTo('.opening-caption', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.2 }, 1)
        .fromTo('.opening-line i', { scaleX: 0 }, { scaleX: 1, duration: 2, ease: 'power2.inOut' }, .5)
        .to('.opening-word span', { yPercent: -145, scaleY: 1.12, stagger: .035, duration: .95 }, 2.6)
        .to('.opening-gem', { y: -55, scale: .6, autoAlpha: 0, duration: .8 }, 2.65)
        .to('.opening-caption,.opening-line,.opening-skip', { autoAlpha: 0, duration: .45 }, 2.7)
        .to('.opening-shutter', { scaleY: 0, stagger: .1, duration: 1.45, transformOrigin: 'top', ease: 'expo.inOut' }, 2.95);
    }, root);
    return () => ctx.revert();
  }, [replay]);
  if (done) return null;
  return <div ref={root} className="opening" aria-label="开场动画"><div className="opening-shutters">{[0, 1, 2, 3, 4].map(i => <div className="opening-shutter" key={i}/>)}</div><div className="opening-copy"><svg className="opening-gem" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 2 57 24 32 62 7 24Z M7 24H57 M32 2 22 24 32 62 42 24Z"/><path className="gem-spark" d="M32 15V49 M16 32H48"/></svg><div className="opening-word" aria-label="evidence.">{'evidence.'.split('').map((letter, i) => <span key={i}>{letter}</span>)}</div><p className="opening-caption">FINDING THE CONNECTIONS BETWEEN.</p><div className="opening-line"><i/></div></div><button className="opening-skip" onClick={() => { setDone(true); callback.current(); }}>跳过开场 <ArrowUpRight size={14}/></button></div>;
}

type LandingProps = { graph?: GraphData; counts: Record<string, number>; units: number; ready: boolean; benchmark: boolean; openingReady: boolean; imageUrl?: string; onGraph: () => void; onQuestion: (index: number) => void; onBuild: () => void; busy: boolean };
export function Landing(props: LandingProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!props.openingReady) return;
    const host = root.current; if (!host) return;
    const scroller = host.closest('.conversation');
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const ctx = gsap.context(() => {
        const opening = gsap.timeline({ defaults: { ease: 'expo.out' } });
        opening.fromTo('.hero-title .line-inner', { xPercent: -9, yPercent: 140, scaleY: .32, rotate: 7 }, { xPercent: 0, yPercent: 0, scaleY: 1, rotate: 0, stagger: .24, duration: 2.1 })
          .fromTo('.hero-kicker,.hero-description,.hero-actions,.hero-footer', { y: 48, clipPath: 'inset(100% 0 0 0)' }, { y: 0, clipPath: 'inset(0% 0 0 0)', duration: 1.55, stagger: .15 }, .75)
          .fromTo('.hero-network', { scale: .68, rotate: -12, clipPath: 'inset(10% 50% 10% 50%)' }, { scale: 1, rotate: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 2.5 }, .4);
        host.querySelectorAll<HTMLElement>('.motion-section').forEach(section => {
          const tl = gsap.timeline({ scrollTrigger: { trigger: section, scroller: scroller || undefined, start: 'top 85%', once: true }, defaults: { ease: 'power4.out' } });
          const titles = section.querySelectorAll('.section-title .line-inner'), cards = section.querySelectorAll('.stagger-item');
          if (titles.length) tl.fromTo(titles, { xPercent: -27, yPercent: 130, scaleY: .42, rotate: -4 }, { xPercent: 0, yPercent: 0, scaleY: 1, rotate: 0, duration: 1.9, stagger: .2 });
          if (cards.length) tl.fromTo(cards, { y: 110, rotate: 2.5, clipPath: 'inset(100% 0 0 0)' }, { y: 0, rotate: 0, clipPath: 'inset(0% 0 0 0)', duration: 1.65, stagger: .2 }, .95);
          const reveal = section.querySelector('.image-reveal');
          if (reveal) { tl.fromTo(reveal, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 2.1 }, .9); const image = reveal.querySelector('img'); if (image) gsap.fromTo(image, { yPercent: -6, scale: 1.14 }, { yPercent: 6, scale: 1.14, ease: 'none', scrollTrigger: { trigger: reveal, scroller: scroller || undefined, start: 'top bottom', end: 'bottom top', scrub: 2 } }); }
        });
        ScrollTrigger.refresh();
      }, host);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, [props.openingReady, props.imageUrl]);
  return <div className="landing" ref={root}>
    <section className="hero"><div className="hero-copy"><span className="hero-kicker"><i/> KNOWLEDGE, IN MOTION. <span>01 — 04</span></span><h2 className="hero-title" aria-label="CONNECT THE UNSEEN"><span className="line-mask"><span className="line-inner">CONNECT</span></span><span className="line-mask"><span className="line-inner">THE <em>UNSEEN.</em></span></span></h2><div className="hero-description"><span className="tiny-cross">+</span><div><h3>让知识之间的联系，浮出水面。</h3><p>从一份文档，到一整个关联世界。<br/>沿着线索探索，让每个答案都有据可循。</p></div></div><div className="hero-actions"><button className="primary" onClick={props.ready ? props.onGraph : props.onBuild} disabled={props.busy}>{props.ready ? '进入知识宇宙' : '解析资料并构图'} <ArrowUpRight size={17}/></button><span>GRAPH × GROUNDED REASONING</span></div></div><div className="hero-network"><GraphScene graph={props.graph} preview/><div className="orbit-label">THE EVIDENCE<br/><b>CONSTELLATION</b></div><span className="orbit-index">FIG. 01 / LIVE DATA</span></div><div className="hero-footer"><span>SCROLL TO EXPLORE <ArrowDown size={12}/></span><span>一个问题 · 无数条可追溯的联系</span><span>LOCAL / EVIDENCE KG</span></div></section>
    <section className="motion-section metrics-section"><div className="section-label">01 / YOUR KNOWLEDGE</div><h2 className="section-title"><span className="line-mask"><span className="line-inner">A WORLD</span></span><span className="line-mask"><span className="line-inner muted-title">IN YOUR FILES.</span></span></h2><div className="knowledge-stats">{[['nodes', '实体 / ENTITIES'], ['edges', '关系 / CONNECTIONS'], ['facts', '事实 / FACTS'], ['units', '单元 / DOCUMENT UNITS']].map(([key, label]) => <div key={key} className="stagger-item"><strong>{(key === 'units' ? props.units : props.counts[key] || 0).toLocaleString()}</strong><span>{label}</span></div>)}</div></section>
    <section className="motion-section questions-section"><div className="section-label">02 / FOLLOW YOUR CURIOSITY</div><h2 className="section-title"><span className="line-mask"><span className="line-inner">ASK MORE.</span></span><span className="line-mask"><span className="line-inner muted-title">SEE FURTHER.</span></span></h2><p className="section-description stagger-item">从一个好问题开始。跨文档、跨实体，追踪答案背后的联系。</p>{props.benchmark ? <div className="suggestions">{[0, 1, 4, 8].map((index, i) => <GlareHover key={index} className="stagger-item question-glare" width="100%" height="100%" background="#111c28" borderColor="#ffffff12" borderRadius="7px" glareColor="#66e4d3" glareOpacity={.14} transitionDuration={1500} glareSize={300}><button className="suggestion-card" onClick={() => props.onQuestion(index)} disabled={props.busy}><span className="card-number">0{i + 1}</span><span className="suggestion-icon">{[<GitBranch size={23}/>, <Layers size={23}/>, <Search size={23}/>, <FileText size={23}/>][i]}</span><strong>{['收入下降，原因在哪里？', '五份文档，同一个产品', '找全备注里的隐藏线索', '同一个编号，两个事件'][i]}</strong><small>{['时间线与多跳关联', '跨格式实体对齐', '完整扫描每一条备注', '辨别场景，追溯来源'][i]}</small><ArrowUpRight className="suggestion-arrow" size={20}/></button></GlareHover>)}</div> : <div className="generic-hint stagger-item">{props.ready ? '输入你关心的问题，让资料自己建立联系。' : '添加业务资料，先建立你的知识图谱。'}</div>}</section>
    <section className="motion-section provenance-section"><div className="section-label">03 / ALWAYS TRACEABLE</div><h2 className="section-title"><span className="line-mask"><span className="line-inner">NOT JUST</span></span><span className="line-mask"><span className="line-inner muted-title">AN ANSWER.</span></span></h2><div className="provenance-layout"><div className="provenance-copy"><h3 className="stagger-item">看得见关系，<br/>也找得到依据。</h3><p className="stagger-item">每个节点连接真实资料，每条路径保留事实方向。打开来源，回到页码、章节与单元格，判断关联意味着什么。</p><button className="text-link stagger-item" onClick={props.onGraph}>探索图谱与证据 <ArrowUpRight size={18}/></button></div><div className="image-reveal">{props.imageUrl ? <img src={props.imageUrl} alt="当前知识库中的原始产品架构图" loading="lazy"/> : <div className="source-art"><FileText size={70}/><span>DOCUMENT → ENTITY → EVIDENCE</span></div>}<span className="image-caption">SOURCE MATERIAL / 原始资料</span></div></div></section>
    <footer className="landing-footer"><span className="footer-word">evidence<span>®</span></span><p>EVERY CONNECTION HAS A SOURCE.</p><button onClick={props.onGraph}>LET'S EXPLORE <ArrowUpRight size={18}/></button></footer>
  </div>;
}

export function usePageMotion(key: string) {
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => { gsap.fromTo('.page-toolbar h1', { yPercent: 110, scaleY: .55, transformOrigin: 'bottom' }, { yPercent: 0, scaleY: 1, duration: 1.1, ease: 'expo.out' }); const pages = document.querySelectorAll('.graph-page,.test-intro,.history-page'); if (pages.length) gsap.fromTo(pages, { y: 28, clipPath: 'inset(12% 0 0 0)' }, { y: 0, clipPath: 'inset(0% 0 0 0)', duration: 1.1, ease: 'power4.out' }); });
    return () => ctx.revert();
  }, [key]);
}
