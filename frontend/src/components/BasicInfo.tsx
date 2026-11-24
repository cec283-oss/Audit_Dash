import { useEffect, useState } from 'react';
import type { Dossier } from '../types';
import { rawZipUrl } from '../api';
import { fmtN, levelColor, SEV_LABEL, SEVS } from '../lib';

function Gauge({ value, level }: { value: number; level: Dossier['summary']['level'] }) {
  const [v, setV] = useState(0);
  useEffect(() => { const t = setTimeout(() => setV(value), 80); return () => clearTimeout(t); }, [value]);
  const r = 80, C = 2 * Math.PI * r, arc = 0.75 * C;
  const col = levelColor(level);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = ((135 + i * 27) * Math.PI) / 180;
    return <line key={i} className="g-tick" x1={100 + Math.cos(a) * 96} y1={100 + Math.sin(a) * 96} x2={100 + Math.cos(a) * (i % 5 ? 91 : 88)} y2={100 + Math.sin(a) * (i % 5 ? 91 : 88)} />;
  });
  return (
    <div className="gauge" style={{ ['--c' as string]: col }}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <linearGradient id="g-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--ok)' }} /><stop offset=".5" style={{ stopColor: 'var(--med)' }} /><stop offset="1" style={{ stopColor: col }} />
          </linearGradient>
        </defs>
        <circle className="g-orb" cx="100" cy="100" r="99" />
        {ticks}
        <circle className="g-tr" cx="100" cy="100" r={r} strokeDasharray={`${arc} ${C}`} transform="rotate(135 100 100)" />
        <circle className="g-val" cx="100" cy="100" r={r} stroke="url(#g-grad)" strokeDasharray={`${arc} ${C}`} strokeDashoffset={arc - (arc * v) / 100}
          transform="rotate(135 100 100)" style={{ filter: `drop-shadow(0 0 8px ${col})` }} />
      </svg>
      <div className="gauge-c">
        <span className="l">RISK INDEX</span>
        <span className="n">{value}</span>
        <span className={`lv lv-${level}`} style={{ fontSize: 14, marginTop: 4 }}>{level}</span>
      </div>
    </div>
  );
}

/** 공법을 고르면 맨 위에 나오는 기본 정보 */
export default function BasicInfo({ d }: { d: Dossier }) {
  const p = d.product, k = d.summary.kpis, s = d.summary;
  const zip = rawZipUrl(p.product_id);
  const cells: { k: string; v: string | number; u?: string; sub?: string }[] = [
    { k: '재공', v: fmtN(p.wip_wafers), u: 'wf', sub: p.rank_in_family ? `${p.family_code} 재공 ${p.rank_in_family}위 / ${p.family_size}` : '' },
    { k: '총 스텝', v: fmtN(k.steps), u: '스텝', sub: `스테이지 ${k.stages}개 · 레시피 ${fmtN(k.recipes)}개` },
    { k: 'A등급 스텝', v: k.grades.A, u: '스텝', sub: `B ${fmtN(k.grades.B)} · C ${fmtN(k.grades.C)}` },
    { k: '타겟 관리 스텝', v: k.measured_steps, u: '스텝', sub: `등급 요구 미달 ${k.cap_all?.below_req ?? k.low_cpk}개 · 평균 Cpk ${k.cap_all?.cpk ?? '-'} / Ppk ${k.cap_all?.ppk ?? '-'}` },
    { k: '호환설비', v: k.compat_eqps, u: '대', sub: `설비 모델 ${k.models}종` },
    { k: '제품 등급', v: p.grade ?? '-', sub: `양산 시작 ${p.mass_prod_start ?? '-'}` },
  ];
  return (
    <section className="panel basic rise" aria-labelledby="h-basic">
      <div className="basic-main">
        <div className="basic-head">
          <p className="eyebrow">기본 정보 · {d.line?.line_name} · {p.node} · {p.family_code} {p.family_name}</p>
          <h1 id="h-basic">{p.product_name}<small>{p.product_id}</small></h1>
          <div className="reasons">
            {p.reasons.map((r) => <span key={r} className={`tag${/차량용/.test(r) ? ' auto' : ''}`}>{r}</span>)}
          </div>
        </div>
        <dl className="info-grid">
          {cells.map((c) => (
            <div key={c.k}>
              <dt>{c.k}</dt>
              <dd>{c.v}{c.u && <small>{c.u}</small>}</dd>
              {c.sub && <span>{c.sub}</span>}
            </div>
          ))}
        </dl>
      </div>
      <div className="basic-side">
        <Gauge value={s.risk_index} level={s.level} />
        <div className="sevrow">{SEVS.map((x) => <span key={x} className={`sev ${x}`}>{SEV_LABEL[x]} {s.severity[x]}</span>)}</div>
        {zip ? (
          <a className="btn primary" href={zip} download title="공정흐름·타겟표준·SPC·호환설비·설비·인터락·PM/BM·변경·스펙 개정 원본 CSV 9개">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>원본 데이터 전체 (ZIP)
          </a>
        ) : <span className="muted" style={{ fontSize: 13.5 }}>원본 ZIP 은 백엔드 모드에서 받을 수 있습니다</span>}
      </div>
    </section>
  );
}
