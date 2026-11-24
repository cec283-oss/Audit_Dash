import { useEffect, useRef, useState } from 'react';
import type { Meta } from '../types';

const TITLE = 'AUDIT PREVIEW';
const CHECKS = ['공정 · 타겟표준', '공정 · SPC', '설비 · 인터락', '설비 · FDC/NPW 기준', '변경점 · PM/BM', '변경점 · 설비 변경'];
const DURATION = 2900;

type Die = { x: number; z: number; a: number; risk: boolean };

/** 3D 감사 로딩: 기울어진 웨이퍼를 레이더처럼 스캔 → 리스크 다이에서 데이터가 감사 인장으로 올라감 → AUDIT READY 스탬프 */
export default function Boot({ meta, onDone }: { meta?: Meta; onDone: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [pct, setPct] = useState(0);
  const [stamp, setStamp] = useState(false);
  const [out, setOut] = useState(false);
  const done = useRef(false);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const leave = (delay: number) => {
    setTimeout(() => { setOut(true); document.body.classList.remove('booting'); }, delay);
    setTimeout(onDone, delay + 900);
  };
  const skip = () => { if (done.current) return; done.current = true; leave(0); };

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('noboot')) { done.current = true; onDone(); return; }
    document.body.classList.add('booting');
    const c = cv.current!;
    const g = c.getContext('2d')!;
    let W = 0, H = 0, raf = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    addEventListener('resize', size);

    const dies: Die[] = [];
    const N = 24, st = 2 / N;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = -1 + st * (i + 0.5), z = -1 + st * (j + 0.5);
      if (x * x + z * z < 0.9) dies.push({ x, z, a: (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2), risk: rnd() < 0.07 });
    }
    const stars = Array.from({ length: 160 }, () => ({ x: rnd(), y: rnd(), r: rnd() * 1.4 + 0.3, p: rnd() * 6 }));
    const t0 = performance.now();
    const TWO = Math.PI * 2;

    const draw = (now: number) => {
      const t = now - t0;
      const prog = Math.min(1, t / DURATION);
      setPct(prog);
      g.clearRect(0, 0, W, H);
      stars.forEach((s) => { g.globalAlpha = 0.25 + 0.35 * Math.sin(t * 0.002 + s.p) ** 2; g.fillStyle = '#C9C2FF'; g.fillRect(s.x * W, s.y * H, s.r, s.r); });
      g.globalAlpha = 1;

      const cx = W / 2, cy = H * 0.58, sc = Math.min(W, H) * 0.22;
      const yaw = 0.5 + t * 0.00035, pitch = 1.0 + 0.08 * Math.sin(t * 0.0007);
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), D = 3.4;
      const P = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const s = (sc * D) / (D + z2);
        return [cx + x1 * s, cy - y2 * s, s];
      };
      const ring = (r: number, y: number, n = 96) => Array.from({ length: n + 1 }, (_, k) => { const a = (k / n) * TWO; return P(Math.cos(a) * r, y, Math.sin(a) * r); });
      const path = (pts: [number, number, number][]) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); };

      const top = ring(1, 0), bot = ring(1, -0.06);
      path(bot); g.fillStyle = '#120D24'; g.fill();
      path(top);
      const wg = g.createRadialGradient(cx, cy, 0, cx, cy, sc * 1.2);
      wg.addColorStop(0, '#2A2150'); wg.addColorStop(1, '#130E28');
      g.fillStyle = wg; g.fill();

      const beam = prog * Math.PI * 2.15;
      const scannedOf = (d: Die) => beam >= TWO || d.a <= beam;
      g.globalCompositeOperation = 'lighter';
      for (const d of dies) {
        const h = st * 0.42;
        const q = [P(d.x - h, 0.001, d.z - h), P(d.x + h, 0.001, d.z - h), P(d.x + h, 0.001, d.z + h), P(d.x - h, 0.001, d.z + h)];
        const diff = (((beam - d.a) % TWO) + TWO) % TWO;
        let col = 'rgba(160,140,255,0.10)';
        if (diff < 0.35 && beam < TWO) col = `rgba(79,216,235,${0.85 - diff * 2})`;
        else if (scannedOf(d)) col = d.risk ? 'rgba(255,77,109,0.85)' : 'rgba(61,219,160,0.20)';
        g.fillStyle = col;
        path(q); g.closePath(); g.fill();
      }
      if (beam < TWO) {
        const a0 = beam - 0.35;
        const fan: [number, number, number][] = [P(0, 0.002, 0)];
        for (let k = 0; k <= 12; k++) { const a = a0 + (0.35 * k) / 12; fan.push(P(Math.cos(a), 0.002, Math.sin(a))); }
        path(fan); g.closePath();
        g.fillStyle = 'rgba(79,216,235,0.13)'; g.fill();
        const [ex, ey] = P(Math.cos(beam), 0.002, Math.sin(beam));
        const [ox, oy] = P(0, 0.002, 0);
        g.strokeStyle = 'rgba(255,227,160,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
      }
      path(top); g.strokeStyle = 'rgba(79,216,235,0.75)'; g.lineWidth = 2; g.shadowBlur = 18; g.shadowColor = '#4FD8EB'; g.stroke(); g.shadowBlur = 0;

      const sy = 0.95 + 0.04 * Math.sin(t * 0.003);
      const hex = (r: number, rot: number) => Array.from({ length: 7 }, (_, k) => { const a = rot + (k / 6) * TWO; return P(Math.cos(a) * r, sy, Math.sin(a) * r); });
      path(hex(0.42, -t * 0.0011)); g.strokeStyle = 'rgba(79,216,235,0.95)'; g.lineWidth = 2.6; g.shadowBlur = 22; g.shadowColor = '#4FD8EB'; g.stroke();
      path(hex(0.3, t * 0.0016)); g.strokeStyle = 'rgba(160,140,255,0.8)'; g.lineWidth = 1.4; g.shadowColor = '#A08CFF'; g.stroke(); g.shadowBlur = 0;
      const [scx, scy] = P(0, sy, 0);
      dies.forEach((d, i) => {
        if (!d.risk || !scannedOf(d)) return;
        const [dx, dy] = P(d.x, 0, d.z);
        const grd = g.createLinearGradient(dx, dy, scx, scy);
        grd.addColorStop(0, 'rgba(255,77,109,0.7)'); grd.addColorStop(1, 'rgba(79,216,235,0.05)');
        g.strokeStyle = grd; g.lineWidth = 1.2; g.beginPath(); g.moveTo(dx, dy); g.lineTo(scx, scy); g.stroke();
        const f = (t * 0.0009 + i * 0.137) % 1;
        g.fillStyle = '#FFD4DC'; g.beginPath(); g.arc(dx + (scx - dx) * f, dy + (scy - dy) * f, 2.2, 0, TWO); g.fill();
      });
      const core = g.createRadialGradient(scx, scy, 0, scx, scy, sc * 0.35);
      core.addColorStop(0, `rgba(79,216,235,${0.25 + 0.5 * prog})`); core.addColorStop(1, 'rgba(79,216,235,0)');
      g.fillStyle = core; g.beginPath(); g.arc(scx, scy, sc * 0.35, 0, TWO); g.fill();
      // 인장 위로 솟는 홀로그램 빛기둥 → INTERNAL AUDIT 엠블럼 (HTML 오버레이와 같은 높이)
      const hy = cy - sc * 1.09;
      const rise = Math.min(1, t / 900);
      const topY = scy - (scy - hy) * rise;
      const beamG = g.createLinearGradient(0, scy, 0, topY);
      beamG.addColorStop(0, 'rgba(79,216,235,0.32)'); beamG.addColorStop(0.6, 'rgba(160,140,255,0.16)'); beamG.addColorStop(1, 'rgba(160,140,255,0)');
      g.fillStyle = beamG;
      g.beginPath(); g.moveTo(scx - sc * 0.1, scy); g.lineTo(scx + sc * 0.1, scy); g.lineTo(scx + sc * 0.55, topY); g.lineTo(scx - sc * 0.55, topY); g.closePath(); g.fill();
      for (let k = 0; k < 40; k++) {
        const f = (t * 0.00045 + k * 0.071) % 1;
        if (f > rise) continue;
        const px = scx + Math.sin(k * 12.9898) * sc * 0.08 * (1 + f * 5);
        const py = scy - (scy - hy) * f;
        g.globalAlpha = 0.9 * (1 - f);
        g.fillStyle = k % 3 ? '#BDF4FF' : '#C9C2FF';
        g.fillRect(px, py, 2, 2 + f * 4);
      }
      g.globalAlpha = 1;
      // 홀로그램 바닥 링
      for (let k = 0; k < 3; k++) {
        const rr = (((t * 0.0006 + k / 3) % 1) * 0.55 + 0.1);
        const pts = ring(rr, sy + 0.02, 48);
        path(pts); g.strokeStyle = `rgba(160,140,255,${0.5 * (1 - rr / 0.65)})`; g.lineWidth = 1.2; g.stroke();
      }
      g.globalCompositeOperation = 'source-over';

      if (t >= DURATION + 150 && !done.current && metaRef.current) { done.current = true; setStamp(true); leave(950); }
      if (!out) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const key = () => skip();
    addEventListener('keydown', key, { once: true });
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', size); removeEventListener('keydown', key); document.body.classList.remove('booting'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodes = meta?.lines.reduce((s, l) => s + l.nodes.length, 0) ?? 0;
  const fams = meta?.lines.reduce((s, l) => s + l.nodes.reduce((a, n) => a + n.families.length, 0), 0) ?? 0;
  const k = Math.min(CHECKS.length, Math.floor(pct * (CHECKS.length + 0.4)));

  return (
    <div className={`boot3d${out ? ' out' : ''}`} onClick={skip} role="status" aria-label="AUDIT PREVIEW 불러오는 중">
      <canvas ref={cv} aria-hidden="true" />
      <div className="b3-hud">
        <div className="b3-title">
          <h1 aria-label={TITLE}>{TITLE.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${150 + i * 55}ms` }}>{ch === ' ' ? ' ' : ch}</span>)}</h1>
          <p>PRE-AUDIT DATA &amp; INSIGHTS</p>
        </div>
        <div />
        <div className="b3-bottom">
          <ul className="b3-checks">
            {CHECKS.map((c, i) => <li key={c} className={i < k ? 'done' : i === k ? 'cur' : ''}><i>{i < k ? '✓' : ''}</i>{c} 점검</li>)}
          </ul>
          <div>
            <div className="b3-meta">
              <span>{meta ? `${meta.lines.length}라인 · ${nodes}노드 · ${fams}공정 · ${meta.products.length}공법 · 규칙 ${meta.rules.length}개` : '감사 데이터 연결 중'}</span>
              <b>{Math.round(pct * 100)}%</b>
            </div>
            <div className="b3-bar"><i style={{ width: `${pct * 100}%` }} /></div>
          </div>
          <div className="b3-skip">CLICK OR PRESS ANY KEY TO SKIP</div>
        </div>
      </div>
      <div className="b3-holo" aria-label="INTERNAL AUDIT">
        <svg className="b3-emblem" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="emb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E6FBFF" /><stop offset="1" stopColor="#4FD8EB" /></linearGradient>
          </defs>
          <path className="e-shield" d="M60 8 100 22v34c0 26-17 44-40 54C37 100 20 82 20 56V22z" />
          <path className="e-shield2" d="M60 20 89 30v26c0 19-12 33-29 41-17-8-29-22-29-41V30z" />
          <path className="e-check" d="m44 58 11 11 22-25" />
          <g className="e-lens"><circle cx="0" cy="0" r="13" /><path d="m9 9 12 12" /></g>
        </svg>
        <div className="b3-ia">
          {'INTERNAL AUDIT'.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${700 + i * 70}ms` }}>{ch === ' ' ? ' ' : ch}</span>)}
        </div>
        <div className="b3-ia-sub">PROCESS · EQUIPMENT · CHANGE CONTROL</div>
      </div>
      <div className={`b3-stamp${stamp ? ' on' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" fill="none" stroke="#3DDBA0" strokeWidth="6" />
          <circle cx="100" cy="100" r="78" fill="none" stroke="#3DDBA0" strokeWidth="2" strokeDasharray="4 6" />
          <path d="m62 102 26 26 52-58" fill="none" stroke="#3DDBA0" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          <text x="100" y="168" textAnchor="middle" fill="#3DDBA0" style={{ font: '700 17px "Chakra Petch", sans-serif', letterSpacing: '.2em' }}>AUDIT READY</text>
        </svg>
      </div>
    </div>
  );
}
