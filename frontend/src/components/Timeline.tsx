import { useMemo } from 'react';
import type { Dossier } from '../types';
import type { Scope } from '../scope';
import { cssVar, escHtml, useTheme } from '../lib';
import EChart from './EChart';

const LANES = ['타겟표준 개정', '설비·레시피 변경', 'PM', 'BM', '인터락'];
const t = (s: string) => { const v = s.replace(' ', 'T'); return new Date(v.length === 16 ? v + ':00' : v).getTime(); };
const p2 = (n: number) => String(n).padStart(2, '0');
const fmtMs = (ms: number) => { const x = new Date(ms); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())} ${p2(x.getHours())}:${p2(x.getMinutes())}`; };

export default function Timeline({ d, scope }: { d: Dossier; scope: Scope }) {
  const { tick } = useTheme();
  const flagged = useMemo(() => new Set(d.risk_points.flatMap((p) => p.refs)), [d]);

  const option = useMemo(() => {
    const C = { crit: cssVar('--crit'), high: cssVar('--high'), med: cssVar('--med'), ok: cssVar('--ok'), aqua: cssVar('--aqua'), vio: cssVar('--violet'), fg2: cssVar('--fg-2'), muted: cssVar('--muted'), line: cssVar('--line'), lineHi: cssVar('--line-hi'), acc: cssVar('--accent') };
    const end = t(d.as_of), start = end - d.window_days * 864e5;
    type P = { value: [number, number]; tip: string; color: string; size: number; flag: boolean; symbol?: string };
    const pts: P[] = [];
    const jitter = (k: string) => { let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) | 0; return ((h % 100) / 100) * 0.5 - 0.25; };
    for (const c of scope.targetChanges) {
      const x = t(c.changed_at); if (x < start) continue;
      const widen = (c.usl_after ?? 0) - (c.lsl_after ?? 0) > (c.usl_before ?? 0) - (c.lsl_before ?? 0);
      pts.push({ value: [x, 0 + jitter(c.change_id)], color: widen ? C.crit : C.vio, size: widen ? 18 : 11, flag: widen, symbol: 'diamond',
        tip: `<b>${escHtml(c.change_id)}</b> Rev.${c.rev}<br>${escHtml(c.param)} LSL ${c.lsl_before}→${c.lsl_after}, USL ${c.usl_before}→${c.usl_after}<br>${escHtml(c.reason)}<br>요청 ${escHtml(c.requested_by)} · 승인 ${escHtml(c.approved_by || '없음')}` });
    }
    for (const c of scope.changes) {
      const bad = !c.approved_by || c.approved_by === c.requested_by;
      pts.push({ value: [t(c.changed_at), 1 + jitter(c.change_id)], color: bad ? C.crit : C.aqua, size: bad ? 15 : 9, flag: flagged.has(c.change_id), symbol: 'rect',
        tip: `<b>${escHtml(c.eqp_id)}</b> ${escHtml(c.category)}<br>${escHtml(c.item)} ${escHtml(c.before)} → ${escHtml(c.after)}<br>요청 ${escHtml(c.requested_by)} · 승인 ${escHtml(c.approved_by || '없음')} · 검증 ${escHtml(c.verify_status)}` });
    }
    for (const m of scope.maintenance) {
      const lane = m.mt_type === 'PM' ? 2 : 3;
      const bad = (m.lots_before_qual ?? 0) > 0 || m.qual_result === 'FAIL' || m.qual_result === 'PENDING';
      pts.push({ value: [t(m.start_at), lane + jitter(m.mt_id)], color: bad ? C.crit : lane === 2 ? C.ok : C.high, size: bad ? 16 : lane === 2 ? 6 : 10, flag: bad, symbol: lane === 2 ? 'circle' : 'triangle',
        tip: `<b>${escHtml(m.eqp_id)}</b> ${m.mt_type} · ${escHtml(m.reason)}<br>교체 ${escHtml(m.parts)} · Qual ${escHtml(m.qual_result)}${m.lots_before_qual ? `<br><span style="color:${C.crit}">Qual 전 LOT ${m.lots_before_qual}개 진행</span>` : ''}` });
    }
    for (const i of scope.interlocks) {
      const forced = i.release_type === '강제 해제' && !!i.released_at;
      const color = forced || !i.released_at ? C.crit : i.severity === 'CRIT' ? C.crit : i.severity === 'MAJOR' ? C.high : C.med;
      pts.push({ value: [t(i.occurred_at), 4 + jitter(i.interlock_id)], color, size: forced ? 15 : i.severity === 'CRIT' ? 10 : 7, flag: forced || flagged.has(i.interlock_id),
        symbol: forced ? 'pin' : 'circle',
        tip: `<b>${escHtml(i.eqp_id)}</b> ${escHtml(i.il_code)} · ${escHtml(i.severity)}<br>${escHtml(i.description)}<br>${i.released_at ? `${escHtml(i.release_type)} (${escHtml(i.released_by)})` : '<b>미해제</b>'}${i.lot_id ? `<br>LOT ${escHtml(i.lot_id)}` : ''}` });
    }
    return {
      grid: { left: 8, right: 18, top: 16, bottom: 56, containLabel: true },
      tooltip: {
        trigger: 'item', backgroundColor: cssVar('--tip'), borderColor: C.lineHi, textStyle: { color: C.fg2, fontSize: 13.5 },
        formatter: (p: { data: P }) => `<span style="font-family:IBM Plex Mono;color:${C.muted}">${fmtMs(p.data.value[0])}</span><br>${p.data.tip}`,
      },
      xAxis: { type: 'time', min: start, max: end, splitLine: { show: true, lineStyle: { color: C.line } }, axisLine: { lineStyle: { color: C.lineHi } },
        axisLabel: { color: C.muted, fontSize: 12, fontFamily: 'IBM Plex Mono', formatter: '{MM}-{dd}' } },
      yAxis: { type: 'value', min: -0.5, max: 4.5, interval: 1, inverse: true, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
        splitArea: { show: true, areaStyle: { color: [cssVar('--ink'), 'transparent'] } },
        axisLabel: { color: C.fg2, fontSize: 13.5, formatter: (v: number) => LANES[v] ?? '' } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'slider', xAxisIndex: 0, height: 22, bottom: 10, borderColor: C.line, fillerColor: C.acc + '22',
        handleStyle: { color: C.acc }, textStyle: { color: C.muted, fontSize: 11.5 }, dataBackground: { lineStyle: { color: C.lineHi }, areaStyle: { color: C.lineHi } } }],
      series: [{
        type: 'scatter',
        data: pts.map((p) => ({ ...p, symbol: p.symbol, symbolSize: p.size, itemStyle: { color: p.color, opacity: p.flag ? 1 : 0.75, shadowBlur: p.flag ? 16 : 0, shadowColor: p.color, borderColor: p.flag ? '#fff' : 'transparent', borderWidth: p.flag ? 1 : 0 } })),
        emphasis: { scale: 1.6 },
        markLine: { silent: true, symbol: 'none', label: { formatter: '기준 시각', color: C.acc, fontSize: 12, fontFamily: 'IBM Plex Mono' }, lineStyle: { color: C.acc, type: 'dashed' }, data: [{ xAxis: end }] },
        animationDelay: (i: number) => i * 3,
      }],
    };
  }, [d, scope, tick, flagged]);

  const n = scope.targetChanges.length + scope.changes.length + scope.maintenance.length + scope.interlocks.length;
  return (
    <section className="panel rise" aria-labelledby="h-tl">
      <div className="ph">
        <h2 id="h-tl"><span className="eyebrow">Event swimlane</span>이력 타임라인 <span className="ph-note">{n}건 · 큰 점·흰 테두리 = 리스크 포인트 근거 · 휠/슬라이더로 기간 확대</span></h2>
        <div className="flow-legend">
          <span><i style={{ background: 'var(--violet)' }} />스펙 개정</span><span><i style={{ background: 'var(--aqua)' }} />변경</span>
          <span><i style={{ background: 'var(--ok)' }} />PM</span><span><i style={{ background: 'var(--high)' }} />BM</span><span><i style={{ background: 'var(--crit)' }} />부적정·강제 해제</span>
        </div>
      </div>
      <EChart className="tl-chart" option={option} ariaLabel="타겟표준 개정, 변경, PM, BM, 인터락 이력 타임라인" />
    </section>
  );
}
