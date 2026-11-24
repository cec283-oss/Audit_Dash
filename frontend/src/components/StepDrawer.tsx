import { useEffect, useMemo, useRef } from 'react';
import type { Dossier, Step } from '../types';
import { fmtDT, fmtMD, moduleVar, num, SEV_LABEL, sevColor } from '../lib';
import { cpkCls } from './detail/columns';
import { tl } from './detail/Capability';

function Dist({ s }: { s: Step }) {
  const t = s.target, sp = s.spc;
  if (!t || t.lsl == null || t.usl == null) return null;
  const W = 480, H = 130, pad = 10;
  const w = t.usl - t.lsl, lo = t.lsl - w * 0.35, hi = t.usl + w * 0.35;
  const X = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - pad * 2);
  const mean = sp?.mean ?? t.target ?? (t.lsl + t.usl) / 2, sig = sp?.sigma_overall ?? sp?.sigma_within ?? w / 8;
  const pts: string[] = [];
  let maxY = 0;
  const ys: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const v = lo + ((hi - lo) * i) / 120;
    const y = Math.exp(-0.5 * ((v - mean) / sig) ** 2);
    ys.push([v, y]); maxY = Math.max(maxY, y);
  }
  ys.forEach(([v, y]) => pts.push(`${X(v).toFixed(1)},${(H - 22 - (y / maxY) * (H - 40)).toFixed(1)}`));
  const area = `M${X(lo)},${H - 22} L${pts.join(' L')} L${X(hi)},${H - 22} Z`;
  const lim = (v: number, label: string, cls: string) => (
    <g key={label}>
      <line x1={X(v)} x2={X(v)} y1={8} y2={H - 22} style={{ stroke: `var(${cls})` }} strokeWidth={1.5} strokeDasharray={label === 'Target' ? '4 3' : undefined} />
      <text x={X(v)} y={H - 6} textAnchor="middle" style={{ fill: `var(${cls})`, fontSize: 12, fontFamily: 'IBM Plex Mono' }}>{label} {num(v)}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${s.param} 분포와 규격: LSL ${t.lsl}, USL ${t.usl}, 평균 ${num(mean)}`}>
      <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.45 }} /><stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} /></linearGradient></defs>
      <rect x={X(lo)} y={8} width={X(t.lsl) - X(lo)} height={H - 30} style={{ fill: 'var(--crit-a)' }} />
      <rect x={X(t.usl)} y={8} width={X(hi) - X(t.usl)} height={H - 30} style={{ fill: 'var(--crit-a)' }} />
      <path d={area} style={{ fill: 'url(#dg)', stroke: 'var(--accent)' }} strokeWidth={1.8} />
      {lim(t.lsl, 'LSL', '--crit')}{lim(t.usl, 'USL', '--crit')}{t.target != null && lim(t.target, 'Target', '--aqua')}
      <circle cx={X(mean)} cy={14} r={4} style={{ fill: 'var(--fg)' }} />
      <text x={X(mean)} y={28} textAnchor="middle" style={{ fill: 'var(--fg-2)', fontSize: 12, fontFamily: 'IBM Plex Mono' }}>μ {num(mean, 3)}</text>
    </svg>
  );
}

export default function StepDrawer({ d, stepId, onClose, onEqp, onSim }: { d: Dossier; stepId: string; onClose: () => void; onEqp: (id: string) => void; onSim?: (id: string) => void }) {
  const s = d.steps.find((x) => x.step_id === stepId)!;
  const L = tl(d);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [stepId]);
  const ids = useMemo(() => new Set(s.compat.map((c) => c.eqp_id)), [s]);
  const pts = d.risk_points.filter((p) => p.steps.includes(stepId));
  const revs = d.target_changes.filter((c) => c.step_id === stepId);
  const eqs = d.equipment.filter((e) => ids.has(e.eqp_id));
  const byModel = [...new Set(eqs.map((e) => e.eqp_model))];
  const events = [
    ...d.interlocks.filter((i) => ids.has(i.eqp_id)).map((i) => ({ at: i.occurred_at, c: i.release_type === '강제 해제' || !i.released_at ? 'var(--crit)' : 'var(--high)', t: `${i.eqp_id} 인터락 ${i.il_code}`, s: `${i.description ?? ''} · ${i.released_at ? i.release_type : '미해제'}` })),
    ...d.maintenance.filter((m) => ids.has(m.eqp_id) && m.mt_type === 'BM').map((m) => ({ at: m.start_at, c: m.lots_before_qual ? 'var(--crit)' : 'var(--high)', t: `${m.eqp_id} BM · ${m.reason ?? ''}`, s: `교체 ${m.parts ?? '-'} · Qual ${m.qual_result ?? '-'}${m.lots_before_qual ? ` · Qual 전 LOT ${m.lots_before_qual}` : ''}` })),
    ...d.changes.filter((c) => (c.eqp_id && ids.has(c.eqp_id)) || c.step_id === stepId).map((c) => ({ at: c.changed_at, c: !c.approved_by || c.approved_by === c.requested_by ? 'var(--crit)' : 'var(--aqua)', t: `${c.eqp_id ?? ''} ${c.category} · ${c.item ?? ''}`, s: `${c.before ?? ''} → ${c.after ?? ''} · 승인 ${c.approved_by || '없음'}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title">
        <div className="dr-h" style={{ borderTop: `3px solid ${moduleVar(s.module)}` }}>
          <div>
            <p className="eyebrow">STEP {String(s.seq).padStart(3, '0')} · {s.module}{s.critical ? ' · 핵심 스텝' : ''}</p>
            <h3 id="dr-title">{s.step_name}</h3>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span className={`sev ${s.risk_level}`}>{s.risk_level === 'OK' ? '이상 없음' : SEV_LABEL[s.risk_level]}</span>
              <span className="tag">리스크 포인트 {pts.length}</span>
              <span className="tag">{d.product.product_name}</span>
            </div>
          </div>
          <button ref={closeRef} className="icon-btn x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="dr-b">
          <div className="dr-sec">
            <h4>타겟표준 · 공정능력</h4>
            <div className="spec-big"><Dist s={s} /></div>
            <dl className="kv">
              <div><dt>계측 항목</dt><dd style={{ fontFamily: 'var(--f-body)' }}>{s.param}</dd></div>
              <div><dt>계측 스텝</dt><dd style={{ fontSize: 13.5 }}>{s.meas_step_id ?? '-'} <span style={{ fontFamily: 'var(--f-body)', color: 'var(--muted)' }}>{s.meas_step_name ?? ''}</span></dd></div>
              <div><dt>타겟</dt><dd>{num(s.target?.target)} {s.unit}</dd></div>
              <div><dt>LSL ~ USL</dt><dd>{num(s.target?.lsl)} ~ {num(s.target?.usl)}</dd></div>
              <div><dt>C/L (LCL ~ UCL)</dt><dd>{num(s.target?.lcl)} ~ {num(s.target?.ucl)}</dd></div>
              <div><dt>Cp / Cpk</dt><dd><span className={`cpk ${cpkCls(s.spc?.cp, s.spc?.req)}`}>{num(s.spc?.cp)}</span> / <span className={`cpk ${cpkCls(s.spc?.cpk, s.spc?.req)}`}>{num(s.spc?.cpk)}</span></dd></div>
              <div><dt>Pp / Ppk</dt><dd><span className={`cpk ${cpkCls(s.spc?.pp)}`}>{num(s.spc?.pp)}</span> / <span className={`cpk ${cpkCls(s.spc?.ppk)}`}>{num(s.spc?.ppk)}</span></dd></div>
              <div><dt>등급 요구 Cpk</dt><dd className={s.spc?.meets === false ? 't-crit' : 't-ok'}>{s.spc?.req?.toFixed(2) ?? '-'} {s.spc?.meets === false ? '미달' : s.spc?.meets ? '충족' : ''}</dd></div>
              <div><dt>OOC / OOS (30일)</dt><dd>{s.spc?.ooc_30d ?? '-'} / {s.spc?.oos_30d ?? '-'}</dd></div>
              <div><dt>표준 Rev</dt><dd>{s.target?.rev ?? '-'} ({s.target?.effective_from ?? '-'})</dd></div>
              <div><dt>관리 부서</dt><dd style={{ fontFamily: 'var(--f-body)' }}>{s.target?.owner ?? '-'}</dd></div>
              <div><dt>레시피</dt><dd style={{ fontSize: 13 }}>{s.recipe_id ?? '-'}</dd></div>
            </dl>
          </div>

          {(s.tttm ?? []).length > 0 && (
            <div className="dr-sec">
              <h4>설비별 공정능력 · TTTM <button className="linkish" style={{ marginLeft: 8, fontSize: 13 }} onClick={() => onSim?.(s.step_id)}>C/L·S/L 시뮬레이션 →</button></h4>
              <table className="cap-tools">
                <thead><tr><th>설비</th><th className="num">n</th><th className="num">평균</th><th className="num">σ군내</th><th className="num">M/S</th><th className="num">S/R</th><th className="num">Cpk</th><th className="num">Ppk</th></tr></thead>
                <tbody>
                  {s.tttm.map((x) => (
                    <tr key={x.eqp_id} className={x.flag ? 'flag' : ''}>
                      <td className="mono"><b>{x.eqp_id}</b></td><td className="num">{x.n ?? '-'}</td><td className="num">{num(x.mean, 4)}</td><td className="num">{num(x.sigma_within, 4)}</td>
                      <td className={`num ${Math.abs(x.ms ?? 0) >= L.ms ? 't-crit' : ''}`}>{x.ms ?? '-'}</td><td className={`num ${(x.sr ?? 0) >= L.sr ? 't-crit' : ''}`}>{x.sr ?? '-'}</td>
                      <td className={`num cpk ${cpkCls(x.cpk, s.spc?.req)}`}>{num(x.cpk)}</td><td className={`num cpk ${cpkCls(x.ppk)}`}>{num(x.ppk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pts.length > 0 && (
            <div className="dr-sec">
              <h4>리스크 포인트 {pts.length}</h4>
              <ul className="rp-list" style={{ padding: 0, maxHeight: 'none' }}>
                {pts.map((p) => (
                  <li key={p.id} className="rp" style={{ ['--c' as string]: sevColor(p.severity) }}>
                    <div className="top"><span className={`sev ${p.severity}`}>{SEV_LABEL[p.severity]}</span><span className="rule">{p.rule_name}</span><span className="at">{p.at ? fmtMD(p.at) : ''}</span></div>
                    <h4>{p.title}</h4><p>{p.evidence}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="dr-sec">
            <h4>스펙 개정 이력 {revs.length}</h4>
            {revs.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>개정 이력이 없습니다.</p> : (
              <ul className="evlist">
                {revs.map((r) => {
                  const widen = (r.usl_after ?? 0) - (r.lsl_after ?? 0) > (r.usl_before ?? 0) - (r.lsl_before ?? 0) + 1e-9;
                  return (
                    <li key={r.change_id} style={{ ['--c' as string]: widen ? 'var(--crit)' : 'var(--violet)' }}>
                      <time>{fmtDT(r.changed_at)} · Rev.{r.rev} · {r.ecn_no}</time>
                      <span className={widen ? 'delta-w' : ''}>LSL {r.lsl_before}→{r.lsl_after}, USL {r.usl_before}→{r.usl_after}</span> · {r.reason}
                      <br /><span className="muted">요청 {r.requested_by} · 승인 {r.approved_by}{r.approved_by === r.requested_by ? ' (본인)' : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="dr-sec">
            <h4>호환설비 {s.compat.length}대 · 모델 {byModel.length}종</h4>
            <div className="eqcards">
              {byModel.map((m) => eqs.filter((e) => e.eqp_model === m).map((e) => {
                const c = s.compat.find((x) => x.eqp_id === e.eqp_id)!;
                return (
                  <button key={e.eqp_id} className="eqc" style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={() => onEqp(e.eqp_id)}>
                    <span><b>{e.eqp_id}</b> <small>{e.eqp_model} · {e.maker}</small></span>
                    <span>{c.qualified ? <span className="sev OK">인증</span> : <span className="sev MED">미인증</span>}</span>
                    <span className="nums">
                      <span className={e.il_forced ? 'r' : ''}>인터락 {e.il_window} (강제 {e.il_forced})</span>
                      <span>BM {e.bm_window}</span><span>PM {e.pm_window}</span>
                      <span className={e.unapproved ? 'r' : ''}>변경 {e.changes_window} (부적정 {e.unapproved})</span>
                      {e.pm_overdue_days > 0 && <span className="r">PM {e.pm_overdue_days.toFixed(0)}일 초과</span>}
                      <span>인증일 {c.qual_date ?? '-'}</span>
                    </span>
                  </button>
                );
              }))}
            </div>
          </div>

          <div className="dr-sec">
            <h4>최근 설비 이벤트</h4>
            {events.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>기간 내 인터락·BM·변경이 없습니다.</p> : (
              <ul className="evlist">
                {events.map((e, i) => <li key={i} style={{ ['--c' as string]: e.c }}><time>{fmtDT(e.at)}</time><b style={{ color: 'var(--fg)', fontWeight: 600 }}>{e.t}</b><br />{e.s}</li>)}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
