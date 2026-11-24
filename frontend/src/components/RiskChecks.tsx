import type { Check, Dossier } from '../types';
import { SEV_LABEL, SEVS } from '../lib';
import type { ItemKey } from './detail/columns';

const ICON: Record<string, string> = {
  spec: 'M4 6h16M4 12h10M4 18h7M17 15l2 2 4-4',
  process: 'M3 17l5-6 4 3 5-7 4 4M3 21h18',
  interlock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  detect: 'M2 12h4l2-5 4 10 2-5h8M12 3v2M12 19v2',
  tttm: 'M4 18h4V9H4zM10 18h4V5h-4zM16 18h4v-6h-4zM3 21h18',
  equip: 'M3 5h18v10H3zM8 21h8M12 15v6',
  maint: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z',
  cttm: 'M4 7h7v10H4zM13 7h7v10h-7zM11 12h2',
  racb: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  change: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12.5 3M19 9A7 7 0 0 0 6.5 6',
};
const GROUP_ICON: Record<string, string> = {
  process_data: 'M3 17l5-6 4 3 5-7 4 4M3 21h18',
  equip_data: 'M3 5h18v10H3zM8 21h8M12 15v6',
  change_point: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12.5 3M19 9A7 7 0 0 0 6.5 6',
};

function Card({ c, i, onOpen }: { c: Check; i: number; onOpen: (k: ItemKey) => void }) {
  if (!c.connected) {
    return (
      <div className="check pending rise" style={{ ['--i' as string]: i }}>
        <div className="ck-top">
          <span className="ck-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[c.key]} /></svg></span>
          <span className="ck-name">{c.name}</span>
          <span className="ck-state">데이터 연결 예정</span>
        </div>
        <p className="ck-basis">{c.basis}</p>
      </div>
    );
  }
  const ok = c.points === 0;
  return (
    <button className={`check rise ${ok ? 'pass' : 'fail'} lvl-${c.level}`} style={{ ['--i' as string]: i }} onClick={() => onOpen(c.detail as ItemKey)}>
      <div className="ck-top">
        <span className="ck-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[c.key]} /></svg></span>
        <span className="ck-name">{c.name}</span>
        <span className="ck-state">{ok ? '✓ 이상 없음' : `리스크 ${c.points}건`}</span>
      </div>
      <p className="ck-basis">{c.basis}</p>
      {!ok && <div className="ck-sev">{SEVS.filter((x) => c.severity[x]).map((x) => <span key={x} className={`sev ${x}`}>{SEV_LABEL[x]} {c.severity[x]}</span>)}</div>}
      <ul className="ck-rules">
        {c.rules.map((r) => (
          <li key={r.code} className={r.count ? `bad l-${r.level}` : 'good'} title={r.criterion}>
            <span className="mk">{r.count ? '✕' : '✓'}</span><span>{r.name}</span><b>{r.count ? `${r.count}건` : '통과'}</b>
          </li>
        ))}
      </ul>
      <span className="ck-go">상세 보기 →</span>
    </button>
  );
}

/** 대분류(공정 데이터 · 설비 데이터 · 변경점) → 점검 항목별 Risk point. 0건 옅은 초록, 1건 이상 옅은 빨강, 미연결은 회색 */
export default function RiskChecks({ d, onOpen }: { d: Dossier; onOpen: (k: ItemKey) => void }) {
  const checks = d.summary.checks;
  const live = checks.filter((c) => c.connected);
  const bad = live.filter((c) => c.points > 0).length;
  let k = 0;
  return (
    <section className="panel rise" style={{ ['--i' as string]: 1 }} aria-labelledby="h-checks">
      <div className="ph">
        <h2 id="h-checks"><span className="eyebrow">Risk point</span>점검 항목별 리스크
          <span className="ph-note">점검 {live.length}개 항목 중 {bad}개에서 리스크 발견 · 카드를 누르면 근거 이력이 있는 상세 페이지로 이동</span>
        </h2>
        <div className="flow-legend">
          <span><i style={{ background: 'var(--ok)' }} />이상 없음</span><span><i style={{ background: 'var(--crit)' }} />리스크 있음</span><span><i style={{ background: 'var(--muted)' }} />데이터 연결 예정</span>
        </div>
      </div>
      <div className="groups">
        {d.summary.groups.map((g) => {
          const cs = g.cats.map((cat) => checks.find((c) => c.key === cat)!).filter(Boolean);
          const ok = g.points === 0;
          return (
            <section key={g.key} className={`grp ${ok ? 'pass' : 'fail'}`} aria-label={g.name}>
              <header className="grp-h">
                <span className="grp-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={GROUP_ICON[g.key]} /></svg></span>
                <div>
                  <p className="eyebrow">{g.en}</p>
                  <h3>{g.name}</h3>
                  <span className="grp-desc">{g.desc}</span>
                </div>
                <span className="grp-state">{ok ? '✓ 이상 없음' : `리스크 ${g.points}건`}</span>
              </header>
              <div className="checks" style={{ gridTemplateColumns: `repeat(${Math.min(cs.length, 4)}, minmax(0,1fr))` }}>
                {cs.map((c) => <Card key={c.key} c={c} i={k++} onOpen={onOpen} />)}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
