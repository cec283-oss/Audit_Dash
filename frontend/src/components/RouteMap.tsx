import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import type { Dossier, Lvl, Stage, Step } from '../types';
import { cssVar, escHtml, hideTip, MODULE_VAR, moduleVar, num, sevColor, showTip, useTheme } from '../lib';

const LV_LABEL: Record<Lvl, string> = { CRIT: '치명', HIGH: '높음', MED: '보통', LOW: '낮음', OK: '이상 없음' };

/* ───────── 1) 라우트 스트립: 전체 스텝을 한 줄 히트맵으로 (수천 스텝도 한 화면) ───────── */
function Strip({ d, stage, onStage }: { d: Dossier; stage: string | null; onStage: (s: string | null) => void }) {
  const { tick } = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = 96, LANE = 22, Y1 = 18, Y2 = Y1 + LANE + 6;
  const N = d.steps.length;
  const [win, setWin] = useState<[number, number]>([0, N]);  // 보이는 스텝 구간 [a, b)
  useEffect(() => setWin([0, N]), [d, N]);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    const c = cv.current;
    if (!c || !w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = w * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, H);
    const [a, b] = win, n = b - a, bw = w / n;
    const col: Record<string, string> = { CRIT: cssVar('--crit'), HIGH: cssVar('--high'), MED: cssVar('--med'), LOW: cssVar('--aqua'), OK: cssVar('--ok') };
    const ink = cssVar('--ink-2'), line = cssVar('--line-hi'), fg2 = cssVar('--fg-2'), acc = cssVar('--accent');
    g.fillStyle = ink; g.fillRect(0, Y1, w, LANE); g.fillRect(0, Y2, w, LANE);
    d.steps.slice(a, b).forEach((s, i) => {
      const x = i * bw, ww = Math.max(bw, 1);
      if (s.risk_level !== 'OK') { g.globalAlpha = 1; g.fillStyle = col[s.risk_level]; g.fillRect(x, Y1, ww, LANE); }
      else { g.globalAlpha = 0.22; g.fillStyle = col.OK; g.fillRect(x, Y1, ww, LANE); }
      if (s.eqp_level !== 'OK') { g.globalAlpha = s.eqp_level === 'CRIT' ? 0.95 : 0.7; g.fillStyle = col[s.eqp_level]; g.fillRect(x, Y2, ww, LANE); }
      else { g.globalAlpha = 0.18; g.fillStyle = col.OK; g.fillRect(x, Y2, ww, LANE); }
      if (s.step_grade === 'A') { g.globalAlpha = 1; g.fillStyle = acc; g.fillRect(x, Y1 - 7, ww, 5); }
    });
    g.globalAlpha = 1;
    // 스테이지 경계·이름
    let i0 = 0;
    g.font = '11.5px "IBM Plex Sans KR", sans-serif'; g.textBaseline = 'top';
    d.stages.forEach((st) => {
      const s0 = Math.max(i0, a), s1 = Math.min(i0 + st.steps, b);
      if (s1 <= s0) { i0 += st.steps; return; }
      const x0 = (s0 - a) * bw, x1 = (s1 - a) * bw;
      g.fillStyle = line; g.fillRect(x0, Y1 - 2, 1, Y2 + LANE - Y1 + 18);
      if (stage === st.stage) {
        g.strokeStyle = acc; g.lineWidth = 2; g.strokeRect(x0 + 1, Y1 - 9, x1 - x0 - 2, Y2 + LANE - Y1 + 11);
        g.fillStyle = acc + '22'; g.fillRect(x0, Y1 - 9, x1 - x0, Y2 + LANE - Y1 + 11);
      }
      const label = st.stage.replace(/^BEOL /, '');
      g.fillStyle = stage === st.stage ? acc : fg2;
      if (g.measureText(label).width + 6 < x1 - x0) g.fillText(label, x0 + 4, Y2 + LANE + 6);
      i0 += st.steps;
    });
  }, [d, w, stage, tick, win]);

  const idxAt = (clientX: number) => {
    const r = cv.current!.getBoundingClientRect();
    return Math.max(win[0], Math.min(win[1] - 1, win[0] + Math.floor(((clientX - r.left) / r.width) * (win[1] - win[0]))));
  };
  const at = (e: { clientX: number }) => d.steps[idxAt(e.clientX)];
  const localX = (clientX: number) => clientX - cv.current!.getBoundingClientRect().left;
  const zoomed = win[0] > 0 || win[1] < N;
  return (
    <div className="strip" ref={wrap}>
      <div className="strip-lanes" aria-hidden="true"><span>★ A등급</span><span>공정 리스크</span><span>설비 노출</span></div>
      <div className="strip-cv">
        <canvas ref={cv} style={{ width: '100%', height: H }} role="img" aria-label={`스텝 ${win[0] + 1}~${win[1]} 리스크 띠. 위 줄은 스텝 자체 리스크, 아래 줄은 호환설비 리스크. 드래그하면 구간 확대, 더블클릭하면 전체`}
          onPointerDown={(e) => { if (e.button !== 0) return; moved.current = false; (e.target as Element).setPointerCapture(e.pointerId); setDrag({ x0: localX(e.clientX), x1: localX(e.clientX) }); }}
          onPointerMove={(e) => {
            if (drag) {
              const x1 = localX(e.clientX);
              if (Math.abs(x1 - drag.x0) > 5) moved.current = true;
              setDrag({ ...drag, x1 });
              hideTip();
              return;
            }
            const s = at(e);
            showTip(e, `<b>${String(s.seq).padStart(4, '0')} ${escHtml(s.step_name)}</b><br>${escHtml(s.stage)} · ${escHtml(s.module)} · ${s.step_grade}등급${s.measured ? ' · 타겟 관리' : ''}<br>공정 리스크 <b>${LV_LABEL[s.risk_level]}</b> · 설비 노출 <b>${LV_LABEL[s.eqp_level]}</b><br><span style="color:var(--muted)">누르면 스테이지 열기 · 드래그 구간 확대 · 더블클릭 전체</span>`);
          }}
          onPointerUp={() => {
            if (drag && moved.current) {
              const r = cv.current!.getBoundingClientRect();
              const i0 = idxAt(r.left + Math.min(drag.x0, drag.x1)), i1 = idxAt(r.left + Math.max(drag.x0, drag.x1)) + 1;
              if (i1 - i0 >= 3) setWin([i0, i1]);
            }
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          onMouseLeave={hideTip}
          onClick={(e) => { if (moved.current) { moved.current = false; return; } const s = at(e); onStage(stage === s.stage ? null : s.stage); hideTip(); }}
          onDoubleClick={() => { setWin([0, N]); hideTip(); }} />
        {drag && moved.current && <div className="zoom-box strip-zb" style={{ left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0) }} />}
        {zoomed && (
          <button className="zoom-reset" onClick={() => setWin([0, N])} title="더블클릭해도 원래대로">
            스텝 {d.steps[win[0]].seq}–{d.steps[win[1] - 1].seq} 확대 중 · 전체 보기
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── 2) 스테이지 노드 / 3) 스텝 노드 ───────── */
type SData = { st: Stage; sel: boolean };
type TData = { step: Step; sel: boolean; dim: boolean; mode: 'risk' | 'module' };

const StageNode = memo(({ data }: NodeProps<Node<SData, 'stage'>>) => {
  const st = data.st;
  const mods = Object.entries(st.modules);
  const own = st.risk_level;
  return (
    <div className={`stn ${own !== 'OK' ? own : ''} ${data.sel ? 'sel' : ''}`} title={`${st.stage} · 누르면 이 스테이지의 스텝을 펼칩니다`}>
      <Handle type="target" position={Position.Left} id="l" /><Handle type="target" position={Position.Right} id="r" /><Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="sr" /><Handle type="source" position={Position.Left} id="sl" /><Handle type="source" position={Position.Bottom} id="sb" />
      <div className="h"><span>{String(st.idx + 1).padStart(2, '0')}</span><span className="mono">{st.first_seq}–{st.last_seq}</span></div>
      <div className="t">{st.stage}</div>
      <div className="mods" aria-hidden="true">{mods.map(([m, c]) => <i key={m} style={{ flex: c, background: moduleVar(m) }} />)}</div>
      <div className="f">
        <span>{st.steps}스텝</span>{(st.grades.A ?? 0) > 0 && <span className="a">A {st.grades.A}</span>}<span>계측 {st.measured}</span>
      </div>
      <div className="lv2">
        <span><i style={{ background: sevColor(own) }} />공정 {LV_LABEL[own]}</span>
        <span><i style={{ background: sevColor(st.eqp_level) }} />설비 {LV_LABEL[st.eqp_level]}</span>
      </div>
      {st.risk_score > 0 && <span className="cnt" style={{ ['--c' as string]: sevColor(own) }}>{st.point_ids.length}</span>}
    </div>
  );
});

const StepNode = memo(({ data }: NodeProps<Node<TData, 'step'>>) => {
  const s = data.step, t = s.target, cpk = s.spc?.cpk;
  const lvl = data.mode === 'risk' ? s.risk_level : 'OK';
  return (
    <div className={['sn', lvl !== 'OK' ? lvl : '', data.sel ? 'sel' : '', data.dim ? 'dim' : ''].join(' ')}
      style={{ ['--mc' as string]: moduleVar(s.module), ...(data.mode === 'module' ? { borderColor: moduleVar(s.module) } : {}) }} title={`${s.step_name} · 두 번 누르면 상세`}>
      <Handle type="target" position={Position.Left} id="l" /><Handle type="target" position={Position.Right} id="r" /><Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="sr" /><Handle type="source" position={Position.Left} id="sl" /><Handle type="source" position={Position.Bottom} id="sb" />
      <div className="h"><span>{String(s.seq).padStart(4, '0')}</span><span className="md">{s.module}</span><span className={`gr g${s.step_grade}`}>{s.step_grade}</span></div>
      <div className="t">{s.step_name}</div>
      <div className="p">{t ? `${s.param} ${num(t.target)} (${num(t.lsl)}~${num(t.usl)}) ${t.unit ?? ''}` : s.recipe_id}</div>
      <div className="b">
        <span>설비 {s.compat.filter((c) => c.qualified).length}/{s.compat.length}</span>
        {s.eqp_level !== 'OK' && <span className={s.eqp_level === 'CRIT' ? 'r' : 'o'}>설비 {LV_LABEL[s.eqp_level]}</span>}
        {cpk != null && <span className={cpk < 1 ? 'r' : cpk < 1.33 ? 'o' : ''}>Cpk {cpk.toFixed(2)}</span>}
        {s.spec_revs > 0 && <span>Rev {s.target?.rev ?? s.spec_revs}</span>}
      </div>
      {s.risk_level !== 'OK' && <span className="cnt" style={{ ['--c' as string]: sevColor(s.risk_level) }}>!</span>}
    </div>
  );
});

const nodeTypes = { stage: StageNode, step: StepNode };

function snake<T>(items: T[], per: number, dx: number, dy: number) {
  return items.map((_, i) => { const r = Math.floor(i / per), c = i % per; return { x: (r % 2 === 0 ? c : per - 1 - c) * dx, y: r * dy }; });
}
function snakeEdges(ids: string[], per: number, hot: (i: number) => boolean): Edge[] {
  return ids.slice(1).map((id, k) => {
    const a = k, ra = Math.floor(a / per), rb = Math.floor((a + 1) / per), ltr = ra % 2 === 0;
    return { id: `e-${ids[a]}`, source: ids[a], target: id, type: 'smoothstep', animated: true,
      sourceHandle: ra !== rb ? 'sb' : ltr ? 'sr' : 'sl', targetHandle: ra !== rb ? 't' : ltr ? 'l' : 'r', className: hot(a + 1) ? 'hot' : undefined };
  });
}

type Props = {
  d: Dossier; stage: string | null; onStage: (s: string | null) => void; stepId: string | null; scopeEqps: Set<string> | null;
  onPick: (id: string | null) => void; onOpen: (id: string) => void; onDetail: () => void;
};

export default function RouteMap({ d, stage, onStage, stepId, scopeEqps, onPick, onOpen, onDetail }: Props) {
  const { tick, dark } = useTheme();
  const [mode, setMode] = useState<'risk' | 'module'>('risk');
  const [onlyRisk, setOnlyRisk] = useState(false);
  const st = d.stages.find((x) => x.stage === stage) ?? null;
  const rf = useRef<ReactFlowInstance | null>(null);
  const flowBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxMoved = useRef(false);
  const FIT = { padding: 0.08, maxZoom: 1.15 };
  const reset = useCallback(() => rf.current?.fitView({ ...FIT, duration: 450 }), []);  // eslint-disable-line react-hooks/exhaustive-deps
  const local = (e: { clientX: number; clientY: number }) => {
    const r = flowBox.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('.react-flow__controls, .react-flow__minimap, .zoom-reset')) return;
    boxMoved.current = false;
    const p = local(e);
    setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!box) return;
    const p = local(e);
    if (!boxMoved.current && Math.hypot(p.x - box.x0, p.y - box.y0) > 6) {
      boxMoved.current = true;
      flowBox.current?.setPointerCapture(e.pointerId);
    }
    if (boxMoved.current) setBox({ ...box, x1: p.x, y1: p.y });
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (box && boxMoved.current && rf.current) {
      const r = flowBox.current!.getBoundingClientRect();
      const a = rf.current.screenToFlowPosition({ x: r.left + Math.min(box.x0, box.x1), y: r.top + Math.min(box.y0, box.y1) });
      const b = rf.current.screenToFlowPosition({ x: r.left + Math.max(box.x0, box.x1), y: r.top + Math.max(box.y0, box.y1) });
      if (b.x - a.x > 20 && b.y - a.y > 20) rf.current.fitBounds({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, { padding: 0.02, duration: 400 });
      flowBox.current?.releasePointerCapture?.(e.pointerId);
    }
    setBox(null);
  };

  const { nodes, edges } = useMemo(() => {
    if (!st) {
      const per = 7, pos = snake(d.stages, per, 262, 172);
      const nodes: Node[] = d.stages.map((x, i) => ({ id: `st-${x.idx}`, type: 'stage', position: pos[i], data: { st: x, sel: false }, draggable: false }));
      return { nodes, edges: snakeEdges(nodes.map((n) => n.id), per, (i) => d.stages[i].risk_level === 'CRIT') };
    }
    let steps = d.steps.filter((s) => s.stage === st.stage);
    if (onlyRisk) steps = steps.filter((s) => s.risk_level !== 'OK' || s.eqp_level === 'CRIT' || s.step_grade === 'A');
    const per = 6, pos = snake(steps, per, 280, 172);
    const nodes: Node[] = steps.map((s, i) => ({
      id: s.step_id, type: 'step', position: pos[i], draggable: false,
      data: { step: s, sel: s.step_id === stepId, dim: !!scopeEqps && !s.compat.some((c) => scopeEqps.has(c.eqp_id)), mode },
    }));
    return { nodes, edges: snakeEdges(nodes.map((n) => n.id), per, (i) => steps[i].risk_level === 'CRIT') };
  }, [d, st, onlyRisk, stepId, scopeEqps, mode]);

  const mini = useMemo(() => {
    const m: Record<string, string> = { CRIT: cssVar('--crit'), HIGH: cssVar('--high'), MED: cssVar('--med'), LOW: cssVar('--aqua'), OK: cssVar('--line-hi') };
    return (n: Node) => m[(n.data as SData).st?.risk_level ?? (n.data as TData).step?.risk_level ?? 'OK'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const modules = useMemo(() => [...new Set(d.steps.map((s) => s.module))], [d]);
  const lv = (k: 'risk_level' | 'eqp_level') => d.steps.reduce<Record<string, number>>((a, s) => ((a[s[k]] = (a[s[k]] ?? 0) + 1), a), {});
  const own = lv('risk_level'), ex = lv('eqp_level');

  return (
    <section className="panel flow-p rise" style={{ ['--i' as string]: 2 }} aria-labelledby="h-flow">
      <div className="ph">
        <h2 id="h-flow"><span className="eyebrow">Process route</span>공정 라우트
          <span className="ph-note">{d.steps.length.toLocaleString()} 스텝 · {d.stages.length} 스테이지 · 띠나 스테이지를 누르면 그 구간의 스텝이 펼쳐집니다 · 드래그로 확대, 더블클릭으로 원래대로</span>
        </h2>
        <div className="ph-tools">
          <button className="btn" onClick={onDetail}>스텝 전체 표 →</button>
        </div>
      </div>
      <div className="strip-box">
        <Strip d={d} stage={stage} onStage={onStage} />
        <div className="flow-legend">
          <span><i style={{ background: 'var(--accent)' }} />A등급 {d.summary.kpis.grades.A}</span>
          <span><i style={{ background: 'var(--crit)' }} />치명</span><span><i style={{ background: 'var(--high)' }} />높음</span>
          <span><i style={{ background: 'var(--med)' }} />보통</span><span><i style={{ background: 'var(--aqua)' }} />낮음</span>
          <span className="muted">공정 리스크 스텝 {d.steps.length - (own.OK ?? 0)}개 · 설비 노출 스텝 {d.steps.length - (ex.OK ?? 0)}개</span>
        </div>
      </div>
      <div className="ph" style={{ paddingBlock: 10, borderTop: '1px solid var(--line)' }}>
        <nav className="crumb" aria-label="라우트 위치">
          <button className={`linkish${st ? '' : ' cur'}`} onClick={() => onStage(null)}>전체 스테이지 {d.stages.length}</button>
          {st && <><span className="sep">›</span><b>{st.stage}</b><span className="muted mono">{st.first_seq}–{st.last_seq} · {st.steps}스텝</span></>}
        </nav>
        <div className="ph-tools">
          {st ? (
            <>
              <button className="chip" aria-pressed={onlyRisk} onClick={() => setOnlyRisk(!onlyRisk)}>리스크·A등급 스텝만</button>
              <div className="seg" role="group" aria-label="노드 색 기준">
                <button aria-pressed={mode === 'risk'} onClick={() => setMode('risk')}>리스크</button>
                <button aria-pressed={mode === 'module'} onClick={() => setMode('module')}>공정 모듈</button>
              </div>
              <button className="btn" onClick={() => onStage(null)}>← 스테이지로</button>
            </>
          ) : (
            <div className="flow-legend">{modules.map((m) => <span key={m}><i style={{ background: `var(${MODULE_VAR[m] ?? '--muted'})` }} />{m}</span>)}</div>
          )}
        </div>
      </div>
      <div className={`flow zoomable${box && boxMoved.current ? ' boxing' : ''}`} ref={flowBox} style={{ height: Math.min(1000, Math.max(420, Math.ceil(nodes.length / (st ? 6 : 7)) * 178 + 90)) }}
        onPointerDownCapture={onDown} onPointerMoveCapture={onMove} onPointerUpCapture={onUp} onPointerCancel={() => setBox(null)}
        onClickCapture={(e) => { if (boxMoved.current) { e.stopPropagation(); boxMoved.current = false; } }}>
        <ReactFlow key={st?.stage ?? 'stages'} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={FIT} minZoom={0.2} maxZoom={2.5}
          onInit={(inst) => { rf.current = inst as unknown as ReactFlowInstance; }}
          zoomOnScroll={false} zoomOnPinch={false} panOnScroll={false} preventScrolling={false} zoomOnDoubleClick={false} panOnDrag={false} selectionOnDrag={false}
          nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} colorMode={dark ? 'dark' : 'light'}
          onNodeClick={(_, n) => { if (n.type === 'stage') onStage((n.data as SData).st.stage); else onPick(n.id === stepId ? null : n.id); }}
          onNodeDoubleClick={(_, n) => { if (n.type === 'step') onOpen(n.id); else reset(); }}
          onDoubleClick={(e) => { if (!(e.target as Element).closest('.react-flow__node')) reset(); }}>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={cssVar('--line-hi')} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable nodeColor={mini} nodeStrokeWidth={0} position="bottom-right" style={{ width: 160, height: 96 }} />
        </ReactFlow>
        {box && boxMoved.current && <div className="zoom-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
        <span className="zoom-hint" aria-hidden="true">드래그: 영역 확대 · 더블클릭: 원래대로</span>
        {st && nodes.length === 0 && <div className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>이 스테이지에는 리스크·A등급 스텝이 없습니다.</div>}
      </div>
    </section>
  );
}
