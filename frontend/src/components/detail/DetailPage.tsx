import { useEffect, useMemo, useState } from 'react';
import type { Dossier, Step } from '../../types';
import { DATA_MODE } from '../../api';
import { cssVar, escHtml, fmtD, fmtN, SEV_LABEL, SEVS, useTheme } from '../../lib';
import { makeScope, type EqpFilter, type Group } from '../../scope';
import DataTable from '../DataTable';
import ServerTable, { type Params } from '../ServerTable';
import EChart from '../EChart';
import EquipmentPanel from '../EquipmentPanel';
import { badChange, buildCols, cpkCls, ITEMS, Matrix, widened, type ItemKey } from './columns';
import { CapGrades, Simulator, Tttm } from './Capability';

type Props = {
  d: Dossier; item: ItemKey; initStage: string | null; initStep: string | null; initEqp: EqpFilter;
  onItem: (k: ItemKey) => void; onBack: () => void; onOpenStep: (id: string) => void;
  onCrumb: (level: 'home' | 'line' | 'node' | 'family' | 'product') => void;
};

const day = (s?: string | null) => (s ? s.slice(0, 10) : '');
const ms = (s: string) => new Date(s.replace(' ', 'T').slice(0, 16) + ':00').getTime();

function weekly<T>(rows: T[], at: (r: T) => string | null | undefined, key: (r: T) => string, defs: { key: string; name: string; color: string }[], from: string, to: string, tip: string) {
  const s = new Date(from + 'T00:00:00').getTime(), e = new Date(to + 'T23:59:59').getTime();
  const n = Math.max(1, Math.ceil((e - s) / (7 * 864e5)));
  const labels = Array.from({ length: n }, (_, i) => { const x = new Date(s + i * 7 * 864e5); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; });
  const data: Record<string, number[]> = Object.fromEntries(defs.map((d) => [d.key, Array(n).fill(0)]));
  rows.forEach((r) => { const a = at(r); if (!a) return; const t = ms(a); if (t < s || t > e) return; const k = key(r); if (data[k]) data[k][Math.min(n - 1, Math.floor((t - s) / (7 * 864e5)))]++; });
  const fg2 = cssVar('--fg-2'), muted = cssVar('--muted'), line = cssVar('--line');
  return {
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: { top: 4, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: fg2, fontSize: 13 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: cssVar('--tip'), borderColor: cssVar('--line-hi'), textStyle: { color: fg2, fontSize: 13.5 } },
    xAxis: { type: 'category', data: labels, name: tip, nameLocation: 'end', nameTextStyle: { color: muted, fontSize: 12 }, axisLabel: { color: muted, fontSize: 12, fontFamily: 'IBM Plex Mono' }, axisLine: { lineStyle: { color: line } } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: line } }, axisLabel: { color: muted, fontSize: 12 } },
    series: defs.map((d) => ({ name: d.name, type: 'bar', stack: 't', barMaxWidth: 26, data: data[d.key], itemStyle: { color: d.color, borderRadius: 2, shadowBlur: 10, shadowColor: d.color + '55' } })),
    animationDuration: 800,
  };
}

/** 공정흐름 + 계측 스텝 행 (백엔드 flow_with_meas 와 같은 규칙, 데모 빌드용) */
function withMeas(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    out.push({ ...s, step_type: 'process' });
    if (s.meas_step_id) {
      const n = Number((s.meas_step_id.match(/(\d+)$/) ?? [])[1] ?? s.seq);
      out.push({ ...s, step_type: 'meas', seq: n, step_id: s.meas_step_id, step_name: s.meas_step_name ?? `${s.param} 계측`, module: '계측', recipe_id: undefined,
        process_step_id: s.step_id, process_step_name: s.step_name, compat: [], models: [], il_window: 0, il_recent: 0, il_forced: 0, il_active: 0, bm_window: 0, pm_window: 0,
        changes_window: 0, risk_score: 0, risk_level: s.spc?.meets === false ? 'HIGH' : 'OK', eqp_level: 'OK', point_ids: [] });
    }
  }
  return out;
}

export default function DetailPage({ d, item, initStage, initStep, initEqp, onItem, onBack, onOpenStep, onCrumb }: Props) {
  const { tick } = useTheme();
  const start = useMemo(() => { const x = new Date(ms(d.as_of) - d.window_days * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }, [d]);
  const [stage, setStage] = useState<string>(initStage ?? '');
  const [step, setStep] = useState<string>(initStep ?? '');
  const [capGrade, setCapGrade] = useState('');
  const [stepKind, setStepKind] = useState<'all' | 'process' | 'meas'>('all');
  const [simStep, setSimStep] = useState<string>(initStep ?? '');
  const [eqp, setEqp] = useState<EqpFilter>(initEqp);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(day(d.as_of));
  const [group, setGroup] = useState<Group>('eqp');
  useEffect(() => { scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [item]);

  const stepName = useMemo(() => new Map(d.steps.map((s) => [s.step_id, `${String(s.seq).padStart(4, '0')} ${s.step_name}`])), [d]);
  const pickEqp = (id: string) => setEqp((c) => (c?.kind === 'eqp' && c.id === id ? null : { kind: 'eqp', id }));
  const cols = useMemo(() => buildCols({ d, stepName, onStep: (id) => setStep(id), onEqp: pickEqp }), [d, stepName]);
  const scope = useMemo(() => makeScope(d, step || null, eqp, stage || null), [d, step, eqp, stage]);
  const inRange = (s?: string | null) => { const v = day(s); return !!v && v >= from && v <= to; };
  const dateTouched = from !== start || to !== day(d.as_of);
  const flagged = useMemo(() => new Set(d.risk_points.flatMap((p) => p.refs)), [d]);
  const models = useMemo(() => [...new Set(d.equipment.map((e) => e.eqp_model))].sort(), [d]);

  const rows = useMemo(() => {
    const steps = d.steps.filter((s) => (!stage || s.stage === stage) && (!step || s.step_id === step) && (!eqp || s.compat.some((c) => scope.eqps.has(c.eqp_id))));
    return {
      risk: scope.points.filter((p) => !p.at || inRange(p.at)),
      flow: withMeas(steps).filter((s) => stepKind === 'all' || s.step_type === stepKind), target: steps.filter((s) => s.measured),
      spec: (eqp ? [] : scope.targetChanges).filter((t) => !dateTouched || inRange(t.changed_at)),
      il: scope.interlocks.filter((r) => inRange(r.occurred_at)),
      pmbm: scope.maintenance.filter((r) => inRange(r.start_at)),
      chg: scope.changes.filter((r) => inRange(r.changed_at)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, scope, step, eqp, stage, from, to]);

  const count = (k: ItemKey) => (k === 'eqp' ? scope.eqps.size : rows[k].length);

  const chart = useMemo(() => {
    const C = { crit: cssVar('--crit'), high: cssVar('--high'), med: cssVar('--med'), low: cssVar('--aqua'), ok: cssVar('--ok'), vio: cssVar('--violet'), aqua: cssVar('--aqua'), acc: cssVar('--accent'), fg2: cssVar('--fg-2'), muted: cssVar('--muted'), line: cssVar('--line'), lineHi: cssVar('--line-hi'), tip: cssVar('--tip') };
    const base = { tooltip: { backgroundColor: C.tip, borderColor: C.lineHi, textStyle: { color: C.fg2, fontSize: 13.5 } }, animationDuration: 800 };
    const axisX = { axisLabel: { color: C.muted, fontSize: 12, fontFamily: 'IBM Plex Mono' }, axisLine: { lineStyle: { color: C.line } } };
    const sevC: Record<string, string> = { CRIT: C.crit, HIGH: C.high, MED: C.med, LOW: C.low, OK: C.lineHi };
    switch (item) {
      case 'risk': {
        const rules = [...new Set(rows.risk.map((p) => p.rule_name))];
        return { ...base, tooltip: { ...base.tooltip, trigger: 'axis' }, grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
          legend: { top: 2, left: 0, textStyle: { color: C.fg2, fontSize: 13 }, itemWidth: 10, itemHeight: 10 },
          xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.line } }, ...axisX },
          yAxis: { type: 'category', data: rules, axisLabel: { color: C.fg2, fontSize: 13.5 }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.line } } },
          series: SEVS.map((s) => ({ name: SEV_LABEL[s], type: 'bar', stack: 't', barMaxWidth: 18, itemStyle: { color: sevC[s], borderRadius: 2, shadowBlur: 10, shadowColor: sevC[s] + '66' },
            data: rules.map((r) => rows.risk.filter((p) => p.rule_name === r && p.severity === s).length) })) };
      }
      case 'flow': {
        const sts = d.stages.filter((x) => !stage || x.stage === stage);
        const lv = ['CRIT', 'HIGH', 'MED', 'LOW', 'OK'] as const;
        const nm: Record<string, string> = { CRIT: '치명', HIGH: '높음', MED: '보통', LOW: '낮음', OK: '이상 없음' };
        return { ...base, tooltip: { ...base.tooltip, trigger: 'axis' }, grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
          legend: { top: 2, left: 0, textStyle: { color: C.fg2, fontSize: 13.5 }, itemWidth: 11, itemHeight: 11 },
          xAxis: { type: 'category', data: sts.map((x) => x.stage), ...axisX, axisLabel: { ...axisX.axisLabel, interval: 0, rotate: sts.length > 8 ? 40 : 0, fontSize: 12.5 } },
          yAxis: { type: 'value', name: '스텝 수', nameTextStyle: { color: C.muted, fontSize: 12.5 }, splitLine: { lineStyle: { color: C.line } }, axisLabel: { color: C.muted } },
          series: lv.map((k) => ({ name: `공정 리스크 ${nm[k]}`, type: 'bar', stack: 's', barMaxWidth: 30,
            itemStyle: { color: k === 'OK' ? C.ok + '55' : sevC[k], borderRadius: 2 },
            data: sts.map((x) => d.steps.filter((y) => y.stage === x.stage && y.risk_level === k && (!step || y.step_id === step)).length) })) };
      }
      case 'target': return { ...base, tooltip: { ...base.tooltip, trigger: 'axis' }, grid: { left: 8, right: 60, top: 20, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: rows.target.map((s) => s.step_name), ...axisX, axisLabel: { ...axisX.axisLabel, interval: 0, fontSize: 11, rotate: rows.target.length > 10 ? 35 : 0 } },
        yAxis: { type: 'value', name: 'Cpk', min: 0, nameTextStyle: { color: C.muted }, splitLine: { lineStyle: { color: C.line } }, axisLabel: { color: C.muted } },
        series: [{ type: 'bar', barMaxWidth: 26, data: rows.target.map((s) => { const c = s.spc?.cpk ?? 0; const col = cpkCls(c) === 'bad' ? C.crit : cpkCls(c) === 'mid' ? C.high : C.ok; return { value: c, itemStyle: { color: col, borderRadius: [4, 4, 0, 0], shadowBlur: 10, shadowColor: col } }; }),
          markLine: { symbol: 'none', silent: true, data: [{ yAxis: 1.33, lineStyle: { color: C.high, type: 'dashed' }, label: { formatter: '1.33', color: C.high } }, { yAxis: 1.0, lineStyle: { color: C.crit, type: 'dashed' }, label: { formatter: '1.00', color: C.crit } }] } }] };
      case 'spec': {
        const ys = [...new Set(rows.spec.map((r) => stepName.get(r.step_id) ?? r.step_id))];
        return { ...base, grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
          tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: { data: { tip: string } }) => p.data.tip },
          xAxis: { type: 'time', ...(dateTouched ? { min: ms(from + ' 00:00'), max: ms(to + ' 23:59') } : {}), splitLine: { lineStyle: { color: C.line } }, ...axisX },
          yAxis: { type: 'category', data: ys, axisLabel: { color: C.fg2, fontSize: 13 }, axisLine: { lineStyle: { color: C.line } } },
          series: [{ type: 'scatter', data: rows.spec.map((r) => ({ value: [ms(r.changed_at), stepName.get(r.step_id) ?? r.step_id], symbol: 'diamond', symbolSize: widened(r) ? 20 : 12,
            itemStyle: { color: widened(r) ? C.crit : C.vio, shadowBlur: widened(r) ? 16 : 0, shadowColor: C.crit },
            tip: `<b>${escHtml(stepName.get(r.step_id))}</b> Rev.${r.rev}<br>LSL ${r.lsl_before}→${r.lsl_after}, USL ${r.usl_before}→${r.usl_after}<br>${escHtml(r.reason)}<br>요청 ${escHtml(r.requested_by)} · 승인 ${escHtml(r.approved_by)}` })) }] };
      }
      case 'il': return weekly(rows.il, (r) => r.occurred_at, (r) => (r.release_type === '강제 해제' && r.released_at ? 'F' : !r.released_at ? 'A' : r.severity ?? 'MINOR'),
        [{ key: 'MINOR', name: 'MINOR', color: C.med }, { key: 'MAJOR', name: 'MAJOR', color: C.high }, { key: 'CRIT', name: 'CRIT', color: C.crit }, { key: 'F', name: '강제 해제', color: C.vio }, { key: 'A', name: '미해제', color: C.aqua }], from, to, '주 시작일');
      case 'pmbm': return weekly(rows.pmbm, (r) => r.start_at, (r) => ((r.lots_before_qual ?? 0) > 0 || r.qual_result === 'FAIL' || r.qual_result === 'PENDING' ? 'Q' : r.mt_type),
        [{ key: 'PM', name: 'PM', color: C.ok }, { key: 'BM', name: 'BM', color: C.high }, { key: 'Q', name: 'Qual 이슈 (FAIL·PENDING·Qual 전 LOT)', color: C.crit }], from, to, '주 시작일');
      case 'chg': return weekly(rows.chg, (r) => r.changed_at, (r) => (!r.approved_by ? 'N' : r.approved_by === r.requested_by ? 'S' : r.verify_status !== '완료' ? 'V' : 'OK'),
        [{ key: 'OK', name: '정상 승인·검증 완료', color: C.aqua }, { key: 'V', name: '검증 미완료', color: C.med }, { key: 'S', name: '자기 승인', color: C.high }, { key: 'N', name: '승인 없음', color: C.crit }], from, to, '주 시작일');
      default: return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, rows, tick, from, to]);

  const kpis: [string, number | string, string?][] = (() => {
    switch (item) {
      case 'risk': return SEVS.map((s) => [SEV_LABEL[s], rows.risk.filter((p) => p.severity === s).length, s === 'CRIT' ? 'bad' : s === 'HIGH' ? 'warn' : ''] as [string, number, string]);
      case 'flow': return [['스텝', rows.flow.length], ['핵심 스텝', rows.flow.filter((s) => s.critical).length], ['치명 포함 스텝', rows.flow.filter((s) => s.risk_level === 'CRIT').length, 'bad'], ['인증 설비 1대 스텝', rows.flow.filter((s) => s.compat.filter((c) => c.qualified).length === 1).length, 'warn']];
      case 'target': return [['계측 스텝', rows.target.length], ['등급 요구치 미달', rows.target.filter((s) => s.spc?.meets === false).length, 'bad'], ['Cpk < 1.0', rows.target.filter((s) => (s.spc?.cpk ?? 9) < 1).length, 'bad'], ['Ppk < 1.33', rows.target.filter((s) => (s.spc?.ppk ?? 9) < 1.33).length, 'warn'], ['설비 매칭 초과', rows.target.reduce((a, s) => a + (s.tttm ?? []).filter((t) => t.flag).length, 0), 'warn'], ['OOS 30일', rows.target.reduce((a, s) => a + (s.spc?.oos_30d ?? 0), 0), 'bad']];
      case 'spec': return [['개정', rows.spec.length], ['규격 확대', rows.spec.filter(widened).length, 'bad'], ['자기 승인', rows.spec.filter((r) => r.approved_by === r.requested_by).length, 'warn'], ['스텝', new Set(rows.spec.map((r) => r.step_id)).size]];
      case 'eqp': { const es = d.equipment.filter((e) => scope.eqps.has(e.eqp_id)); return [['호환설비', es.length], ['모델', new Set(es.map((e) => e.eqp_model)).size], ['PM 주기 초과', es.filter((e) => e.pm_overdue_days > 0).length, 'warn'], ['리스크 설비', es.filter((e) => e.risk_score > 0).length, 'bad']]; }
      case 'il': return [['인터락', rows.il.length], ['강제 해제', rows.il.filter((r) => r.release_type === '강제 해제' && r.released_at).length, 'bad'], ['미해제', rows.il.filter((r) => !r.released_at).length, 'warn'], ['CRIT', rows.il.filter((r) => r.severity === 'CRIT').length, 'bad']];
      case 'pmbm': return [['PM', rows.pmbm.filter((r) => r.mt_type === 'PM').length], ['BM', rows.pmbm.filter((r) => r.mt_type === 'BM').length, 'warn'], ['Qual FAIL·PENDING', rows.pmbm.filter((r) => r.qual_result === 'FAIL' || r.qual_result === 'PENDING').length, 'bad'], ['Qual 전 LOT', rows.pmbm.reduce((a, r) => a + (r.lots_before_qual ?? 0), 0), 'bad']];
      case 'chg': return [['변경', rows.chg.length], ['승인 없음', rows.chg.filter((r) => !r.approved_by).length, 'bad'], ['자기 승인', rows.chg.filter((r) => r.approved_by && r.approved_by === r.requested_by).length, 'warn'], ['검증 미완료', rows.chg.filter((r) => r.verify_status !== '완료').length, 'warn']];
    }
  })();

  const csvUrl = (() => {
    if (DATA_MODE === 'mock') return undefined;
    const q = new URLSearchParams();
    if (step) q.set('step', step);
    if (eqp) q.set(eqp.kind === 'eqp' ? 'eqp' : 'model', eqp.id);
    q.set('start', from); q.set('end', to);
    return `/api/products/${encodeURIComponent(d.product.product_id)}/export/${item}.csv?${q}`;
  })();
  const sp: Params = { stage: stage || undefined, step: step || undefined, eqp: eqp?.kind === 'eqp' ? eqp.id : undefined, model: eqp?.kind === 'model' ? eqp.id : undefined,
    ...(['il', 'pmbm', 'chg', 'risk'].includes(item) || (item === 'spec' && dateTouched) ? { start: from, end: to } : {}) };
  const truncated = (d as Dossier & { truncated?: Record<string, number> }).truncated ?? {};
  const capNote = item === 'il' && truncated.interlocks ? truncated.interlocks : item === 'pmbm' && truncated.maintenance ? truncated.maintenance : item === 'chg' && truncated.changes ? truncated.changes : 0;
  const file = `${d.product.product_id}_${ITEMS.find((x) => x.key === item)!.name.replace(/[\s·/]+/g, '_')}_${day(d.as_of)}.csv`;
  const meta = ITEMS.find((x) => x.key === item)!;
  const p = d.product;

  return (
    <div className="detail" style={{ display: 'grid', gap: 16 }}>
      <section className="panel dt-head rise">
        <div className="dt-top">
          <button className="btn" onClick={onBack} aria-label="요약으로 돌아가기">← 요약</button>
          <nav className="crumb" aria-label="현재 위치">
            <button className="crumb-link" onClick={() => onCrumb('home')} title="종합 OVERVIEW">종합</button><span className="sep">›</span>
            <button className="crumb-link" onClick={() => onCrumb('line')} title="이 라인의 공법 선택">{d.line?.line_name}</button><span className="sep">›</span>
            <button className="crumb-link" onClick={() => onCrumb('node')} title="이 노드의 공법 선택">{p.node}</button><span className="sep">›</span>
            <button className="crumb-link" onClick={() => onCrumb('family')} title="이 공정의 재공 Top 5 · 공법 선택">{p.family_code} {p.family_name}</button><span className="sep">›</span>
            <button className="crumb-link" onClick={() => onCrumb('product')} title="이 공법의 요약 페이지">{p.product_name} <span className="mono muted">{p.product_id}</span></button>
            <span className="sep">›</span><b>{meta.name}</b>
          </nav>
          <span className={`lv lv-${d.summary.level}`} style={{ marginLeft: 'auto' }}>리스크 {d.summary.risk_index} · {d.summary.level}</span>
        </div>
        <div className="tabs" role="tablist" style={{ padding: 0, borderBottom: 0 }}>
          {ITEMS.map((x) => <button key={x.key} role="tab" aria-selected={x.key === item} onClick={() => onItem(x.key)}>{x.name}<b>{count(x.key)}</b></button>)}
        </div>
      </section>

      <section className="panel dt-filter rise" style={{ ['--i' as string]: 1 }} aria-label="필터">
        <label className="fld"><span>스테이지</span>
          <select id="f-stage" value={stage} onChange={(e) => { setStage(e.target.value); setStep(''); }}>
            <option value="">전체 스테이지 ({d.stages.length})</option>
            {d.stages.map((x) => <option key={x.stage} value={x.stage}>{x.stage} · {x.steps}스텝</option>)}
          </select>
        </label>
        <label className="fld"><span>스텝</span>
          <select id="f-step" value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">{stage ? `스테이지 전체 (${d.steps.filter((x) => x.stage === stage).length})` : `전체 스텝 (${d.steps.length.toLocaleString()})`}</option>
            {d.steps.filter((x) => !stage || x.stage === stage).map((x) => <option key={x.step_id} value={x.step_id}>{stepName.get(x.step_id)}</option>)}
          </select>
        </label>
        <label className="fld"><span>설비 · 모델</span>
          <select id="f-eqp" value={eqp ? `${eqp.kind}:${eqp.id}` : ''} onChange={(e) => { const v = e.target.value; setEqp(v ? { kind: v.split(':')[0] as 'eqp' | 'model', id: v.slice(v.indexOf(':') + 1) } : null); }}>
            <option value="">전체 호환설비 ({d.equipment.length})</option>
            <optgroup label="설비 모델">{models.map((m) => <option key={m} value={`model:${m}`}>모델 · {m}</option>)}</optgroup>
            <optgroup label="호환설비">{d.equipment.map((e) => <option key={e.eqp_id} value={`eqp:${e.eqp_id}`}>{e.eqp_id} ({e.eqp_model})</option>)}</optgroup>
          </select>
        </label>
        <label className="fld"><span>시작일</span><input id="f-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || start)} /></label>
        <label className="fld"><span>종료일</span><input id="f-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || day(d.as_of))} /></label>
        <button className="btn" onClick={() => { setStage(''); setStep(''); setEqp(null); setFrom(start); setTo(day(d.as_of)); }}>필터 초기화</button>
        {step && <button className="btn" onClick={() => onOpenStep(step)}>스텝 상세 열기</button>}
        <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>기준 {fmtD(d.as_of)} · 기간 필터는 이력 항목에만 적용 · 스펙 개정은 기간을 바꾸기 전까지 전체 이력</span>
      </section>

      <div className="dt-kpis rise" style={{ ['--i' as string]: 2 }}>
        {kpis.map(([k, v, c]) => <div key={k} className={`kpi ${c ?? ''}`}><span className="k">{k}</span><span className="v">{v}</span></div>)}
      </div>

      {item === 'eqp' ? (
        <>
          <EquipmentPanel d={d} scope={scope} stepId={step || null} group={group} setGroup={setGroup} eqp={eqp} onEqp={(f) => setEqp((c) => (f && c && c.kind === f.kind && c.id === f.id ? null : f))} />
          <section className="panel rise" aria-labelledby="h-mx">
            <div className="ph"><h2 id="h-mx"><span className="eyebrow">Matrix</span>{stage ? `${stage} 스텝` : '스테이지'} × 호환설비 매트릭스</h2>{stage && <button className="btn" onClick={() => setStage('')}>← 스테이지 단위</button>}</div>
            <Matrix d={d} stage={stage} onStage={setStage} onStep={setStep} onEqp={pickEqp} />
          </section>
        </>
      ) : (
        <>
          {item === 'target' && (
            <>
              <CapGrades d={d} grade={capGrade} onGrade={(g) => setCapGrade(capGrade === g ? '' : g)} />
              <Tttm d={d} grade={capGrade} onPick={(id) => { setSimStep(id); setTimeout(() => document.getElementById('h-sim')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }} />
              <Simulator d={d} stepId={simStep} setStepId={setSimStep} grade={capGrade} />
            </>
          )}
          {chart && (
            <section className="panel rise" style={{ ['--i' as string]: 3 }} aria-labelledby="h-dc">
              <div className="ph"><h2 id="h-dc"><span className="eyebrow">{meta.eyebrow}</span>{meta.name} 분포</h2><span className="ph-note">{capNote ? `차트는 최근 ${(d as Dossier & { truncated?: Record<string, number> }).interlocks.length.toLocaleString()}건 기준 · 아래 표와 CSV 는 전체 ${capNote.toLocaleString()}건` : meta.desc}</span></div>
              <EChart className="dt-chart" option={chart} ariaLabel={`${meta.name} 차트`} />
            </section>
          )}
          <section className="panel rise" style={{ ['--i' as string]: 4 }} aria-labelledby="h-dt">
            <div className="ph"><h2 id="h-dt"><span className="eyebrow">Records</span>{meta.name} 전체</h2>
              {item === 'flow' ? (
                <div className="ph-tools">
                  <div className="seg" role="group" aria-label="스텝 구분">
                    <button aria-pressed={stepKind === 'all'} onClick={() => setStepKind('all')}>전체 <small>{fmtN(d.steps.length + d.steps.filter((s) => s.meas_step_id).length)}</small></button>
                    <button aria-pressed={stepKind === 'process'} onClick={() => setStepKind('process')}>Process step <small>{fmtN(d.steps.length)}</small></button>
                    <button aria-pressed={stepKind === 'meas'} onClick={() => setStepKind('meas')}>계측 step <small>{fmtN(d.steps.filter((s) => s.meas_step_id).length)}</small></button>
                  </div>
                </div>
              ) : <span className="ph-note">머리글을 누르면 정렬 · 설비·스텝 칩을 누르면 필터</span>}
            </div>
            {DATA_MODE === 'api' ? (
              <>
                {item === 'risk' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.risk} rowKey={(r) => r.id} file={file} placeholder="규칙, 내용, 근거, 설비 검색 (서버 검색)" field={{ id: 'id', sev: 'severity', rule: 'rule_name', cat: 'category', title: 'title', eqp: 'eqp_id', at: 'at' }} flag={(r) => (r.severity === 'CRIT' ? 'flag' : r.severity === 'HIGH' ? 'warn' : '')} />}
                {item === 'flow' && <ServerTable key={item} productId={d.product.product_id} item={item} params={{ ...sp, kind: stepKind === 'all' ? undefined : stepKind }} cols={cols.flow} rowKey={(r) => `${r.step_type}-${r.step_id}`} file={file} placeholder="스텝, 레시피, 스테이지, 계측 항목 검색 (서버 검색)" onRow={(x) => onOpenStep(x.process_step_id ?? x.step_id)} field={{ seq: 'seq', type: 'step_type', link: 'meas_step_id', name: 'step_name', stage: 'stage', grade: 'step_grade', mod: 'module', rcp: 'recipe_id', il: 'il_recent', forced: 'il_forced', bm: 'bm_window', chg: 'changes_window', cpk: 'spc.cpk', risk: 'risk_score', eqrisk: 'eqp_level' }} flag={(x) => (x.risk_level === 'CRIT' ? 'flag' : x.risk_level !== 'OK' ? 'warn' : '')} />}
                {item === 'target' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.target} rowKey={(r) => r.step_id} file={file} placeholder="스텝, 항목, 부서 검색 (서버 검색)" onRow={(x) => onOpenStep(x.step_id)} field={{ seq: 'seq', stage: 'stage', grade: 'step_grade', param: 'param', tgt: 'target.target', lsl: 'target.lsl', usl: 'target.usl', meas: 'meas_step_id', lcl: 'target.lcl', ucl: 'target.ucl', mean: 'spc.mean', sw: 'spc.sigma_within', so: 'spc.sigma_overall', cp: 'spc.cp', cpk: 'spc.cpk', pp: 'spc.pp', ppk: 'spc.ppk', req: 'spc.req', ooc: 'spc.ooc_30d', oos: 'spc.oos_30d', n: 'spc.n', rev: 'target.rev', eff: 'target.effective_from', own: 'target.owner' }} flag={(x) => ((x.spc?.cpk ?? 9) < 1 ? 'flag' : x.spc?.meets === false || (x.tttm ?? []).some((t) => t.flag) ? 'warn' : '')} />}
                {item === 'spec' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.spec} rowKey={(r) => r.change_id} file={file} placeholder="스텝, 항목, 사유, ECN 검색 (서버 검색)" field={{ at: 'changed_at', param: 'param', rev: 'rev', reason: 'reason', req: 'requested_by', app: 'approved_by', ecn: 'ecn_no' }} flag={(r) => (widened(r) ? 'flag' : r.approved_by === r.requested_by ? 'warn' : '')} />}
                {item === 'il' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.il} rowKey={(r) => r.interlock_id} file={file} placeholder="설비, 코드, 내용, 해제자, LOT 검색 (서버 검색)" field={{ at: 'occurred_at', eqp: 'eqp_id', code: 'il_code', cat: 'category', sev: 'severity', desc: 'description', rel: 'release_type', by: 'released_by', relat: 'released_at', lot: 'lot_id' }} flag={(r) => ((r.release_type === '강제 해제' && r.released_at) || !r.released_at ? 'flag' : flagged.has(r.interlock_id) ? 'warn' : '')} />}
                {item === 'pmbm' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.pmbm} rowKey={(r) => r.mt_id} file={file} placeholder="설비, 사유, 부품 검색 (서버 검색)" field={{ at: 'start_at', eqp: 'eqp_id', type: 'mt_type', reason: 'reason', parts: 'parts', end: 'end_at', qual: 'qual_result', qat: 'qual_at', lots: 'lots_before_qual', by: 'performed_by' }} flag={(r) => ((r.lots_before_qual ?? 0) > 0 || r.qual_result === 'FAIL' ? 'flag' : r.qual_result === 'PENDING' || flagged.has(r.mt_id) ? 'warn' : '')} />}
                {item === 'chg' && <ServerTable key={item} productId={d.product.product_id} item={item} params={sp} cols={cols.chg} rowKey={(r) => r.change_id} file={file} placeholder="설비, 항목, ECN, 요청·승인자 검색 (서버 검색)" field={{ at: 'changed_at', eqp: 'eqp_id', cat: 'category', item: 'item', ecn: 'ecn_no', req: 'requested_by', app: 'approved_by', appat: 'approved_at', ver: 'verify_status' }} flag={(r) => (badChange(r) ? 'flag' : r.verify_status !== '완료' ? 'warn' : '')} />}
              </>
            ) : (
              <>
                {item === 'risk' && <DataTable key={item} rows={rows.risk} cols={cols.risk} rowKey={(r) => r.id} file={file} serverCsv={csvUrl} placeholder="규칙, 내용, 근거, 설비 검색" flag={(r) => (r.severity === 'CRIT' ? 'flag' : r.severity === 'HIGH' ? 'warn' : '')} />}
                {item === 'flow' && <DataTable key={item} rows={rows.flow} cols={cols.flow} rowKey={(r) => `${r.step_type}-${r.step_id}`} file={file} serverCsv={csvUrl} placeholder="스텝, 레시피, 모델 검색" onRow={(s) => onOpenStep(s.process_step_id ?? s.step_id)} flag={(s) => (s.risk_level === 'CRIT' ? 'flag' : s.risk_level === 'HIGH' ? 'warn' : '')} />}
                {item === 'target' && <DataTable key={item} rows={rows.target} cols={cols.target} rowKey={(r) => r.step_id} file={file} serverCsv={csvUrl} placeholder="스텝, 항목, 부서 검색" onRow={(s) => onOpenStep(s.step_id)} flag={(s) => ((s.spc?.cpk ?? 9) < 1 ? 'flag' : s.spc?.meets === false || (s.tttm ?? []).some((t) => t.flag) ? 'warn' : '')} />}
                {item === 'spec' && <DataTable key={item} rows={rows.spec} cols={cols.spec} rowKey={(r) => r.change_id} file={file} serverCsv={csvUrl} placeholder="스텝, 항목, 사유, ECN 검색" flag={(r) => (widened(r) ? 'flag' : r.approved_by === r.requested_by ? 'warn' : '')} />}
                {item === 'il' && <DataTable key={item} rows={rows.il} cols={cols.il} rowKey={(r) => r.interlock_id} file={file} serverCsv={csvUrl} placeholder="설비, 코드, 내용, 해제자, LOT 검색" flag={(r) => ((r.release_type === '강제 해제' && r.released_at) || !r.released_at ? 'flag' : flagged.has(r.interlock_id) ? 'warn' : '')} />}
                {item === 'pmbm' && <DataTable key={item} rows={rows.pmbm} cols={cols.pmbm} rowKey={(r) => r.mt_id} file={file} serverCsv={csvUrl} placeholder="설비, 사유, 부품 검색" flag={(r) => ((r.lots_before_qual ?? 0) > 0 || r.qual_result === 'FAIL' ? 'flag' : r.qual_result === 'PENDING' || flagged.has(r.mt_id) ? 'warn' : '')} />}
                {item === 'chg' && <DataTable key={item} rows={rows.chg} cols={cols.chg} rowKey={(r) => r.change_id} file={file} serverCsv={csvUrl} placeholder="설비, 항목, ECN, 요청·승인자 검색" flag={(r) => (badChange(r) ? 'flag' : r.verify_status !== '완료' ? 'warn' : '')} />}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
