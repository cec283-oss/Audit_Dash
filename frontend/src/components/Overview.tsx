import { useMemo, useState } from 'react';
import type { Category, Level, Meta, Overview as OV, OverviewProduct } from '../types';
import { CAT_NAME, cssVar, downloadCsv, fmtMD, fmtN, levelColor, SEV_LABEL, useTheme, isPending } from '../lib';
import EChart from './EChart';
import { Ring } from './TopFive';

const LEVELS: Level[] = ['위험', '경고', '주의', '양호'];
const GROUP_COLOR: Record<string, string> = { process_data: '--aqua', equip_data: '--violet', change_point: '--accent-2' };

type Props = {
  meta: Meta; ov: OV;
  onProduct: (id: string) => void;
  onFamily: (line: string, node: string, family: string) => void;
  onLine: (line: string) => void;
  onCat: (c: Category) => void;
};

function Kpi({ icon, k, v, u, s, tone, hint, on, onClick }: { icon: string; k: string; v: string; u?: string; s: string; tone?: 'crit' | 'high'; hint: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`ov-kpi${tone ? ` ${tone}` : ''}${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg></span>
      <span className="k">{k}</span><b className="v">{v}{u && <small>{u}</small>}</b><span className="s">{s}</span>
      <span className="hint">{hint} →</span>
    </button>
  );
}

type Sort = { key: string; label: string; val: (p: OverviewProduct) => number } | null;

/** 등급 분포 도넛 · 조각을 누르면 순위표 필터 */
function Donut({ lv, total, avg, sel, onSel }: { lv: Record<Level, OverviewProduct[]>; total: number; avg: number; sel: Level | ''; onSel: (l: Level) => void }) {
  const R = 96, CIRC = 2 * Math.PI * R, gap = 6;
  let off = 0;
  return (
    <div className="ov-donut">
      <div className="dn">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle cx="120" cy="120" r="116" className="dn-orb" />
          <circle cx="120" cy="120" r={R} className="dn-tr" />
          {LEVELS.map((l) => {
            const n = lv[l].length;
            if (!n) return null;
            const len = (n / total) * CIRC;
            const el = (
              <circle key={l} cx="120" cy="120" r={R} className={`dn-seg${sel && sel !== l ? ' dim' : ''}`} onClick={() => onSel(l)}
                style={{ stroke: levelColor(l), strokeDasharray: `${Math.max(len - gap, 1)} ${CIRC}`, strokeDashoffset: -off, filter: `drop-shadow(0 0 8px ${levelColor(l)})` }} />
            );
            off += len;
            return el;
          })}
          <circle cx="120" cy="120" r="70" className="dn-in" />
        </svg>
        <div className="dn-c"><span>평균 지수</span><b>{avg}</b><small>{total}개 공법</small></div>
      </div>
      <ul className="dn-lg">
        {LEVELS.map((l) => (
          <li key={l}>
            <button aria-pressed={sel === l} onClick={() => onSel(l)} disabled={!lv[l].length}>
              <i style={{ background: levelColor(l) }} /><span>{l}</span><b>{lv[l].length}</b><small>{Math.round((lv[l].length / Math.max(total, 1)) * 100)}%</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 첫 화면: 전 라인·전 공법의 감사 리스크를 한눈에. 공법·공정을 누르면 해당 페이지로 이동 */
export default function Overview({ meta, ov, onProduct, onFamily, onLine, onCat }: Props) {
  const { dark, tick } = useTheme();
  const ps = ov.products;
  const lineName = useMemo(() => Object.fromEntries(meta.lines.map((l) => [l.line_id, l.line_name.replace(/^FAB\d\s*/, '')])), [meta]);
  const wip = ps.reduce((a, p) => a + p.wip_wafers, 0);
  const lv = Object.fromEntries(LEVELS.map((l) => [l, ps.filter((p) => p.level === l)])) as Record<Level, OverviewProduct[]>;
  const avg = Math.round(ps.reduce((a, p) => a + p.risk_index, 0) / Math.max(ps.length, 1));
  const wipAtRisk = [...lv['위험'], ...lv['경고']].reduce((a, p) => a + p.wip_wafers, 0);
  const crit = ps.reduce((a, p) => a + (p.severity.CRIT ?? 0), 0);

  /* ── 버블: 재공 × 리스크 지수 ── */
  const bubble = useMemo(() => {
    const c = (l: Level) => cssVar(`--${{ 위험: 'crit', 경고: 'high', 주의: 'med', 양호: 'ok' }[l]}`);
    const fg = cssVar('--fg-2'), mute = cssVar('--muted'), grid = cssVar('--line');
    const maxW = Math.max(...ps.map((p) => p.wip_wafers), 1);
    const minW = Math.min(...ps.map((p) => Math.max(p.wip_wafers, 1)));
    const medW = [...ps].map((p) => p.wip_wafers).sort((a, b) => a - b)[Math.floor(ps.length / 2)] || 1;
    const topIds = new Set(ps.slice(0, 5).map((p) => p.product_id));
    const xMax = Math.pow(10, Math.ceil(Math.log10(maxW) * 2) / 2);
    return {
      animationDuration: 900,
      grid: { left: 56, right: 28, top: 30, bottom: 46 },
      tooltip: {
        backgroundColor: cssVar('--panel'), borderColor: grid, textStyle: { color: fg, fontSize: 13 },
        formatter: (x: { data: { p: OverviewProduct } }) => {
          const p = x.data.p;
          return `<b>${p.product_name}</b> <span style="opacity:.6">${p.product_id}</span><br/>${lineName[p.line_id]} · ${p.node} · ${p.family_code}<br/>리스크 지수 <b>${p.risk_index}</b> (${p.level}) · 재공 ${fmtN(p.wip_wafers)} wf<br/>Risk point ${p.points}건 · CRIT ${p.severity.CRIT ?? 0}`;
        },
      },
      xAxis: { type: 'log', min: Math.pow(10, Math.floor(Math.log10(minW) * 2) / 2), max: xMax, name: '재공 (wf, log)', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: mute }, axisLabel: { color: mute }, splitLine: { lineStyle: { color: grid } }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', name: '리스크 지수', min: (v: { min: number }) => Math.max(0, Math.floor(v.min / 10) * 10 - 5), max: (v: { max: number }) => Math.min(100, Math.ceil(v.max / 10) * 10 + 5), nameTextStyle: { color: mute }, axisLabel: { color: mute }, splitLine: { lineStyle: { color: grid } } },
      series: LEVELS.map((l) => ({
        name: l, type: 'scatter', cursor: 'pointer',
        data: lv[l].map((p) => ({ value: [Math.max(p.wip_wafers, 1), p.risk_index], p, name: p.product_id, label: { show: topIds.has(p.product_id) } })),
        labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        label: { position: 'right', formatter: '{b}', color: fg, fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' },
        symbolSize: (v: number[]) => 10 + 30 * Math.sqrt(v[0] / maxW),
        itemStyle: { color: c(l), opacity: dark ? 0.72 : 0.8, borderColor: c(l), borderWidth: 1.5, shadowBlur: l === '위험' ? 20 : 8, shadowColor: c(l) },
        emphasis: { scale: 1.35, label: { show: true, formatter: '{b}', position: 'top', color: fg, fontSize: 12 } },
        markArea: l === '위험' ? {
          silent: true, itemStyle: { color: cssVar('--crit-a') }, label: { color: c('위험'), fontSize: 12, position: 'insideTopRight', formatter: '우선 점검 영역 · 재공 중앙값 이상 & 지수 65 이상' },
          data: [[{ xAxis: medW, yAxis: 65 }, { xAxis: xMax, yAxis: 100 }]],
        } : undefined,
        markLine: l === '위험' ? { silent: true, symbol: 'none', lineStyle: { color: c('위험'), type: 'dashed', opacity: 0.6 }, label: { color: c('위험'), formatter: '위험 75' }, data: [{ yAxis: 75 }] } : undefined,
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps, dark, tick]);

  /* ── 공정(옵션 계열) 히트맵 ── */
  const fams = useMemo(() => {
    const m = new Map<string, { line: string; node: string; family: string; name?: string; ps: OverviewProduct[] }>();
    for (const p of ps) {
      const k = `${p.line_id}|${p.node}|${p.family_code}`;
      if (!m.has(k)) m.set(k, { line: p.line_id, node: p.node, family: p.family_code, name: p.family_name, ps: [] });
      m.get(k)!.ps.push(p);
    }
    return [...m.values()].map((f) => ({
      ...f,
      wip: f.ps.reduce((a, p) => a + p.wip_wafers, 0),
      max: Math.max(...f.ps.map((p) => p.risk_index)),
      avg: Math.round(f.ps.reduce((a, p) => a + p.risk_index, 0) / f.ps.length),
      worst: [...f.ps].sort((a, b) => b.risk_index - a.risk_index)[0],
      cat: Object.fromEntries(Object.keys(CAT_NAME).map((c) => [c, f.ps.reduce((a, p) => a + (p.by_category[c as keyof typeof CAT_NAME] ?? 0), 0) / f.ps.length])),
    })).sort((a, b) => a.line.localeCompare(b.line) || a.node.localeCompare(b.node) || b.avg - a.avg);
  }, [ps]);
  const cats = meta.groups.flatMap((g) => g.cats.map((c) => ({ c, g: g.key })));
  const catMax = Object.fromEntries(cats.map(({ c }) => [c, Math.max(...fams.map((f) => f.cat[c]), 0.0001)]));

  /* ── 우선 점검 순위 ── */
  const [lineF, setLineF] = useState<string>('');
  const [lvF, setLvF] = useState<Level | ''>('');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [flash, setFlash] = useState(0);
  const toRank = () => {
    setFlash((f) => f + 1);
    setTimeout(() => {
      const el = document.getElementById('ov-rank');
      if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - 76, behavior: 'smooth' });
    }, 30);
  };
  const sortBy = (x: Sort) => { setSort(sort && x && sort.key === x.key ? null : x); setShowAll(false); toRank(); };
  const rank = ps.filter((p) => (!lineF || p.line_id === lineF) && (!lvF || p.level === lvF)
    && (!q || `${p.product_id} ${p.product_name} ${p.family_code}`.toLowerCase().includes(q.toLowerCase())));
  if (sort) rank.sort((a, b) => sort.val(b) - sort.val(a) || b.risk_index - a.risk_index);
  const shown = showAll ? rank : rank.slice(0, 15);
  const gMax = Math.max(...ps.flatMap((p) => Object.values(p.groups)), 1);
  const ruleMax = Math.max(...ov.rule_freq.map((r) => r.count), 1);

  const exportRank = () => downloadCsv('audit_overview_rank.csv', rank.map((p, i) => ({
    순위: i + 1, 공법: p.product_id, 제품명: p.product_name, 라인: lineName[p.line_id], 노드: p.node, 공정: p.family_code, 재공: p.wip_wafers,
    리스크지수: p.risk_index, 등급: p.level, RiskPoint: p.points, CRIT: p.severity.CRIT ?? 0, HIGH: p.severity.HIGH ?? 0,
    ...Object.fromEntries(meta.groups.map((g) => [g.name, p.groups[g.key] ?? 0])),
    ...Object.fromEntries(cats.map(({ c }) => [CAT_NAME[c], p.by_category[c] ?? 0])),
    스텝: p.steps, A등급스텝: p.a_steps, 호환설비: p.compat_eqps, 선정사유: p.reasons.join(' / '),
  })));

  return (
    <div className="ov">
      {/* ───── HERO ───── */}
      <section className="panel ov-hero rise" aria-labelledby="h-ov">
        <div className="ov-hero-l">
          <p className="eyebrow">FAB-WIDE AUDIT OVERVIEW · 기준 {meta.as_of.replace('T', ' ')} · 최근 {meta.window_days}일</p>
          <h1 id="h-ov">종합 리스크 현황</h1>
          <p className="ov-lead">
            {meta.lines.length}개 라인 · {fmtN(ps.length)}개 공법 중 <b className="t-crit">위험 {lv['위험'].length}</b> · <b className="t-high">경고 {lv['경고'].length}</b> ·
            {' '}위험·경고 재공 비중 <b>{Math.round((wipAtRisk / Math.max(wip, 1)) * 100)}%</b>
          </p>
          <div className="ov-kpis">
            <Kpi icon="M4 7h16M4 12h16M4 17h10" k="점검 대상 공법" v={fmtN(ps.length)} u="개" s={`${meta.lines.length}개 라인 · ${fams.length}개 공정`} hint="전체 순위 보기"
              on={!sort && !lvF && !lineF && !q} onClick={() => { setSort(null); setLvF(''); setLineF(''); setQ(''); toRank(); }} />
            <Kpi icon="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" k="총 재공" v={fmtN(wip)} u="wf" s={`위험·경고 ${fmtN(wipAtRisk)} wf`} hint="재공 많은 순"
              on={sort?.key === 'wip'} onClick={() => sortBy({ key: 'wip', label: '재공 많은 순', val: (p) => p.wip_wafers })} />
            <Kpi icon="M3 17l5-6 4 3 5-7 4 4" k="최고 리스크 지수" v={String(ps[0]?.risk_index ?? '-')} s={ps[0] ? `${ps[0].product_id} · ${ps[0].product_name}` : ''} tone="high" hint="이 공법 열기"
              onClick={() => ps[0] && onProduct(ps[0].product_id)} />
            <Kpi icon="M12 3 2 20h20L12 3zM12 10v4M12 17v.5" k="치명 포인트" v={fmtN(crit)} u="건" s={`치명·높음 ${fmtN(ov.hot_total)}건`} tone="crit" hint="치명 많은 순"
              on={sort?.key === 'crit'} onClick={() => sortBy({ key: 'crit', label: '치명 포인트 많은 순', val: (p) => p.severity.CRIT ?? 0 })} />
          </div>
          <div className="ov-lines">
            {meta.lines.map((l, i) => {
              const lp = ps.filter((p) => p.line_id === l.line_id);
              const la = Math.round(lp.reduce((a, p) => a + p.risk_index, 0) / Math.max(lp.length, 1));
              const ll: Level = la >= 75 ? '위험' : la >= 55 ? '경고' : la >= 35 ? '주의' : '양호';
              return (
                <button key={l.line_id} className="ov-line" onClick={() => onLine(l.line_id)} style={{ ['--i' as string]: i }}>
                  <Ring value={la} color={levelColor(ll)} size={58} />
                  <span className="ol-t"><b>{lineName[l.line_id]}</b><small>{l.tech ?? ''} · {lp.length}공법 · {fmtN(l.wip)} wf</small>
                    <span className="ol-bar">{LEVELS.map((x) => { const n = lp.filter((p) => p.level === x).length; return n ? <i key={x} style={{ flex: n, background: levelColor(x) }} title={`${x} ${n}`} /> : null; })}</span>
                    <small className="ol-c">{LEVELS.map((x) => { const n = lp.filter((p) => p.level === x).length; return n ? <span key={x}><em style={{ background: levelColor(x) }} />{x} {n}</span> : null; })}</small>
                  </span>
                  <span className="go" aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        </div>
        <Donut lv={lv} total={ps.length} avg={avg} sel={lvF} onSel={(l) => { setLvF(lvF === l ? '' : l); toRank(); }} />
      </section>

      {/* ───── 대분류 + 버블 ───── */}
      <div className="ov-duo">
        <section className="panel rise" style={{ ['--i' as string]: 1 }} aria-labelledby="h-ovg">
          <div className="ph"><h2 id="h-ovg"><span className="eyebrow">Category</span>대분류별 리스크</h2><span className="ph-note">전 공법 합계 · 대분류나 항목을 누르면 항목별 전체 집계 페이지</span></div>
          <div className="ov-groups">
            {meta.groups.map((g) => {
              const total = ps.reduce((a, p) => a + (p.groups[g.key] ?? 0), 0);
              const hit = ps.filter((p) => (p.groups[g.key] ?? 0) > 0).length;
              return (
                <div key={g.key} className="ov-g" style={{ ['--gc' as string]: `var(${GROUP_COLOR[g.key]})` }}>
                  <button className="ov-gh" onClick={() => onCat((g.cats.find((c) => !isPending(meta, c)) ?? g.cats[0]) as Category)} title="이 대분류의 항목별 전 공법 집계 페이지로">
                    <p className="eyebrow">{g.en}</p><h3>{g.name}</h3><b>{fmtN(total)}<small>건</small></b><span>{hit}/{ps.length} 공법 · 누르면 항목별 전체 집계 →</span>
                  </button>
                  <ul>
                    {g.cats.map((c) => {
                      const n = ps.reduce((a, p) => a + (p.by_category[c] ?? 0), 0);
                      const pending = isPending(meta, c);
                      const all = cats.map(({ c: x }) => ps.reduce((a, p) => a + (p.by_category[x] ?? 0), 0));
                      return (
                        <li key={c} className={pending ? 'pending' : n ? 'bad' : 'good'}>
                          <button onClick={() => onCat(c as Category)} title={`${CAT_NAME[c]} 전 공법 집계 · Worst/Best · 실제 이력`}>
                            <span>{CAT_NAME[c]}</span>
                            <i><em style={{ width: pending ? 0 : `${(n / Math.max(...all, 1)) * 100}%` }} /></i>
                            <b>{pending ? '연결 예정' : n ? fmtN(n) : '✓ 0'}</b>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel rise" style={{ ['--i' as string]: 2 }} aria-labelledby="h-ovb">
          <div className="ph"><h2 id="h-ovb"><span className="eyebrow">Priority map</span>재공 × 리스크 지수</h2><span className="ph-note">오른쪽 위일수록 우선 점검 · 원 크기 = 재공 · 클릭하면 공법 페이지</span></div>
          <EChart className="ov-bubble" option={bubble} ariaLabel="재공 대비 리스크 지수 버블 차트"
            onClick={(e) => { const id = (e.data as { name?: string })?.name; if (id) onProduct(id); }} />
        </section>
      </div>

      {/* ───── 공정 히트맵 ───── */}
      <section className="panel rise" style={{ ['--i' as string]: 3 }} aria-labelledby="h-ovh">
        <div className="ph">
          <h2 id="h-ovh"><span className="eyebrow">Heatmap</span>라인 · 노드 · 공정별 점검 항목 히트맵</h2>
          <span className="ph-note">칸 = 공법당 평균 Risk point (항목별 최댓값 대비 진하기) · 행을 누르면 그 공정의 재공 Top 5 페이지로 이동</span>
        </div>
        <div className="ov-heat-wrap">
          <table className="ov-heat">
            <thead>
              <tr>
                <th rowSpan={2}>라인 · 노드</th><th rowSpan={2}>공정</th><th rowSpan={2} className="r">공법</th><th rowSpan={2} className="r">재공</th><th rowSpan={2}>평균 / 최고 지수</th>
                {meta.groups.map((g) => <th key={g.key} colSpan={g.cats.length} className="gh" style={{ ['--gc' as string]: `var(${GROUP_COLOR[g.key]})` }}>{g.name}</th>)}
              </tr>
              <tr>{cats.map(({ c, g }) => <th key={c} className="ch" style={{ ['--gc' as string]: `var(${GROUP_COLOR[g]})` }}><button onClick={() => onCat(c as Category)} title="항목별 전체 집계">{CAT_NAME[c]}</button></th>)}</tr>
            </thead>
            <tbody>
              {fams.map((f, i) => {
                const first = i === 0 || fams[i - 1].line !== f.line || fams[i - 1].node !== f.node;
                return (
                  <tr key={`${f.line}${f.node}${f.family}`} className={first ? 'first' : ''} onClick={() => onFamily(f.line, f.node, f.family)} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onFamily(f.line, f.node, f.family)}>
                    <td className="ln">{first ? <><b>{lineName[f.line]}</b> <span>{f.node}</span></> : ''}</td>
                    <td><b className="mono">{f.family}</b> <span className="muted">{f.name}</span></td>
                    <td className="r mono">{f.ps.length}</td>
                    <td className="r mono">{fmtN(f.wip)}</td>
                    <td><span className="ov-idx"><i style={{ width: `${f.avg}%`, background: levelColor(f.avg >= 75 ? '위험' : f.avg >= 55 ? '경고' : f.avg >= 35 ? '주의' : '양호') }} /></span><span className="mono">{f.avg} / {f.max}</span></td>
                    {cats.map(({ c }) => {
                      const v = f.cat[c];
                      const pending = isPending(meta, c);
                      const a = pending ? 0 : v / catMax[c];
                      const hue = a >= 0.67 ? 'var(--crit)' : a >= 0.34 ? 'var(--high)' : 'var(--med)';
                      return (
                        <td key={c} className={`hc${pending ? ' pend' : v ? '' : ' zero'}`} style={{ ['--a' as string]: `${Math.round(10 + a * 30)}%`, ['--hc' as string]: hue }} title={`${f.family} · ${CAT_NAME[c]} 공법당 ${v.toFixed(1)}건`}>
                          {pending ? '–' : v ? v.toFixed(v >= 10 ? 0 : 1) : '✓'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ───── 순위 + 고위험 피드 ───── */}
      <div className="ov-duo wide">
        <section id="ov-rank" className="panel rise" style={{ ['--i' as string]: 4 }} aria-labelledby="h-ovr">
          {flash > 0 && <i key={flash} className="ov-flash" aria-hidden="true" />}
          <div className="ph">
            <h2 id="h-ovr"><span className="eyebrow">Ranking</span>우선 점검 공법 순위<span className="ph-note">{rank.length}개</span>
              {sort ? <button className="ov-sort" onClick={() => setSort(null)} title="리스크 지수 순으로 되돌리기">{sort.label} ✕</button> : <span className="ov-sort plain">리스크 지수 순</span>}
              {lvF && <button className="ov-sort" onClick={() => setLvF('')}>{lvF}만 ✕</button>}
            </h2>
            <div className="ph-tools">
              <div className="seg" role="group" aria-label="라인 필터">
                <button aria-pressed={!lineF} onClick={() => setLineF('')}>전체</button>
                {meta.lines.map((l) => <button key={l.line_id} aria-pressed={lineF === l.line_id} onClick={() => setLineF(l.line_id)}>{lineName[l.line_id]}</button>)}
              </div>
              <select value={lvF} onChange={(e) => setLvF(e.target.value as Level | '')} aria-label="등급 필터">
                <option value="">전체 등급</option>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <input className="ov-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="공법 · 제품명 검색" aria-label="공법 검색" />
              <button className="btn" onClick={exportRank}>CSV</button>
            </div>
          </div>
          <div className="ov-rank">
            {shown.map((p, i) => (
              <button key={p.product_id} className={`ov-row lvl-${p.level}`} onClick={() => onProduct(p.product_id)} style={{ ['--i' as string]: Math.min(i, 12) }}>
                <span className="rk mono">{ps.indexOf(p) + 1}</span>
                <Ring value={p.risk_index} color={levelColor(p.level)} size={46} />
                <span className="nm">
                  <b>{p.product_name}</b>
                  <small><span className="mono">{p.product_id}</span> · {lineName[p.line_id]} · {p.node} · {p.family_code}</small>
                  {p.reasons.length > 0 && <span className="rs">{p.reasons.slice(0, 3).map((r) => <span key={r} className={`tag${/차량용/.test(r) ? ' auto' : ''}`}>{r}</span>)}</span>}
                </span>
                <span className="gp">
                  {meta.groups.map((g) => (
                    <span key={g.key} title={`${g.name} ${p.groups[g.key] ?? 0}건`} style={{ ['--gc' as string]: `var(${GROUP_COLOR[g.key]})` }}>
                      <small>{g.name}</small><i><em style={{ width: `${((p.groups[g.key] ?? 0) / gMax) * 100}%` }} /></i><b className="mono">{p.groups[g.key] ?? 0}</b>
                    </span>
                  ))}
                </span>
                <span className="wp"><b className="mono">{fmtN(p.wip_wafers)}</b><small>wf</small>
                  {sort && sort.key !== 'wip' && <em className="sv">{sort.label.replace(/ 많은 순$/, '')} <b>{sort.val(p)}</b></em>}</span>
                <span className={`lv lv-${p.level}`}>{p.level}</span>
                <span className="go" aria-hidden="true">→</span>
              </button>
            ))}
            {rank.length > 15 && <button className="btn ov-more" onClick={() => setShowAll(!showAll)}>{showAll ? '상위 15개만' : `전체 ${rank.length}개 보기`}</button>}
            {!rank.length && <p className="muted" style={{ padding: 18 }}>조건에 맞는 공법이 없습니다.</p>}
          </div>
        </section>

        <div className="ov-side">
          <section className="panel rise" style={{ ['--i' as string]: 5 }} aria-labelledby="h-ovp">
            <div className="ph"><h2 id="h-ovp"><span className="eyebrow">Hot points</span>치명·높음 리스크 피드</h2><span className="ph-note">재공 큰 공법 우선 · {ov.hot_points.length}/{fmtN(ov.hot_total)}</span></div>
            <ul className="ov-feed">
              {ov.hot_points.map((h) => (
                <li key={`${h.product_id}${h.id}`}>
                  <button onClick={() => onProduct(h.product_id)}>
                    <span className={`sev ${h.severity}`}>{SEV_LABEL[h.severity]}</span>
                    <span className="ft"><b>{h.title}</b><small>{h.product_id} · {CAT_NAME[h.category]} · {h.rule_name}</small></span>
                    <span className="mono muted">{fmtMD(h.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel rise" style={{ ['--i' as string]: 6 }} aria-labelledby="h-ovf">
            <div className="ph"><h2 id="h-ovf"><span className="eyebrow">Rules</span>많이 걸린 판정 규칙</h2><span className="ph-note">치명·높음 건수 / 공법 수</span></div>
            <ul className="ov-rules">
              {ov.rule_freq.slice(0, 10).map((r) => (
                <li key={r.rule}>
                  <span>{r.name}<small>{CAT_NAME[r.category]}</small></span>
                  <i><em style={{ width: `${(r.count / ruleMax) * 100}%` }} /></i>
                  <b className="mono">{r.count}<small> / {r.products}</small></b>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
