import type { Dossier, Summary, TopResult } from '../types';
import { fmtN, levelColor } from '../lib';

export function Ring({ value, color, size = 62 }: { value: number; color: string; size?: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size, ['--c' as string]: color }}>
      <svg viewBox="0 0 62 62" aria-hidden="true">
        <circle className="tr" cx="31" cy="31" r={r} />
        <circle className="val" cx="31" cy="31" r={r} strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <b>{value}</b>
    </div>
  );
}

type CardData = { product_id: string; product_name: string; wip_wafers: number; grade?: string; summary: Summary; rank?: number | null; share?: number; lookup?: boolean };

function Card({ x, max, sel, onSelect, i }: { x: CardData; max: number; sel: boolean; onSelect: () => void; i: number }) {
  const s = x.summary, k = s.kpis, col = levelColor(s.level);
  const m: [string, number, string][] = [
    ['인터락 30일', k.il_recent, k.il_forced ? 'r' : ''], ['BM 30일', k.bm_recent, ''], ['부적정 변경', k.unapproved, k.unapproved ? 'r' : ''],
    ['스펙 완화', k.spec_widen, k.spec_widen ? 'r' : ''], ['Cpk<1.33', k.low_cpk, k.low_cpk ? 'o' : ''], ['PM 초과', k.pm_overdue, k.pm_overdue ? 'o' : ''],
  ];
  return (
    <button className={`tcard rise${x.lookup ? ' lookup' : ''}`} aria-pressed={sel} onClick={onSelect} style={{ ['--c' as string]: col, ['--i' as string]: i }}>
      <div className="tc-top">
        <span className="rank">{x.lookup ? '조회' : `#${x.rank}`}</span>
        <div className="tc-nm"><b>{x.product_name}</b><small className="mono">{x.product_id}{x.lookup && x.rank ? ` · 공정 재공 ${x.rank}위` : ''}</small></div>
        <Ring value={s.risk_index} color={col} size={54} />
      </div>
      <div className="wip">
        <div className="wl"><span>재공</span><b className="mono">{fmtN(x.wip_wafers)} wf</b>{x.share != null && <span className="mono muted">{(x.share * 100).toFixed(0)}%</span>}</div>
        <div className="wt"><i style={{ width: `${max ? (x.wip_wafers / max) * 100 : 0}%` }} /></div>
      </div>
      <div className="tc-sev">
        <span className={`lv lv-${s.level}`}>{s.level}</span>
        {s.severity.CRIT > 0 && <span className="sev CRIT">치명 {s.severity.CRIT}</span>}
        {s.severity.HIGH > 0 && <span className="sev HIGH">높음 {s.severity.HIGH}</span>}
        {x.grade === 'Automotive' && <span className="tag auto" style={{ padding: '0 7px', fontSize: 12 }}>차량용</span>}
      </div>
      <div className="tc-m">
        {m.map(([l, v, c]) => <div key={l} className={v ? c : ''}><span>{l}</span><b>{v}</b></div>)}
      </div>
    </button>
  );
}

type Props = { top?: TopResult; loading: boolean; productId: string | null; lookup?: Dossier; onSelect: (id: string) => void };

export default function TopFive({ top, loading, productId, lookup, onSelect }: Props) {
  if (!top) return <div className="skeleton" style={{ height: 250 }} aria-label={loading ? '불러오는 중' : ''} />;
  const max = Math.max(...top.items.map((x) => x.wip_wafers), lookup?.product.wip_wafers ?? 0);
  const inTop = top.items.some((x) => x.product_id === productId);
  const showLookup = lookup && !inTop && lookup.product.product_id === productId;
  return (
    <section className="panel rise" aria-labelledby="h-top">
      <div className="ph">
        <h2 id="h-top"><span className="eyebrow">WIP top 5</span>{top.family_code} {top.family_name} · 재공 상위 5개 공법
          <span className="ph-note">공정 전체 {top.products}공법 · {fmtN(top.wip)}wf 중 상위 5개 {fmtN(top.top_wip)}wf ({top.wip ? ((top.top_wip / top.wip) * 100).toFixed(0) : 0}%)</span>
        </h2>
        <span className="ph-note">카드를 누르면 아래에 그 공법의 공정흐름·타겟표준·설비 이력이 열립니다</span>
      </div>
      <div className={`tgrid${showLookup ? ' six' : ''}`}>
        {top.items.map((x, i) => (
          <Card key={x.product_id} i={i} x={{ ...x, share: x.wip_share }} max={max} sel={x.product_id === productId} onSelect={() => onSelect(x.product_id)} />
        ))}
        {showLookup && (
          <Card i={5} max={max} sel onSelect={() => onSelect(lookup.product.product_id)}
            x={{ ...lookup.product, summary: lookup.summary, rank: lookup.product.rank_in_family, lookup: true }} />
        )}
      </div>
    </section>
  );
}
