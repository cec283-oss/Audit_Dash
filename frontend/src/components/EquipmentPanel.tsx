import { useMemo } from 'react';
import type { Dossier, Eqp } from '../types';
import type { EqpFilter, Group, Scope } from '../scope';
import { cssVar, escHtml, fmtD, useTheme } from '../lib';
import EChart from './EChart';

type Row = {
  key: string; label: string; sub: string; ids: string[]; il: number; forced: number; active: number; bm: number; pm: number; chg: number;
  unapproved: number; pmOver: number; score: number; weekly: number[]; status: string;
};

function aggregate(list: Eqp[], group: Group): Row[] {
  const m = new Map<string, Row>();
  for (const e of list) {
    const key = group === 'eqp' ? e.eqp_id : e.eqp_model;
    const r = m.get(key) ?? {
      key, label: key, sub: group === 'eqp' ? `${e.eqp_model} · ${e.maker ?? ''}` : `${e.maker ?? ''}`, ids: [], il: 0, forced: 0, active: 0, bm: 0, pm: 0, chg: 0,
      unapproved: 0, pmOver: 0, score: 0, weekly: e.il_weekly.map(() => 0), status: e.status ?? '',
    };
    r.ids.push(e.eqp_id);
    r.il += e.il_window; r.forced += e.il_forced; r.active += e.il_active; r.bm += e.bm_window; r.pm += e.pm_window; r.chg += e.changes_window;
    r.unapproved += e.unapproved; r.pmOver = Math.max(r.pmOver, e.pm_overdue_days); r.score += e.risk_score;
    e.il_weekly.forEach((v, i) => (r.weekly[i] += v));
    if (group === 'model') r.sub = `${e.maker ?? ''} · ${r.ids.length}대`;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => b.score - a.score || b.il - a.il);
}

type Props = { d: Dossier; scope: Scope; stepId: string | null; group: Group; setGroup: (g: Group) => void; eqp: EqpFilter; onEqp: (f: EqpFilter) => void };

export default function EquipmentPanel({ d, scope, stepId, group, setGroup, eqp, onEqp }: Props) {
  const { tick } = useTheme();
  const base = useMemo(() => (stepId ? d.equipment.filter((e) => d.steps.find((s) => s.step_id === stepId)?.compat.some((c) => c.eqp_id === e.eqp_id)) : d.equipment), [d, stepId]);
  const rows = useMemo(() => aggregate(base, group), [base, group]);
  const top = useMemo(() => rows.slice(0, 16), [rows]);
  const selKey = eqp && eqp.kind === group ? eqp.id : null;

  const option = useMemo(() => {
    const c = { il: cssVar('--crit'), bm: cssVar('--high'), pm: cssVar('--aqua'), chg: cssVar('--violet'), fg2: cssVar('--fg-2'), muted: cssVar('--muted'), line: cssVar('--line'), acc: cssVar('--accent') };
    const y = [...top].reverse();
    const ser = (name: string, key: 'il' | 'bm' | 'pm' | 'chg', color: string) => ({
      name, type: 'bar', stack: 't', barMaxWidth: 16, emphasis: { focus: 'series' },
      itemStyle: { color, borderRadius: 2, shadowBlur: 8, shadowColor: color + '66' },
      data: y.map((r) => ({ value: r[key], itemStyle: { opacity: !selKey || r.key === selKey ? 1 : 0.25 } })),
    });
    return {
      grid: { left: 8, right: 26, top: 34, bottom: 8, containLabel: true },
      legend: { top: 4, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: c.fg2, fontSize: 13 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: cssVar('--tip'), borderColor: cssVar('--line-hi'), textStyle: { color: c.fg2, fontSize: 13.5 },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = y[ps[0].dataIndex];
          return `<b>${escHtml(r.label)}</b> <span style="color:${c.muted}">${escHtml(r.sub)}</span><br>인터락 ${r.il} (강제 해제 ${r.forced}, 미해제 ${r.active})<br>BM ${r.bm} · PM ${r.pm}<br>변경 ${r.chg} (미승인·자기승인 ${r.unapproved})${r.pmOver ? `<br><span style="color:${c.bm}">PM 주기 ${r.pmOver.toFixed(0)}일 초과</span>` : ''}<br>리스크 점수 ${r.score}`;
        },
      },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: c.line } }, axisLabel: { color: c.muted, fontSize: 12, fontFamily: 'IBM Plex Mono' } },
      yAxis: {
        type: 'category', data: y.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: c.line } },
        axisLabel: { fontFamily: 'IBM Plex Mono', fontSize: 12.5, color: (v: string) => (v === selKey ? c.acc : c.fg2), formatter: (v: string) => (y.find((r) => r.label === v)?.score ? `● ${v}` : v) },
      },
      series: [ser('인터락', 'il', c.il), ser('BM', 'bm', c.bm), ser('PM', 'pm', c.pm), ser('변경', 'chg', c.chg)],
      animationDuration: 900,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, tick, selKey]);

  const wmax = Math.max(1, ...rows.flatMap((r) => r.weekly));

  return (
    <section className="panel rise" style={{ ['--i' as string]: 1 }} aria-labelledby="h-eq">
      <div className="ph">
        <h2 id="h-eq"><span className="eyebrow">Equipment</span>호환설비 이력 집계 <span className="ph-note">최근 {d.window_days}일 · {stepId ? '선택 스텝' : '공법 전체'} {base.length}대</span></h2>
        <div className="seg" role="group" aria-label="집계 기준">
          <button aria-pressed={group === 'eqp'} onClick={() => setGroup('eqp')}>호환설비<b>{base.length}</b></button>
          <button aria-pressed={group === 'model'} onClick={() => setGroup('model')}>설비 모델<b>{new Set(base.map((e) => e.eqp_model)).size}</b></button>
        </div>
      </div>
      <EChart className="eq-chart" option={option} ariaLabel="호환설비별 인터락, BM, PM, 변경 건수 막대 차트"
        onClick={(p) => { const r = [...top].reverse()[p.dataIndex]; if (r) onEqp({ kind: group, id: r.key }); }} />
      <div className="tbl-wrap eq-tbl">
        <table>
          <thead><tr><th>{group === 'eqp' ? '설비' : '모델'}</th><th>주별 인터락 ({Math.ceil(d.window_days / 7)}주)</th><th className="num">강제 해제</th><th className="num">미해제</th><th className="num">PM 초과</th><th className="num">부적정 변경</th><th>{group === 'eqp' ? '상태 · 최근 PM' : '대수'}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const e = group === 'eqp' ? d.equipment.find((x) => x.eqp_id === r.key) : null;
              return (
                <tr key={r.key} className={r.forced || r.unapproved ? 'flag' : r.pmOver ? 'warn' : ''} style={{ cursor: 'pointer', background: r.key === selKey ? 'var(--accent-a)' : undefined }}
                  onClick={() => onEqp({ kind: group, id: r.key })}>
                  <td className="mono">{r.label}<div className="muted" style={{ fontSize: 12 }}>{r.sub}</div></td>
                  <td><span className="spark-cells" aria-label={`주별 인터락 ${r.weekly.join(', ')}`}>{r.weekly.map((v, i) => <i key={i} style={{ ['--o' as string]: v ? 0.2 + (0.8 * v) / wmax : 0.06 }} />)}</span></td>
                  <td className="num" style={{ color: r.forced ? 'var(--crit)' : undefined }}>{r.forced}</td>
                  <td className="num">{r.active}</td>
                  <td className="num" style={{ color: r.pmOver ? 'var(--high)' : undefined }}>{r.pmOver ? `${r.pmOver.toFixed(0)}일` : '-'}</td>
                  <td className="num" style={{ color: r.unapproved ? 'var(--crit)' : undefined }}>{r.unapproved}</td>
                  <td>{e ? <><span className={`status ${e.status}`}>{e.status}</span> <span className="mono muted">{fmtD(e.last_pm_at)}</span></> : <span className="mono">{r.ids.length}대</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scope.active && <p className="formula" style={{ paddingTop: 10 }}>막대나 행을 다시 누르면 설비 선택이 풀립니다.</p>}
    </section>
  );
}
