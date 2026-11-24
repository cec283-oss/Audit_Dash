import { useMemo, useState } from 'react';
import type { Dossier, RiskPoint, Rule, Sev } from '../types';
import { CAT_NAME, CAT_ORDER, fmtMD, SEV_LABEL, SEVS, sevColor } from '../lib';


type Props = { d: Dossier; points: RiskPoint[]; rules: Rule[]; onStep: (id: string) => void; onEqp: (id: string) => void };

export default function RiskPoints({ d, points, onStep, onEqp }: Props) {
  const [sev, setSev] = useState<Sev | 'ALL'>('ALL');
  const [cat, setCat] = useState<string | null>(null);
  const stepName = useMemo(() => new Map(d.steps.map((s) => [s.step_id, s])), [d]);
  const list = points.filter((p) => (sev === 'ALL' || p.severity === sev) && (!cat || p.category === cat));
  const cnt = (s: Sev) => points.filter((p) => p.severity === s && (!cat || p.category === cat)).length;
  const cats = CAT_ORDER.filter((c) => points.some((p) => p.category === c));

  return (
    <section className="panel rise" aria-labelledby="h-rp">
      <div className="ph">
        <h2 id="h-rp"><span className="eyebrow">Risk points</span>감사 리스크 포인트</h2>
        <span className="mono muted" style={{ fontSize: 13.5 }}>{list.length} / {points.length}건</span>
      </div>
      <div className="rp-tools">
        <div className="seg" role="group" aria-label="심각도">
          <button aria-pressed={sev === 'ALL'} onClick={() => setSev('ALL')}>전체<b>{points.filter((p) => !cat || p.category === cat).length}</b></button>
          {SEVS.map((s) => <button key={s} aria-pressed={sev === s} onClick={() => setSev(s)}>{SEV_LABEL[s]}<b>{cnt(s)}</b></button>)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="영역">
          {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{CAT_NAME[c]}</button>)}
        </div>
      </div>
      {list.length === 0 ? <div className="empty">이 범위에는 해당하는 리스크 포인트가 없습니다.</div> : (
        <ul className="rp-list">
          {list.map((p) => (
            <li key={p.id} className="rp" style={{ ['--c' as string]: sevColor(p.severity) }}>
              <div className="top">
                <span className={`sev ${p.severity}`}>{SEV_LABEL[p.severity]}</span>
                <span className="rule">{p.rule_name}</span>
                <span className="cat">{CAT_NAME[p.category]}</span>
                <span className="at">{p.at ? fmtMD(p.at) : p.id}</span>
              </div>
              <h4>{p.title}</h4>
              <p>{p.evidence}</p>
              <div className="links">
                {p.steps.slice(0, 4).map((sid) => {
                  const s = stepName.get(sid);
                  return <button key={sid} className="chip" onClick={() => onStep(sid)}>{s ? `${String(s.seq).padStart(3, '0')} ${s.step_name}` : sid}</button>;
                })}
                {p.steps.length > 4 && <span className="chip" style={{ cursor: 'default' }}>+{p.steps.length - 4}</span>}
                {p.eqp_id && <button className="chip mono" onClick={() => onEqp(p.eqp_id!)}>{p.eqp_id}</button>}
                {p.refs.slice(0, 3).map((r) => <span key={r} className="chip mono" style={{ cursor: 'default' }}>{r}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
