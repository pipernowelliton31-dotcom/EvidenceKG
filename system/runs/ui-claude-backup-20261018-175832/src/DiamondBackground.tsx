import { useEffect, useRef } from 'react';

/** Original light field; no licensed assets or registry downloads. */
export default function DiamondBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current, ctx = surface?.getContext('2d');
    if (!surface || !ctx) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, last = -100, pointerX = 0, pointerY = 0, driftX = 0, driftY = 0;
    let seed = 8042;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const points = Array.from({ length: 140 }, (_, i) => ({
      x: random(), y: random(), size: .4 + random() * .8, phase: random() * Math.PI * 2,
      speed: .22 + random() * .32, depth: .2 + random() * .8, gem: i % 5 === 0,
      color: i % 7 === 0 ? '224,203,166' : i % 3 === 0 ? '128,197,193' : '208,227,239',
    }));
    function draw(time: number) {
      frame = 0;
      if (document.hidden) return;
      if (time - last < 1000 / 24 && !media.matches) { frame = requestAnimationFrame(draw); return; }
      last = time; ctx!.clearRect(0, 0, width, height);
      const t = media.matches ? 4 : time / 1000;
      driftX += ((media.matches ? 0 : pointerX) - driftX) * .035;
      driftY += ((media.matches ? 0 : pointerY) - driftY) * .035;
      points.forEach(p => {
        const x = p.x * width + driftX * p.depth, y = p.y * height + driftY * p.depth;
        const pulse = Math.max(0, Math.sin(t * p.speed + p.phase)) ** 12;
        ctx!.fillStyle = `rgba(${p.color},${.12 + pulse * .35})`;
        ctx!.beginPath(); ctx!.arc(x, y, p.size, 0, Math.PI * 2); ctx!.fill();
        if (!p.gem || pulse < .025) return;
        const radius = 4 + pulse * 11;
        const glow = ctx!.createRadialGradient(x, y, 0, x, y, radius * 2.3);
        glow.addColorStop(0, `rgba(${p.color},${pulse * .23})`); glow.addColorStop(1, `rgba(${p.color},0)`);
        ctx!.fillStyle = glow; ctx!.fillRect(x - radius * 2.3, y - radius * 2.3, radius * 4.6, radius * 4.6);
        ctx!.fillStyle = `rgba(${p.color},${pulse * .8})`;
        ctx!.beginPath(); ctx!.moveTo(x, y - radius);
        ctx!.quadraticCurveTo(x + 1, y - 1, x + radius * .68, y);
        ctx!.quadraticCurveTo(x + 1, y + 1, x, y + radius);
        ctx!.quadraticCurveTo(x - 1, y + 1, x - radius * .68, y);
        ctx!.quadraticCurveTo(x - 1, y - 1, x, y - radius); ctx!.fill();
        ctx!.fillStyle = `rgba(244,250,255,${pulse})`; ctx!.fillRect(x - .65, y - .65, 1.3, 1.3);
      });
      if (!media.matches) frame = requestAnimationFrame(draw);
    }
    const wake = () => { last = -100; if (!frame && !document.hidden) frame = requestAnimationFrame(draw); };
    const resize = () => {
      width = innerWidth; height = innerHeight; const dpr = Math.min(devicePixelRatio, 1.5);
      surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); wake();
    };
    const pointer = (e: PointerEvent) => { pointerX = (e.clientX / width - .5) * 16; pointerY = (e.clientY / height - .5) * 12; };
    const visible = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
    resize(); window.addEventListener('resize', resize); window.addEventListener('pointermove', pointer, { passive: true });
    document.addEventListener('visibilitychange', visible); media.addEventListener('change', wake);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', pointer); document.removeEventListener('visibilitychange', visible); media.removeEventListener('change', wake); };
  }, []);
  return <div className="ambient-background diamond-background" aria-hidden="true"><canvas ref={canvas} className="diamond-field"/></div>;
}
