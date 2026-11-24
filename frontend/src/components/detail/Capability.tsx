import { useEffect, useMemo, useState } from 'react';
import type { CapGrade, Dossier, Step } from '../../types';
import { cssVar, fmtN, num, useTheme } from '../../lib';
import EChart from '../EChart';

/* ───── 통계 ───── */
const erf = (x: number) => { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
export const capOf = (mu: number, sw: number, so: number, L: number, U: number) => ({
  cp: (U - L) / (6 * sw), cpk: Math.min(U - mu, mu - L) / (3 * sw),
  pp: (U - L) / (6 * so), ppk: Math.min(U - mu, mu - L) / (3 * so),
  ppm: (Phi((L - mu) / so) + 1 - Phi((U - mu) / so)) * 1e6,
});
const oocPct = (mu: number, s: number, lcl: number, ucl: number) => (Phi((lcl - mu) / s) + 1 - Phi((ucl - mu) / s)) * 100;
const r2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '-' : v.toFixed(2));
const ppmTxt = (v: number) => (v < 0.01 ? '0' : v < 10 ? v.toFixed(2) : fmtN(Math.round(v)));
/** 판정 기준값: 백엔드 risk.py 의 TTTM_LIMIT 를 그대로 씀 (없으면 기본값) */
export const tl = (d: Dossier) => {
  const t = d.limits?.tttm;
  return { ms: t?.ms_med ?? 1.0, msH: t?.ms_high ?? 1.5, sr: t?.sr_med ?? 1.2, srH: t?.sr_high ?? 1.5 };
};
const capCls = (v: number | null | undefined, req = 1.33) => (v == null ? '' : v < 1 ? 'bad' : v < req ? 'mid' : 'good');

/* ───── 1) 등급별 공정능력 ───── */
export function CapGrades({ d, grade, onGrade }: { d: Dossier; grade: string; onGrade: (g: string) => void }) {
  const k = d.summary.kpis;
  const cards: [string, string, CapGrade | undefined][] = [['', '전체', k.cap_all], ['A', 'A등급 (핵심)', k.cap_by_grade?.A], ['B', 'B등급 (주요)', k.cap_by_grade?.B], ['C', 'C등급 (일반)', k.cap_by_grade?.C]];
  return (
    <section className="panel rise" aria-labelledby="h-capg">
      <div className="ph"><h2 id="h-capg"><span className="eyebrow">Capability</span>스텝 등급별 공정능력</h2>
        <span className="ph-note">Cp·Cpk = 군내(단기) σ · Pp·Ppk = 전체(장기) σ · 요구치는 등급별 Cpk 기준 · 카드를 누르면 아래 목록·시뮬레이션이 그 등급으로 좁혀집니다</span></div>
      <div className="capg">
        {cards.map(([g, name, c]) => {
          const bad = (c?.below_req ?? 0) > 0;
          return (
            <button key={name} className={`capg-c${grade === g ? ' on' : ''}${bad ? ' bad' : ' ok'}`} onClick={() => onGrade(g)} disabled={!c?.steps}>
              <div className="h"><b>{name}</b>{c?.req != null && <span className="req">요구 Cpk ≥ {c.req.toFixed(2)}</span>}<span className="n">{c?.steps ?? 0}개 계측 스텝</span></div>
              {c?.steps ? (
                <>
                  <div className="idx">
                    {(['cp', 'cpk', 'pp', 'ppk'] as const).map((x) => (
                      <span key={x} className={capCls(c[x], c.req ?? 1.33)}><small>{x === 'cp' ? 'Cp' : x === 'cpk' ? 'Cpk' : x === 'pp' ? 'Pp' : 'Ppk'}</small><b>{r2(c[x])}</b></span>
                    ))}
                  </div>
                  <div className="f">
                    <span>최저 Cpk <b className={capCls(c.min_cpk, c.req ?? 1.33)}>{r2(c.min_cpk)}</b></span>
                    <span>요구 미달 <b className={c.below_req ? 'bad' : 'good'}>{c.below_req}</b></span>
                    <span>Cpk&lt;1.0 <b className={c.below_1 ? 'bad' : 'good'}>{c.below_1}</b></span>
                    <span>Ppk&lt;1.33 <b className={c.ppk_below_133 ? 'mid' : 'good'}>{c.ppk_below_133}</b></span>
                  </div>
                </>
              ) : <p className="muted">계측 스텝 없음</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ───── 2) 설비별 공정능력 · TTTM ───── */
export function Tttm({ d, grade, onPick }: { d: Dossier; grade: string; onPick: (stepId: string) => void }) {
  const L = tl(d);
  const { dark, tick } = useTheme();
  const steps = d.steps.filter((s) => s.tttm?.length && (!grade || s.step_grade === grade));
  const pairs = steps.flatMap((s) => s.tttm.map((x) => ({ s, x })));
  const tools = useMemo(() => {
    const m = new Map<string, { eqp: string; model?: string; rows: typeof pairs }>();
    for (const p of pairs) {
      if (!m.has(p.x.eqp_id)) m.set(p.x.eqp_id, { eqp: p.x.eqp_id, model: d.equipment.find((e) => e.eqp_id === p.x.eqp_id)?.eqp_model, rows: [] });
      m.get(p.x.eqp_id)!.rows.push(p);
    }
    return [...m.values()].map((t) => {
      const cpks = t.rows.map((r) => r.x.cpk).filter((v): v is number => v != null);
      const ms = t.rows.reduce((a, r) => (Math.abs(r.x.ms ?? 0) > Math.abs(a.x.ms ?? 0) ? r : a), t.rows[0]);
      const sr = t.rows.reduce((a, r) => ((r.x.sr ?? 0) > (a.x.sr ?? 0) ? r : a), t.rows[0]);
      return { ...t, flagged: t.rows.filter((r) => r.x.flag).length, minCpk: cpks.length ? Math.min(...cpks) : null, avgCpk: cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null, ms, sr };
    }).sort((a, b) => b.flagged - a.flagged || Math.abs(b.ms.x.ms ?? 0) - Math.abs(a.ms.x.ms ?? 0));
  }, [pairs, d.equipment]);

  const [tab, setTab] = useState<'item' | 'tool'>('item');
  const [onlyBad, setOnlyBad] = useState(false);
  const [limit, setLimit] = useState(20);
  const items = useMemo(() => steps.filter((s) => s.tttm.length >= 2)
    .map((s) => ({ s, bad: s.tttm.filter((x) => x.flag).length, worst: Math.max(...s.tttm.map((x) => Math.max(Math.abs(x.ms ?? 0) / L.ms, (x.sr ?? 0) / L.sr))) }))
    .filter((x) => !onlyBad || x.bad)
    .sort((a, b) => b.bad - a.bad || b.worst - a.worst), [steps, onlyBad]);

  const [sel, setSel] = useState<{ step: string; eqp: string | null } | null>(null);
  const cur = items.find((x) => x.s.step_id === sel?.step)?.s ?? items[0]?.s;
  const curEqp = sel && cur && sel.step === cur.step_id ? sel.eqp : (cur?.tttm.find((x) => x.flag)?.eqp_id ?? null);

  const chart = useMemo(() => {
    const mute = cssVar('--muted'), grid = cssVar('--line'), fg = cssVar('--fg-2');
    const col = (f: string | null) => cssVar(f === 'CRIT' ? '--crit' : f === 'HIGH' ? '--high' : f === 'MED' ? '--med' : '--aqua');
    return {
      animationDuration: 600,
      grid: { left: 52, right: 20, top: 26, bottom: 46 },
      tooltip: {
        backgroundColor: cssVar('--panel'), borderColor: grid, textStyle: { color: fg, fontSize: 13 },
        formatter: (p: { data: { s: Step; x: Step['tttm'][number] } }) => `<b>${p.data.s.step_name}</b> <span style="opacity:.7">${p.data.s.step_id}</span> · ${p.data.s.param}<br>설비 <b>${p.data.x.eqp_id}</b> · ${p.data.s.step_grade}등급<br>M/S <b>${r2(p.data.x.ms)}</b> · S/R <b>${r2(p.data.x.sr)}</b> · 설비 Cpk <b>${r2(p.data.x.cpk)}</b><br><span style="opacity:.7">누르면 이 스텝 아이템·설비를 비교</span>`,
      },
      xAxis: { type: 'value', name: 'M/S (평균 이동, σ 배수)', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: mute }, axisLabel: { color: mute }, splitLine: { lineStyle: { color: grid } }, min: (v: { min: number }) => Math.min(-L.msH - 0.2, Math.floor(v.min * 2) / 2), max: (v: { max: number }) => Math.max(L.msH + 0.2, Math.ceil(v.max * 2) / 2) },
      yAxis: { type: 'value', name: 'S/R (산포 비)', nameTextStyle: { color: mute }, axisLabel: { color: mute }, splitLine: { lineStyle: { color: grid } }, min: (v: { min: number }) => Math.min(0.6, Math.floor(v.min * 10) / 10 - 0.05), max: (v: { max: number }) => Math.max(L.srH + 0.2, Math.ceil(v.max * 10) / 10) },
      series: [{
        type: 'scatter', cursor: 'pointer',
        data: pairs.map((p) => {
          const on = cur && p.s.step_id === cur.step_id, me = on && p.x.eqp_id === curEqp;
          return {
            value: [p.x.ms ?? 0, p.x.sr ?? 1], s: p.s, x: p.x, symbolSize: me ? 22 : on ? 16 : p.x.flag ? 10 : 7, z: on ? 10 : 1,
            label: { show: !!on, formatter: p.x.eqp_id, position: 'right', color: fg, fontSize: 12, fontFamily: 'IBM Plex Mono', fontWeight: me ? 700 : 400 },
            itemStyle: on
              ? { color: p.x.flag ? col(p.x.flag) : cssVar('--ok'), opacity: 1, borderColor: me ? cssVar('--fg') : 'transparent', borderWidth: me ? 2.5 : 0, shadowBlur: 16, shadowColor: p.x.flag ? col(p.x.flag) : cssVar('--ok') }
              : { color: p.x.flag ? col(p.x.flag) : cssVar('--aqua'), opacity: cur ? 0.18 : 0.45 },
          };
        }),
        markArea: { silent: true, itemStyle: { color: cssVar('--ok-a') }, data: [[{ xAxis: -L.ms, yAxis: 0 }, { xAxis: L.ms, yAxis: L.sr }]] },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: cssVar('--high') }, label: { color: cssVar('--high'), fontSize: 11 },
          data: [{ xAxis: -L.ms, label: { formatter: `M/S −${L.ms}` } }, { xAxis: L.ms, label: { formatter: `M/S +${L.ms}` } }, { yAxis: L.sr, label: { formatter: `S/R ${L.sr}` } },
            { xAxis: -L.msH, lineStyle: { color: cssVar('--crit') }, label: { show: false } }, { xAxis: L.msH, lineStyle: { color: cssVar('--crit') }, label: { show: false } }, { yAxis: L.srH, lineStyle: { color: cssVar('--crit') }, label: { formatter: String(L.srH), color: cssVar('--crit') } }],
        },
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, dark, tick, cur, curEqp, L.ms, L.msH, L.sr, L.srH]);

  const cmp = useMemo(() => {
    if (!cur?.target || cur.target.lsl == null || cur.target.usl == null) return null;
    const t = cur.target, sp = cur.spc!;
    const me = cur.tttm.find((x) => x.eqp_id === curEqp) ?? null;
    const others = cur.tttm.filter((x) => x.eqp_id !== me?.eqp_id);
    const n_o = others.reduce((a, x) => a + (x.n ?? 0), 0) || 1;
    const mu_o = others.reduce((a, x) => a + (x.n ?? 0) * (x.mean ?? 0), 0) / n_o;
    const sw_o = Math.sqrt(others.reduce((a, x) => a + (x.n ?? 0) * (x.sigma_within ?? 0) ** 2, 0) / n_o);
    const cpk_o = Math.min(t.usl! - mu_o, mu_o - t.lsl!) / (3 * sw_o);
    const sds = cur.tttm.map((x) => x.sigma_within ?? sp.sigma_within ?? 1);
    const lo = Math.min(t.lsl!, ...cur.tttm.map((x, i) => (x.mean ?? 0) - 4 * sds[i])), hi = Math.max(t.usl!, ...cur.tttm.map((x, i) => (x.mean ?? 0) + 4 * sds[i]));
    const xs = Array.from({ length: 161 }, (_, i) => lo + ((hi - lo) * i) / 160);
    const pal = [cssVar('--aqua'), cssVar('--violet'), cssVar('--m-cmp'), cssVar('--m-clean'), cssVar('--m-imp')];
    const option = {
      animation: false,
      grid: { left: 16, right: 16, top: 34, bottom: 34 },
      legend: { top: 4, left: 8, textStyle: { color: cssVar('--fg-2'), fontSize: 12 }, itemWidth: 14, itemHeight: 8 },
      tooltip: { trigger: 'axis', backgroundColor: cssVar('--panel'), borderColor: cssVar('--line'), textStyle: { color: cssVar('--fg-2') }, valueFormatter: (v: number) => v.toFixed(3) },
      xAxis: { type: 'value', min: lo, max: hi, axisLabel: { color: cssVar('--muted'), formatter: (v: number) => num(v, 3) }, splitLine: { show: false } },
      yAxis: { type: 'value', show: false },
      series: cur.tttm.map((x, i) => {
        const isMe = x.eqp_id === me?.eqp_id, c = x.flag ? cssVar(x.flag === 'CRIT' ? '--crit' : x.flag === 'HIGH' ? '--high' : '--med') : pal[i % pal.length];
        return {
          name: x.eqp_id, type: 'line', smooth: true, symbol: 'none',
          data: xs.map((v) => [v, Math.exp(-0.5 * ((v - (x.mean ?? 0)) / sds[i]) ** 2) / (sds[i] * Math.sqrt(2 * Math.PI))]),
          lineStyle: { color: c, width: isMe ? 3.5 : 1.6, opacity: me && !isMe ? 0.55 : 1, type: isMe || !me ? 'solid' : 'dashed' },
          areaStyle: isMe ? { color: c, opacity: 0.18 } : undefined, z: isMe ? 5 : 2,
          markLine: i === 0 ? {
            silent: true, symbol: 'none',
            data: [
              { xAxis: t.lsl, lineStyle: { color: cssVar('--crit'), width: 2 }, label: { formatter: 'LSL', color: cssVar('--crit') } },
              { xAxis: t.usl, lineStyle: { color: cssVar('--crit'), width: 2 }, label: { formatter: 'USL', color: cssVar('--crit') } },
              ...(t.target != null ? [{ xAxis: t.target, lineStyle: { color: cssVar('--accent'), type: 'dotted' }, label: { formatter: 'T', color: cssVar('--accent') } }] : []),
              ...(me ? [{ xAxis: mu_o, lineStyle: { color: cssVar('--fg-2'), type: 'dashed' }, label: { formatter: '나머지 평균', color: cssVar('--fg-2') } }] : []),
            ],
          } : undefined,
        };
      }),
    };
    return { option, me, others, mu_o, sw_o, cpk_o, t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, curEqp, dark, tick]);

  if (!pairs.length) return null;
  return (
    <div className="cap-duo">
      <section className="panel rise" aria-labelledby="h-tttm">
        <div className="ph"><h2 id="h-tttm"><span className="eyebrow">Output TTTM</span>스텝 아이템별 설비 출력 비교</h2>
          <div className="ph-tools">
            <div className="seg" role="group" aria-label="보기 기준">
              <button aria-pressed={tab === 'item'} onClick={() => setTab('item')}>스텝 아이템별</button>
              <button aria-pressed={tab === 'tool'} onClick={() => setTab('tool')}>설비 기준 요약</button>
            </div>
            {tab === 'item' && <button className="chip" aria-pressed={onlyBad} onClick={() => setOnlyBad(!onlyBad)}><i style={{ background: 'var(--crit)' }} />매칭 이상만</button>}
          </div>
        </div>
        <p className="ttm-note">
          {tab === 'item'
            ? <>스텝 아이템(공정 스텝 × 계측 파라미터)마다 <b>설비별로 Cp·Cpk·Pp·Ppk 를 따로 구해</b> 설비 간 차이를 봅니다 · <b>M/S</b> = (설비 평균 − 나머지 설비 평균) / 나머지 σ군내 → 평균 차이, <b>S/R</b> = 설비 σ군내 / 나머지 σ군내 → 산포 차이 · 기준 |M/S| ≥ {L.ms}, S/R ≥ {L.sr} · 막대 = 설비별 평균 ± 3σ, 빨간 선 = 규격 · 호환설비 2대 이상 {items.length}개 아이템</>
            : <>설비마다 그 설비가 진행한 스텝 아이템들의 결과를 모은 <b>참고용 요약</b>입니다. 매칭 판정은 스텝 아이템 안에서만 합니다.</>}
        </p>
        {tab === 'item' ? (
          <div className="ttm-list">
            {items.slice(0, limit).map(({ s, bad }) => {
              const t = s.target!, sp = s.spc!;
              const xs = s.tttm.flatMap((x) => [(x.mean ?? 0) - 3 * (x.sigma_within ?? 0), (x.mean ?? 0) + 3 * (x.sigma_within ?? 0)]);
              const lo = Math.min(t.lsl ?? Infinity, ...xs), hi = Math.max(t.usl ?? -Infinity, ...xs);
              const pad = (hi - lo) * 0.06, X0 = lo - pad, X1 = hi + pad;
              const X = (v: number) => ((v - X0) / (X1 - X0)) * 100;
              const cpks = s.tttm.map((x) => x.cpk).filter((v): v is number => v != null);
              const gap = cpks.length >= 2 ? Math.max(...cpks) - Math.min(...cpks) : null;
              const req = sp.req ?? 1.33;
              return (
                <div key={s.step_id} className={`ttm-item${bad ? ' bad' : ''}${cur?.step_id === s.step_id ? ' sel' : ''}`} onClick={() => setSel({ step: s.step_id, eqp: s.tttm.find((x) => x.flag)?.eqp_id ?? null })}>
                  <div className="ttm-h">
                    <span className="nm">
                      <b><span className="step-lbl">STEP</span>{s.step_name} <span className="mono">{s.step_id}</span> <span className={`gr g${s.step_grade}`}>{s.step_grade}</span></b>
                      <small>{s.stage} · 계측 아이템 <b>{s.param}</b> ({s.unit}) · 계측 스텝 {s.meas_step_id ?? '-'} · 요구 Cpk {req.toFixed(2)}</small>
                    </span>
                    <span className="gap">설비 간 Cpk 차 <b className={gap != null && gap >= 0.5 ? 't-crit' : gap != null && gap >= 0.3 ? 't-high' : ''}>{r2(gap)}</b></span>
                    <span className="st">{bad ? <b className="t-crit">매칭 이상 {bad}대</b> : <span className="t-ok">✓ {s.tttm.length}대 매칭</span>}</span>
                    <button className="linkish" onClick={(e) => { e.stopPropagation(); onPick(s.step_id); }}>시뮬레이션 →</button>
                  </div>
                  <div className="ttm-b">
                    <span className="ttm-bars" aria-hidden="true">
                      {t.lsl != null && <i className="sl" style={{ left: `${X(t.lsl)}%` }} />}
                      {t.usl != null && <i className="sl" style={{ left: `${X(t.usl)}%` }} />}
                      {t.target != null && <i className="tg" style={{ left: `${X(t.target)}%` }} />}
                      {s.tttm.map((x, k) => {
                        const m = x.mean ?? 0, sd = x.sigma_within ?? 0;
                        return (
                          <span key={x.eqp_id} className={`tb ${x.flag ?? ''}`} style={{ top: `${((k + 0.5) / s.tttm.length) * 100}%`, left: `${X(m - 3 * sd)}%`, width: `${X(m + 3 * sd) - X(m - 3 * sd)}%` }}>
                            <em style={{ left: '50%' }} />
                          </span>
                        );
                      })}
                    </span>
                    <table className="cap-tools ttm-t">
                      <thead><tr><th>설비</th><th className="num">n</th><th className="num">평균</th><th className="num">σ군내</th><th className="num">Cp</th><th className="num">Cpk</th><th className="num">Pp</th><th className="num">Ppk</th><th className="num">M/S</th><th className="num">S/R</th><th>판정</th></tr></thead>
                      <tbody>
                        {s.tttm.map((x) => (
                          <tr key={x.eqp_id} className={`${x.flag ? 'flag' : ''}${cur?.step_id === s.step_id && curEqp === x.eqp_id ? ' me' : ''}`} style={{ cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); setSel({ step: s.step_id, eqp: x.eqp_id }); }} title="누르면 오른쪽에서 이 설비 vs 나머지 설비 비교">
                            <td className="mono" title={d.equipment.find((e) => e.eqp_id === x.eqp_id)?.eqp_model}><b>{x.eqp_id}</b></td>
                            <td className="num">{fmtN(x.n)}</td><td className="num">{num(x.mean, 4)}</td><td className="num">{num(x.sigma_within, 4)}</td>
                            <td className={`num cpk ${capCls(x.cp, req)}`}>{r2(x.cp)}</td><td className={`num cpk ${capCls(x.cpk, req)}`}><b>{r2(x.cpk)}</b></td>
                            <td className={`num cpk ${capCls(x.pp)}`}>{r2(x.pp)}</td><td className={`num cpk ${capCls(x.ppk)}`}>{r2(x.ppk)}</td>
                            <td className={`num ${Math.abs(x.ms ?? 0) >= L.msH ? 't-crit' : Math.abs(x.ms ?? 0) >= L.ms ? 't-high' : ''}`}><b>{(x.ms ?? 0) > 0 ? '+' : ''}{r2(x.ms)}</b></td>
                            <td className={`num ${(x.sr ?? 0) >= L.srH ? 't-crit' : (x.sr ?? 0) >= L.sr ? 't-high' : ''}`}><b>{r2(x.sr)}</b></td>
                            <td>{x.flag ? <span className={`sev ${x.flag}`}>{[Math.abs(x.ms ?? 0) >= L.ms && '평균 이동', (x.sr ?? 0) >= L.sr && '산포 과대'].filter(Boolean).join('·')}</span> : <span className="t-ok">✓</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {items.length > limit && <div className="more"><button className="btn" onClick={() => setLimit(limit + 30)}>{Math.min(30, items.length - limit)}개 더 보기</button></div>}
            {!items.length && <div className="empty">조건에 맞는 스텝 아이템이 없습니다.</div>}
          </div>
        ) : (
        <div className="tbl-wrap">
          <table className="cap-tools">
            <thead><tr><th>설비</th><th>모델</th><th className="num">스텝 아이템</th><th className="num">최저 Cpk</th><th className="num">평균 Cpk</th><th>최대 |M/S|</th><th>최대 S/R</th><th className="num">이상 아이템</th></tr></thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.eqp} className={t.flagged ? 'flag' : ''}>
                  <td className="mono"><b>{t.eqp}</b></td><td>{t.model ?? '-'}</td><td className="num">{t.rows.length}</td>
                  <td className={`num cpk ${capCls(t.minCpk)}`}>{r2(t.minCpk)}</td><td className="num">{r2(t.avgCpk)}</td>
                  <td><button className={`linkish ${Math.abs(t.ms.x.ms ?? 0) >= L.msH ? 't-crit' : Math.abs(t.ms.x.ms ?? 0) >= L.ms ? 't-high' : ''}`} onClick={() => { setTab('item'); onPick(t.ms.s.step_id); }} title={t.ms.s.step_name}>
                    <b className="mono">{(t.ms.x.ms ?? 0) > 0 ? '+' : ''}{r2(t.ms.x.ms)}</b> <small>{t.ms.s.param}</small></button></td>
                  <td><button className={`linkish ${(t.sr.x.sr ?? 0) >= L.srH ? 't-crit' : (t.sr.x.sr ?? 0) >= L.sr ? 't-high' : ''}`} onClick={() => { setTab('item'); onPick(t.sr.s.step_id); }} title={t.sr.s.step_name}>
                    <b className="mono">{r2(t.sr.x.sr)}</b> <small>{t.sr.s.param}</small></button></td>
                  <td className="num">{t.flagged ? <b className="t-crit">{t.flagged}</b> : <span className="t-ok">✓</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
      <div className="ttm-side">
        {cur && cmp && (
          <section className="panel rise ttm-cmp" aria-labelledby="h-cmp">
            <div className="ph"><h2 id="h-cmp"><span className="eyebrow">Compare</span>설비 출력 비교</h2><span className="ph-note">왼쪽에서 스텝 아이템·설비를 누르면 바뀝니다</span></div>
            <div className="cmp-h">
              <p><span className="step-lbl">STEP</span><b>{cur.step_name}</b> <span className="mono muted">{cur.step_id}</span> · {cur.stage} · {cur.step_grade}등급</p>
              <p className="muted">계측 아이템 <b>{cur.param}</b> · 계측 스텝 {cur.meas_step_id ?? '-'} · LSL {num(cmp.t.lsl)} · USL {num(cmp.t.usl)} {cur.unit}</p>
              <div className="cmp-tools">{cur.tttm.map((x) => <button key={x.eqp_id} className={`chip mono${x.flag ? ' bad' : ''}`} aria-pressed={x.eqp_id === curEqp} onClick={() => setSel({ step: cur.step_id, eqp: x.eqp_id })}>{x.eqp_id}</button>)}</div>
            </div>
            <EChart className="cmp-chart" option={cmp.option} ariaLabel={`${cur.step_name} 설비별 출력 분포 비교`} />
            {cmp.me ? (
              <div className="cmp-kv">
                <div><span>평균</span><b>{num(cmp.me.mean, 4)}</b><small>나머지 {num(cmp.mu_o, 4)}</small></div>
                <div><span>σ군내</span><b>{num(cmp.me.sigma_within, 4)}</b><small>나머지 {num(cmp.sw_o, 4)}</small></div>
                <div className={Math.abs(cmp.me.ms ?? 0) >= L.ms ? 'bad' : 'ok'}><span>M/S 평균 차이</span><b>{(cmp.me.ms ?? 0) > 0 ? '+' : ''}{r2(cmp.me.ms)}</b><small>기준 |{L.ms}|</small></div>
                <div className={(cmp.me.sr ?? 0) >= L.sr ? 'bad' : 'ok'}><span>S/R 산포 비</span><b>{r2(cmp.me.sr)}</b><small>기준 {L.sr}</small></div>
                <div><span>Cpk</span><b className={`cpk ${capCls(cmp.me.cpk, cur.spc?.req ?? 1.33)}`}>{r2(cmp.me.cpk)}</b><small>나머지 {r2(cmp.cpk_o)}</small></div>
                <div><span>Ppk</span><b className={`cpk ${capCls(cmp.me.ppk)}`}>{r2(cmp.me.ppk)}</b><small>Cp {r2(cmp.me.cp)} · Pp {r2(cmp.me.pp)}</small></div>
              </div>
            ) : <p className="muted" style={{ padding: '0 18px 14px' }}>설비를 누르면 그 설비 vs 나머지 설비 수치가 나옵니다.</p>}
          </section>
        )}
        <section className="panel rise" aria-labelledby="h-msr">
          <div className="ph"><h2 id="h-msr"><span className="eyebrow">M/S × S/R</span>매칭 맵</h2><span className="ph-note">선택한 스텝 아이템의 설비만 진하게 · 점 = 한 스텝 아이템 안의 한 설비 · 초록 = 매칭 양호</span></div>
          <EChart className="cap-chart" option={chart} ariaLabel="설비별 평균 이동과 산포 비 산점도" onClick={(e) => { const p = e.data as { s?: Step; x?: Step['tttm'][number] }; if (p?.s) setSel({ step: p.s.step_id, eqp: p.x?.eqp_id ?? null }); }} />
        </section>
      </div>
    </div>
  );
}

/* ───── 3) C/L · S/L 시뮬레이터 ───── */
type Lim = { lsl: number; usl: number; lcl: number; ucl: number; target: number; mean: number };

export function Simulator({ d, stepId, setStepId, grade }: { d: Dossier; stepId: string; setStepId: (id: string) => void; grade: string }) {
  const L = tl(d);
  const { dark, tick } = useTheme();
  const cand = useMemo(() => d.steps.filter((s) => s.spc?.cpk != null && s.target?.lsl != null && s.target?.usl != null && (!grade || s.step_grade === grade))
    .sort((a, b) => (a.spc!.cpk! - (a.spc!.req ?? 1.33)) - (b.spc!.cpk! - (b.spc!.req ?? 1.33))), [d, grade]);
  const s = cand.find((x) => x.step_id === stepId) ?? cand[0];
  const base = useMemo<Lim | null>(() => {
    if (!s) return null;
    const t = s.target!, sp = s.spc!;
    const sw = sp.sigma_within ?? 0;
    return { lsl: t.lsl!, usl: t.usl!, lcl: t.lcl ?? (sp.mean! - 3 * sw), ucl: t.ucl ?? (sp.mean! + 3 * sw), target: t.target ?? (t.lsl! + t.usl!) / 2, mean: sp.mean! };
  }, [s]);
  const [lim, setLim] = useState<Lim | null>(base);
  useEffect(() => setLim(base), [base]);

  /* 전 스텝 일괄: S/L 폭 ±% */
  const [pct, setPct] = useState(0);
  const bulk = useMemo(() => {
    const rows = d.steps.filter((x) => x.spc?.mean != null && x.spc?.sigma_within && x.target?.lsl != null && x.target?.usl != null);
    const by = (g: string) => {
      const rs = rows.filter((x) => !g || x.step_grade === g);
      let before = 0, after = 0, pb = 0, pa = 0;
      for (const x of rs) {
        const t = x.target!, sp = x.spc!, T = t.target ?? (t.lsl! + t.usl!) / 2, req = sp.req ?? 1.33;
        const so = sp.sigma_overall ?? sp.sigma_within!;
        const c0 = capOf(sp.mean!, sp.sigma_within!, so, t.lsl!, t.usl!);
        const L = T - (T - t.lsl!) * (1 + pct / 100), U = T + (t.usl! - T) * (1 + pct / 100);
        const c1 = capOf(sp.mean!, sp.sigma_within!, so, L, U);
        if (c0.cpk < req) before++;
        if (c1.cpk < req) after++;
        pb += c0.ppm; pa += c1.ppm;
      }
      return { n: rs.length, before, after, pb: pb / Math.max(rs.length, 1), pa: pa / Math.max(rs.length, 1) };
    };
    return [['전체', by('')], ['A', by('A')], ['B', by('B')], ['C', by('C')]] as const;
  }, [d, pct]);

  const res = useMemo(() => {
    if (!s || !lim || !base) return null;
    const sp = s.spc!, sw = sp.sigma_within!, so = sp.sigma_overall ?? sw;
    const now = capOf(base.mean, sw, so, base.lsl, base.usl), sim = capOf(lim.mean, sw, so, lim.lsl, lim.usl);
    return {
      now, sim, sw, so, req: sp.req ?? 1.33,
      oocNow: oocPct(base.mean, so, base.lcl, base.ucl), oocSim: oocPct(lim.mean, so, lim.lcl, lim.ucl),
      tools: (s.tttm ?? []).map((x) => {
        const xw = x.sigma_within ?? sw, xo = x.sigma_overall ?? xw, dm = lim.mean - base.mean;
        return { x, now: capOf(x.mean ?? base.mean, xw, xo, base.lsl, base.usl), sim: capOf((x.mean ?? base.mean) + dm, xw, xo, lim.lsl, lim.usl), ooc: oocPct((x.mean ?? base.mean) + dm, xo, lim.lcl, lim.ucl) };
      }),
    };
  }, [s, lim, base]);

  const chart = useMemo(() => {
    if (!s || !lim || !base || !res) return {};
    const mute = cssVar('--muted'), grid = cssVar('--line'), crit = cssVar('--crit'), high = cssVar('--high'), acc = cssVar('--accent'), aqua = cssVar('--aqua');
    const lo = Math.min(lim.lsl, base.lsl, lim.mean - 4.5 * res.so), hi = Math.max(lim.usl, base.usl, lim.mean + 4.5 * res.so);
    const xs = Array.from({ length: 161 }, (_, i) => lo + ((hi - lo) * i) / 160);
    const pdf = (m: number, sd: number) => xs.map((x) => [x, Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))]);
    const N = (s.tttm ?? []).reduce((a, x) => a + (x.n ?? 0), 0) || 1;
    const dm = lim.mean - base.mean;
    const toolCol = [cssVar('--violet'), cssVar('--m-etch'), cssVar('--m-cmp'), cssVar('--m-imp'), cssVar('--m-clean')];
    return {
      animation: false,
      grid: { left: 50, right: 20, top: 34, bottom: 40 },
      legend: { top: 4, left: 8, textStyle: { color: cssVar('--fg-2'), fontSize: 12 }, itemWidth: 14, itemHeight: 8 },
      tooltip: { trigger: 'axis', backgroundColor: cssVar('--panel'), borderColor: grid, textStyle: { color: cssVar('--fg-2') }, valueFormatter: (v: number) => v.toExponential(2) },
      xAxis: { type: 'value', min: lo, max: hi, axisLabel: { color: mute, formatter: (v: number) => num(v, 3) }, splitLine: { show: false }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', show: false },
      series: [
        { name: '전체(장기 σ)', type: 'line', smooth: true, symbol: 'none', data: pdf(lim.mean, res.so), lineStyle: { color: aqua, width: 2.5 }, areaStyle: { color: cssVar('--aqua-a') },
          markLine: {
            silent: true, symbol: 'none',
            data: [
              { xAxis: lim.lsl, lineStyle: { color: crit, width: 2 }, label: { formatter: `LSL ${num(lim.lsl, 3)}`, color: crit } },
              { xAxis: lim.usl, lineStyle: { color: crit, width: 2 }, label: { formatter: `USL ${num(lim.usl, 3)}`, color: crit } },
              { xAxis: lim.lcl, lineStyle: { color: high, type: 'dashed' }, label: { formatter: 'LCL', color: high } },
              { xAxis: lim.ucl, lineStyle: { color: high, type: 'dashed' }, label: { formatter: 'UCL', color: high } },
              { xAxis: lim.target, lineStyle: { color: acc, type: 'dotted' }, label: { formatter: 'T', color: acc } },
              ...(lim.lsl !== base.lsl ? [{ xAxis: base.lsl, lineStyle: { color: crit, type: 'dotted', opacity: 0.45 }, label: { show: false } }] : []),
              ...(lim.usl !== base.usl ? [{ xAxis: base.usl, lineStyle: { color: crit, type: 'dotted', opacity: 0.45 }, label: { show: false } }] : []),
            ],
          } },
        { name: '군내(단기 σ)', type: 'line', smooth: true, symbol: 'none', data: pdf(lim.mean, res.sw), lineStyle: { color: acc, width: 1.5, type: 'dashed' } },
        ...(s.tttm ?? []).map((x, i) => ({
          name: x.eqp_id, type: 'line', smooth: true, symbol: 'none',
          data: pdf((x.mean ?? base.mean) + dm, x.sigma_overall ?? x.sigma_within ?? res.so).map(([a, b]) => [a, b * ((x.n ?? 0) / N)]),
          lineStyle: { color: x.flag ? crit : toolCol[i % toolCol.length], width: x.flag ? 2 : 1.2, opacity: 0.9 },
        })),
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, lim, base, res, dark, tick]);

  if (!s || !lim || !base || !res) return null;
  const set = (k: keyof Lim) => (e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); if (isFinite(v)) setLim({ ...lim, [k]: v }); };
  const width = base.usl - base.lsl;
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(width, 1e-6))) - 2);
  const scaleSL = (p: number) => setLim({ ...lim, lsl: +(lim.target - (base.target - base.lsl) * (1 + p)).toFixed(6), usl: +(lim.target + (base.usl - base.target) * (1 + p)).toFixed(6) });
  const Delta = ({ a, b, req }: { a: number; b: number; req: number }) => (
    <span className={`dl ${capCls(b, req)}`}><span className="a">{r2(a)}</span><span className="ar">→</span><b>{r2(b)}</b>{Math.abs(b - a) >= 0.005 && <small className={b > a ? 'd-up' : 'd-dn'}>{b > a ? '▲' : '▼'}{Math.abs(b - a).toFixed(2)}</small>}</span>
  );
  return (
    <section className="panel rise sim" aria-labelledby="h-sim">
      <div className="ph"><h2 id="h-sim"><span className="eyebrow">Simulation</span>C/L · S/L 변경 시뮬레이션</h2>
        <span className="ph-note">S/L(규격) 을 바꾸면 Cp·Cpk·Pp·Ppk·예상 불량(ppm) 이 변하고, C/L(관리한계) 를 바꾸면 공정능력 지수는 그대로이고 OOC 알람 비율만 변합니다 · 정규분포 가정</span></div>
      <div className="sim-body">
        <div className="sim-l">
          <label className="fld wide"><span>대상 스텝 ({cand.length}개 · 요구치 대비 여유 적은 순)</span>
            <select value={s.step_id} onChange={(e) => setStepId(e.target.value)}>
              {cand.map((x) => <option key={x.step_id} value={x.step_id}>{x.spc!.cpk! < (x.spc!.req ?? 1.33) ? '⚠ ' : ''}{x.step_id} · {x.step_name} · {x.param} · {x.step_grade} · Cpk {r2(x.spc!.cpk)}</option>)}
            </select>
          </label>
          <p className="sim-meta">
            {s.stage} · {s.step_grade}등급 (요구 Cpk {res.req.toFixed(2)}) · 계측 스텝 <b className="mono">{s.meas_step_id ?? '-'}</b> {s.meas_step_name ?? ''}<br />
            n={fmtN(s.spc!.n)} · 평균 {num(base.mean, 4)} · σ군내 {num(res.sw, 4)} · σ전체 {num(res.so, 4)} {s.unit}
          </p>
          <div className="sim-grid">
            <fieldset><legend>S/L 규격한계</legend>
              <label className="fld"><span>LSL</span><input type="number" step={step} value={lim.lsl} onChange={set('lsl')} /></label>
              <label className="fld"><span>USL</span><input type="number" step={step} value={lim.usl} onChange={set('usl')} /></label>
              <div className="sim-q">{[-20, -10, 10, 20].map((p) => <button key={p} className="chip" onClick={() => scaleSL(p / 100)}>폭 {p > 0 ? '+' : ''}{p}%</button>)}</div>
            </fieldset>
            <fieldset><legend>C/L 관리한계</legend>
              <label className="fld"><span>LCL</span><input type="number" step={step} value={lim.lcl} onChange={set('lcl')} /></label>
              <label className="fld"><span>UCL</span><input type="number" step={step} value={lim.ucl} onChange={set('ucl')} /></label>
              <div className="sim-q">
                <button className="chip" onClick={() => setLim({ ...lim, lcl: lim.mean - 3 * res.sw, ucl: lim.mean + 3 * res.sw })}>평균 ± 3σ군내</button>
                <button className="chip" onClick={() => setLim({ ...lim, lcl: lim.mean - 3 * res.so, ucl: lim.mean + 3 * res.so })}>평균 ± 3σ전체</button>
              </div>
            </fieldset>
            <fieldset><legend>공정 중심 (What-if)</legend>
              <label className="fld"><span>평균</span><input type="number" step={step} value={+lim.mean.toFixed(6)} onChange={set('mean')} /></label>
              <label className="fld"><span>타겟</span><input type="number" step={step} value={lim.target} onChange={set('target')} /></label>
              <div className="sim-q"><button className="chip" onClick={() => setLim({ ...lim, mean: lim.target })}>평균을 타겟으로 센터링</button></div>
            </fieldset>
          </div>
          <div className="sim-res">
            <div><span>Cp</span><Delta a={res.now.cp} b={res.sim.cp} req={res.req} /></div>
            <div><span>Cpk</span><Delta a={res.now.cpk} b={res.sim.cpk} req={res.req} /></div>
            <div><span>Pp</span><Delta a={res.now.pp} b={res.sim.pp} req={res.req} /></div>
            <div><span>Ppk</span><Delta a={res.now.ppk} b={res.sim.ppk} req={res.req} /></div>
            <div><span>예상 불량 (ppm)</span><span className="dl"><span className="a">{ppmTxt(res.now.ppm)}</span><span className="ar">→</span><b className={res.sim.ppm > res.now.ppm ? 't-crit' : 't-ok'}>{ppmTxt(res.sim.ppm)}</b></span></div>
            <div><span>예상 OOC 비율</span><span className="dl"><span className="a">{res.oocNow.toFixed(2)}%</span><span className="ar">→</span><b className={res.oocSim > 5 ? 't-crit' : res.oocSim > res.oocNow ? 't-high' : 't-ok'}>{res.oocSim.toFixed(2)}%</b></span></div>
            <div className={`verdict ${res.sim.cpk >= res.req ? 'ok' : 'bad'}`}>{res.sim.cpk >= res.req ? `✓ ${s.step_grade}등급 요구치 충족` : `✕ ${s.step_grade}등급 요구 Cpk ${res.req.toFixed(2)} 미달`}</div>
            <button className="btn" onClick={() => setLim(base)}>현재값으로 되돌리기</button>
          </div>
        </div>
        <div className="sim-r">
          <EChart className="sim-chart" option={chart} ariaLabel="분포와 규격·관리한계 시뮬레이션" />
          {res.tools.length > 0 && (
            <table className="cap-tools sim-tools">
              <thead><tr><th>설비</th><th className="num">n</th><th className="num">M/S</th><th className="num">S/R</th><th>Cpk</th><th>Ppk</th><th className="num">ppm</th><th className="num">OOC</th></tr></thead>
              <tbody>
                {res.tools.map((t) => (
                  <tr key={t.x.eqp_id} className={t.x.flag || t.sim.cpk < res.req ? 'flag' : ''}>
                    <td className="mono"><b>{t.x.eqp_id}</b></td><td className="num">{fmtN(t.x.n)}</td>
                    <td className={`num ${Math.abs(t.x.ms ?? 0) >= L.ms ? 't-crit' : ''}`}>{r2(t.x.ms)}</td><td className={`num ${(t.x.sr ?? 0) >= L.sr ? 't-crit' : ''}`}>{r2(t.x.sr)}</td>
                    <td><Delta a={t.now.cpk} b={t.sim.cpk} req={res.req} /></td><td><Delta a={t.now.ppk} b={t.sim.ppk} req={res.req} /></td>
                    <td className="num">{ppmTxt(t.sim.ppm)}</td><td className="num">{t.ooc.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="sim-bulk">
        <div className="sb-h"><b>전 스텝 일괄 S/L 폭 조정</b><span className="muted">각 스텝 타겟 기준으로 규격 폭을 같은 비율로 넓히거나 좁혔을 때 등급별 요구치 미달 스텝 수</span>
          <input type="range" min={-30} max={30} step={5} value={pct} onChange={(e) => setPct(+e.target.value)} aria-label="규격 폭 조정 비율" />
          <b className="mono pct">{pct > 0 ? '+' : ''}{pct}%</b>
        </div>
        <div className="sb-g">
          {bulk.map(([g, b]) => (
            <div key={g} className={b.after > b.before ? 'worse' : b.after < b.before ? 'better' : ''}>
              <span>{g === '전체' ? '전체' : `${g}등급`} <small>{b.n}개</small></span>
              <b>{b.before} → <em>{b.after}</em></b><small>평균 ppm {ppmTxt(b.pb)} → {ppmTxt(b.pa)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
