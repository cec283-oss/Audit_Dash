import { useMemo } from 'react';
import type { Change, Dossier, Interlock, Maint, RiskPoint, Step, TargetChange } from '../../types';
import { CAT_NAME, fmtDT, num, SEV_LABEL } from '../../lib';
import type { Col } from '../DataTable';

export const ITEMS = [
  { key: 'risk', name: '리스크 포인트', eyebrow: 'Risk points', desc: '규칙에 걸린 감사 포인트와 근거' },
  { key: 'flow', name: '공정흐름', eyebrow: 'Process flow', desc: '스텝·레시피·호환설비·이력 건수' },
  { key: 'target', name: '타겟표준 · SPC', eyebrow: 'Target standard', desc: '타겟·LSL·USL과 공정능력' },
  { key: 'spec', name: '스펙 개정 이력', eyebrow: 'Spec revisions', desc: '규격 변경 전후·승인' },
  { key: 'eqp', name: '호환설비', eyebrow: 'Compatible tools', desc: '설비·모델별 집계와 매트릭스' },
  { key: 'il', name: '인터락 이력', eyebrow: 'Interlocks', desc: '발생·해제·강제 해제' },
  { key: 'pmbm', name: 'PM/BM 이력', eyebrow: 'Maintenance', desc: 'PM·BM·Qual·Qual 전 LOT' },
  { key: 'chg', name: '변경 이력', eyebrow: 'Changes', desc: '레시피·H/W·S/W·FDC 변경과 승인' },
] as const;
export type ItemKey = (typeof ITEMS)[number]['key'];
export const isItem = (k: string): k is ItemKey => ITEMS.some((x) => x.key === k);

export const cpkCls = (c?: number | null, req = 1.33) => (c == null ? '' : c < 1 ? 'bad' : c < req ? 'mid' : 'good');
export const widened = (r: TargetChange) => ((r.usl_after ?? 0) - (r.lsl_after ?? 0)) > ((r.usl_before ?? 0) - (r.lsl_before ?? 0)) + 1e-9;
export const badChange = (r: Change) => !r.approved_by || r.approved_by === r.requested_by;

export function SpecBar({ s }: { s: Step }) {
  const t = s.target, sp = s.spc;
  if (!t || t.lsl == null || t.usl == null) return <span className="muted">-</span>;
  const w = t.usl - t.lsl, lo = t.lsl - w * 0.25, hi = t.usl + w * 0.25;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <span className="spec-bar" aria-label={`LSL ${t.lsl}, 타겟 ${t.target}, USL ${t.usl}${sp?.mean != null ? `, 평균 ${sp.mean}` : ''}`}>
      <span className="w" style={{ left: pos(t.lsl), right: `calc(100% - ${pos(t.usl)})` }} />
      {t.target != null && <span className="t" style={{ left: pos(t.target) }} />}
      {sp?.mean != null && <span className="m" style={{ left: pos(sp.mean) }} />}
    </span>
  );
}

export function Matrix({ d, stage, onStage, onStep, onEqp }: { d: Dossier; stage: string; onStage: (s: string) => void; onStep: (id: string) => void; onEqp: (id: string) => void }) {
  const byModel = useMemo(() => {
    const m = new Map<string, string[]>();
    [...d.equipment].sort((a, b) => (a.module ?? '').localeCompare(b.module ?? '') || a.eqp_model.localeCompare(b.eqp_model) || a.eqp_id.localeCompare(b.eqp_id))
      .forEach((e) => m.set(e.eqp_model, [...(m.get(e.eqp_model) ?? []), e.eqp_id]));
    return [...m.entries()];
  }, [d]);
  const eq = useMemo(() => new Map(d.equipment.map((e) => [e.eqp_id, e])), [d]);
  const cols = byModel.flatMap(([, ids]) => ids);
  const first = new Set(byModel.map(([, ids]) => ids[0]));
  return (
    <>
      <div className="mx-wrap">
        <table className="mx">
          <thead>
            <tr><th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--panel-hi)' }} />
              {cols.map((id) => <th key={id} className={`mh${first.has(id) ? ' sep' : ''}`}><button style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onEqp(id)}>{id}</button></th>)}
            </tr>
            <tr className="models"><th style={{ position: 'sticky', left: 0, zIndex: 3 }} />
              {byModel.map(([m, ids]) => <th key={m} colSpan={ids.length} className="sep">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {!stage && d.stages.map((st) => {
              const use = new Map<string, number>();
              d.steps.forEach((s) => { if (s.stage === st.stage) s.compat.forEach((c) => c.qualified && use.set(c.eqp_id, (use.get(c.eqp_id) ?? 0) + 1)); });
              return (
                <tr key={st.stage}>
                  <th><button style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onStage(st.stage)}><small>{st.steps}스텝</small>{st.stage}</button></th>
                  {cols.map((id) => {
                    const n = use.get(id), e = eq.get(id)!;
                    return <td key={id} className={first.has(id) ? 'sep' : ''}>{n ? <span className={`dot cnt${e.risk_score >= 12 ? ' hot' : e.risk_score > 0 ? ' warm' : ''}`} title={`${st.stage} × ${id} · 스텝 ${n}개`}>{n}</span> : null}</td>;
                  })}
                </tr>
              );
            })}
            {!!stage && d.steps.filter((s) => s.stage === stage).map((s) => {
              const cs = new Map(s.compat.map((c) => [c.eqp_id, c]));
              return (
                <tr key={s.step_id}>
                  <th><button style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onStep(s.step_id)}><small>{String(s.seq).padStart(3, '0')}</small>{s.step_name}</button></th>
                  {cols.map((id) => {
                    const c = cs.get(id), e = eq.get(id)!;
                    const hot = e.risk_score >= 12, warm = e.risk_score > 0;
                    return (
                      <td key={id} className={first.has(id) ? 'sep' : ''}>
                        {c && <span className={`dot${c.qualified ? '' : ' nq'}${c.qualified && hot ? ' hot' : c.qualified && warm ? ' warm' : ''}`}
                          title={`${s.step_name} × ${id} (${e.eqp_model}) · ${c.qualified ? '인증' : '등록만, 미인증'} · 인터락 ${e.il_window} · BM ${e.bm_window} · 리스크 ${e.risk_score}`} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mx-legend">
        <span><i className="dot" style={{ display: 'inline-block' }} />인증 호환설비</span>
        <span><i className="dot warm" style={{ display: 'inline-block' }} />리스크 포인트 있음</span>
        <span><i className="dot hot" style={{ display: 'inline-block' }} />리스크 점수 12 이상</span>
        <span><i className="dot nq" style={{ display: 'inline-block' }} />등록만 (미인증)</span>
        <span className="muted">{stage ? '열은 설비 모델별로 묶었습니다 · 스텝·설비 이름을 누르면 필터' : '스테이지별로 그 설비를 쓰는 스텝 수 · 스테이지를 누르면 스텝 단위로 펼침'}</span>
      </div>
    </>
  );
}

type Ctx = { d: Dossier; stepName: Map<string, string>; onStep: (id: string) => void; onEqp: (id: string) => void };

export function buildCols({ d, stepName, onStep, onEqp }: Ctx) {
  const eqBtn = (id?: string | null) => (id ? <button className="chip mono" onClick={(e) => { e.stopPropagation(); onEqp(id); }}>{id}</button> : '-');
  const stBtn = (id: string) => <button className="chip" onClick={(e) => { e.stopPropagation(); onStep(id); }}>{stepName.get(id) ?? id}</button>;

  const risk: Col<RiskPoint>[] = [
    { key: 'id', label: 'ID', mono: true, value: (r) => r.id },
    { key: 'sev', label: '심각도', value: (r) => ['CRIT', 'HIGH', 'MED', 'LOW'].indexOf(r.severity), render: (r) => <span className={`sev ${r.severity}`}>{SEV_LABEL[r.severity]}</span> },
    { key: 'rule', label: '규칙', value: (r) => r.rule_name },
    { key: 'cat', label: '영역', value: (r) => CAT_NAME[r.category] },
    { key: 'title', label: '내용', wrap: true, value: (r) => r.title },
    { key: 'ev', label: '근거', wrap: true, value: (r) => r.evidence },
    { key: 'steps', label: '스텝', value: (r) => r.steps.map((s) => stepName.get(s)).join(', '), render: (r) => <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{r.steps.slice(0, 3).map(stBtn)}{r.steps.length > 3 && <span className="muted">+{r.steps.length - 3}</span>}</span> },
    { key: 'eqp', label: '설비', mono: true, value: (r) => r.eqp_id, render: (r) => eqBtn(r.eqp_id) },
    { key: 'at', label: '발생', mono: true, value: (r) => fmtDT(r.at) },
    { key: 'refs', label: '근거 이력 ID', mono: true, value: (r) => r.refs.join(' ') },
  ];
  const flow: Col<Step>[] = [
    { key: 'seq', label: '순번', num: true, value: (s) => s.seq },
    { key: 'type', label: '구분', value: (s) => (s.step_type === 'meas' ? '계측' : '공정'), render: (s) => <span className={`stype ${s.step_type === 'meas' ? 'meas' : 'proc'}`}>{s.step_type === 'meas' ? '계측' : '공정'}</span> },
    { key: 'name', label: '스텝', value: (s) => s.step_name, render: (s) => (s.step_type === 'meas' ? <span className="mstep"><b className="mono">{s.step_id}</b> {s.step_name}</span> : stBtn(s.step_id)) },
    { key: 'link', label: '연결 스텝', value: (s) => (s.step_type === 'meas' ? s.process_step_id : s.meas_step_id) ?? '', render: (s) => (s.step_type === 'meas'
      ? <span className="muted">← 측정 대상 {s.process_step_id ? stBtn(s.process_step_id) : '-'}</span>
      : s.meas_step_id ? <span className="muted">→ 계측 <b className="mono">{s.meas_step_id}</b></span> : <span className="muted">-</span>) },
    { key: 'stage', label: '스테이지', value: (s) => s.stage },
    { key: 'grade', label: '등급', value: (s) => s.step_grade, render: (s) => <span className={`gr g${s.step_grade}`}>{s.step_grade}</span> },
    { key: 'mod', label: '모듈', value: (s) => s.module },
    { key: 'rcp', label: '레시피', mono: true, value: (s) => s.recipe_id },
    { key: 'eq', label: '인증/등록 설비', num: true, value: (s) => s.compat.filter((c) => c.qualified).length, render: (s) => `${s.compat.filter((c) => c.qualified).length} / ${s.compat.length}` },
    { key: 'models', label: '모델', value: (s) => s.models.join(', ') },
    { key: 'il', label: '인터락 30일', num: true, value: (s) => s.il_recent },
    { key: 'forced', label: '강제 해제', num: true, value: (s) => s.il_forced, render: (s) => <span style={{ color: s.il_forced ? 'var(--crit)' : undefined }}>{s.il_forced}</span> },
    { key: 'bm', label: `BM ${d.window_days}일`, num: true, value: (s) => s.bm_window },
    { key: 'chg', label: `변경 ${d.window_days}일`, num: true, value: (s) => s.changes_window },
    { key: 'rev', label: '스펙 Rev', num: true, value: (s) => s.target?.rev },
    { key: 'cpk', label: 'Cpk', num: true, value: (s) => s.spc?.cpk, render: (s) => <span className={`cpk ${cpkCls(s.spc?.cpk)}`}>{num(s.spc?.cpk)}</span> },
    { key: 'risk', label: '공정 리스크', num: true, value: (s) => s.risk_score, render: (s) => <span className={`sev ${s.risk_level}`}>{s.risk_level === 'OK' ? '이상 없음' : SEV_LABEL[s.risk_level]}</span> },
    { key: 'eqrisk', label: '설비 노출', value: (s) => s.eqp_level, render: (s) => <span className={`sev ${s.eqp_level}`}>{s.eqp_level === 'OK' ? '이상 없음' : SEV_LABEL[s.eqp_level]}</span> },
  ];
  const target: Col<Step>[] = [
    { key: 'seq', label: '스텝', value: (s) => s.seq, render: (s) => stBtn(s.step_id) },
    { key: 'stage', label: '스테이지', value: (s) => s.stage },
    { key: 'grade', label: '등급', value: (s) => s.step_grade, render: (s) => <span className={`gr g${s.step_grade}`}>{s.step_grade}</span> },
    { key: 'param', label: '계측 항목', value: (s) => s.param },
    { key: 'meas', label: '계측 스텝', mono: true, value: (s) => s.meas_step_id ?? '' },
    { key: 'tgt', label: '타겟', num: true, value: (s) => s.target?.target },
    { key: 'lsl', label: 'LSL', num: true, value: (s) => s.target?.lsl },
    { key: 'usl', label: 'USL', num: true, value: (s) => s.target?.usl },
    { key: 'unit', label: '단위', value: (s) => s.unit },
    { key: 'bar', label: '규격 · 평균', value: (s) => s.spc?.mean, render: (s) => <SpecBar s={s} /> },
    { key: 'lcl', label: 'LCL', num: true, value: (s) => s.target?.lcl },
    { key: 'ucl', label: 'UCL', num: true, value: (s) => s.target?.ucl },
    { key: 'mean', label: '평균', num: true, value: (s) => s.spc?.mean },
    { key: 'sw', label: 'σ군내', num: true, value: (s) => s.spc?.sigma_within },
    { key: 'so', label: 'σ전체', num: true, value: (s) => s.spc?.sigma_overall },
    { key: 'cp', label: 'Cp', num: true, value: (s) => s.spc?.cp, render: (s) => <span className={`cpk ${cpkCls(s.spc?.cp, s.spc?.req)}`}>{num(s.spc?.cp)}</span> },
    { key: 'cpk', label: 'Cpk', num: true, value: (s) => s.spc?.cpk, render: (s) => <span className={`cpk ${cpkCls(s.spc?.cpk, s.spc?.req)}`}>{num(s.spc?.cpk)}</span> },
    { key: 'pp', label: 'Pp', num: true, value: (s) => s.spc?.pp, render: (s) => <span className={`cpk ${cpkCls(s.spc?.pp)}`}>{num(s.spc?.pp)}</span> },
    { key: 'ppk', label: 'Ppk', num: true, value: (s) => s.spc?.ppk, render: (s) => <span className={`cpk ${cpkCls(s.spc?.ppk)}`}>{num(s.spc?.ppk)}</span> },
    { key: 'req', label: '요구 Cpk', num: true, value: (s) => s.spc?.req, render: (s) => (s.spc?.req != null ? <span className={s.spc.meets === false ? 't-crit' : 't-ok'}>{s.spc.req.toFixed(2)} {s.spc.meets === false ? '✕' : '✓'}</span> : '-') },
    { key: 'tools', label: '설비 매칭', value: (s) => s.tttm?.filter((x) => x.flag).map((x) => x.eqp_id).join(' ') ?? '', render: (s) => {
      const bad = (s.tttm ?? []).filter((x) => x.flag);
      return s.tttm?.length ? (bad.length ? <span className="t-crit">{bad.map((x) => `${x.eqp_id} (M/S ${x.ms ?? '-'} · S/R ${x.sr ?? '-'})`).join(', ')}</span> : <span className="t-ok">✓ {s.tttm.length}대 양호</span>) : '-';
    } },
    { key: 'ooc', label: 'OOC 30일', num: true, value: (s) => s.spc?.ooc_30d },
    { key: 'oos', label: 'OOS 30일', num: true, value: (s) => s.spc?.oos_30d },
    { key: 'n', label: 'n', num: true, value: (s) => s.spc?.n },
    { key: 'rev', label: 'Rev', num: true, value: (s) => s.target?.rev },
    { key: 'eff', label: '적용일', mono: true, value: (s) => s.target?.effective_from },
    { key: 'own', label: '관리 부서', value: (s) => s.target?.owner },
  ];
  const spec: Col<TargetChange>[] = [
    { key: 'at', label: '개정일', mono: true, value: (r) => fmtDT(r.changed_at) },
    { key: 'step', label: '스텝', value: (r) => stepName.get(r.step_id), render: (r) => stBtn(r.step_id) },
    { key: 'param', label: '항목', value: (r) => r.param },
    { key: 'rev', label: 'Rev', num: true, value: (r) => r.rev },
    { key: 'tgt', label: '타겟', value: (r) => `${r.target_before} → ${r.target_after}` },
    { key: 'lsl', label: 'LSL', value: (r) => `${r.lsl_before} → ${r.lsl_after}`, render: (r) => <span className={(r.lsl_after ?? 0) < (r.lsl_before ?? 0) ? 'delta-w' : ''}>{r.lsl_before} → {r.lsl_after}</span> },
    { key: 'usl', label: 'USL', value: (r) => `${r.usl_before} → ${r.usl_after}`, render: (r) => <span className={(r.usl_after ?? 0) > (r.usl_before ?? 0) ? 'delta-w' : ''}>{r.usl_before} → {r.usl_after}</span> },
    { key: 'w', label: '규격 폭', value: (r) => num(((r.usl_after ?? 0) - (r.lsl_after ?? 0)) - ((r.usl_before ?? 0) - (r.lsl_before ?? 0)), 3),
      render: (r) => { const dw = ((r.usl_after ?? 0) - (r.lsl_after ?? 0)) - ((r.usl_before ?? 0) - (r.lsl_before ?? 0)); return <span className={dw > 1e-9 ? 'delta-w' : 'delta-n'}>{dw > 1e-9 ? '확대 +' : '축소 '}{num(Math.abs(dw), 3)}</span>; } },
    { key: 'reason', label: '사유', wrap: true, value: (r) => r.reason },
    { key: 'req', label: '요청', value: (r) => r.requested_by },
    { key: 'app', label: '승인', value: (r) => r.approved_by, render: (r) => r.approved_by === r.requested_by ? <span className="sev HIGH">{r.approved_by} (본인)</span> : r.approved_by || <span className="sev CRIT">없음</span> },
    { key: 'ecn', label: 'ECN', mono: true, value: (r) => r.ecn_no },
  ];
  const il: Col<Interlock>[] = [
    { key: 'at', label: '발생', mono: true, value: (r) => fmtDT(r.occurred_at) },
    { key: 'eqp', label: '설비', mono: true, value: (r) => r.eqp_id, render: (r) => eqBtn(r.eqp_id) },
    { key: 'model', label: '모델', value: (r) => d.equipment.find((e) => e.eqp_id === r.eqp_id)?.eqp_model },
    { key: 'code', label: '코드', mono: true, value: (r) => r.il_code },
    { key: 'cat', label: '구분', value: (r) => r.category },
    { key: 'sev', label: '심각도', value: (r) => r.severity, render: (r) => <span className={`sev ${r.severity === 'CRIT' ? 'CRIT' : r.severity === 'MAJOR' ? 'HIGH' : 'MED'}`}>{r.severity}</span> },
    { key: 'desc', label: '내용', wrap: true, value: (r) => r.description },
    { key: 'rel', label: '해제', value: (r) => (r.released_at ? r.release_type : '미해제'), render: (r) => r.released_at ? <span style={{ color: r.release_type === '강제 해제' ? 'var(--crit)' : undefined, fontWeight: r.release_type === '강제 해제' ? 600 : 400 }}>{r.release_type}</span> : <span className="sev CRIT">미해제</span> },
    { key: 'by', label: '해제자', value: (r) => (r.released_at ? r.released_by : '') },
    { key: 'relat', label: '해제 시각', mono: true, value: (r) => fmtDT(r.released_at) },
    { key: 'lot', label: 'LOT', mono: true, value: (r) => r.lot_id },
    { key: 'step', label: '스텝', value: (r) => (r.product_id === d.product.product_id ? stepName.get(r.step_id ?? '') : r.product_id ? `타 공법 ${r.product_id}` : '') },
  ];
  const pmbm: Col<Maint>[] = [
    { key: 'at', label: '시작', mono: true, value: (r) => fmtDT(r.start_at) },
    { key: 'eqp', label: '설비', mono: true, value: (r) => r.eqp_id, render: (r) => eqBtn(r.eqp_id) },
    { key: 'model', label: '모델', value: (r) => d.equipment.find((e) => e.eqp_id === r.eqp_id)?.eqp_model },
    { key: 'type', label: '구분', value: (r) => r.mt_type, render: (r) => <span className={`sev ${r.mt_type === 'BM' ? 'HIGH' : 'OK'}`}>{r.mt_type}</span> },
    { key: 'reason', label: '사유', wrap: true, value: (r) => r.reason },
    { key: 'parts', label: '교체 부품', value: (r) => r.parts },
    { key: 'end', label: '종료', mono: true, value: (r) => fmtDT(r.end_at) },
    { key: 'qual', label: 'Qual', value: (r) => r.qual_result, render: (r) => <span className={`sev ${r.qual_result === 'PASS' ? 'OK' : r.qual_result === 'FAIL' ? 'CRIT' : 'HIGH'}`}>{r.qual_result ?? '-'}</span> },
    { key: 'qat', label: 'Qual 완료', mono: true, value: (r) => fmtDT(r.qual_at) },
    { key: 'lots', label: 'Qual 전 LOT', num: true, value: (r) => r.lots_before_qual ?? 0, render: (r) => <span style={{ color: r.lots_before_qual ? 'var(--crit)' : undefined, fontWeight: r.lots_before_qual ? 700 : 400 }}>{r.lots_before_qual ?? 0}</span> },
    { key: 'by', label: '수행', value: (r) => r.performed_by },
  ];
  const chg: Col<Change>[] = [
    { key: 'at', label: '변경', mono: true, value: (r) => fmtDT(r.changed_at) },
    { key: 'eqp', label: '설비', mono: true, value: (r) => r.eqp_id, render: (r) => eqBtn(r.eqp_id) },
    { key: 'cat', label: '구분', value: (r) => r.category },
    { key: 'item', label: '항목', value: (r) => r.item },
    { key: 'ba', label: '변경 전 → 후', wrap: true, value: (r) => `${r.before ?? ''} → ${r.after ?? ''}` },
    { key: 'ecn', label: 'ECN', mono: true, value: (r) => r.ecn_no },
    { key: 'req', label: '요청', value: (r) => r.requested_by },
    { key: 'app', label: '승인', value: (r) => r.approved_by, render: (r) => !r.approved_by ? <span className="sev CRIT">승인 없음</span> : r.approved_by === r.requested_by ? <span className="sev HIGH">{r.approved_by} (본인)</span> : r.approved_by },
    { key: 'appat', label: '승인 시각', mono: true, value: (r) => fmtDT(r.approved_at) },
    { key: 'ver', label: '검증', value: (r) => r.verify_status, render: (r) => <span className={`sev ${r.verify_status === '완료' ? 'OK' : r.verify_status === '미실시' ? 'CRIT' : 'MED'}`}>{r.verify_status ?? '-'}</span> },
    { key: 'step', label: '공법 스텝', value: (r) => (r.step_id ? stepName.get(r.step_id) ?? r.step_id : '') },
  ];
  return { risk, flow, target, spec, il, pmbm, chg };
}
