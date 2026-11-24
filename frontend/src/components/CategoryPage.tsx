import { useMemo, useState } from 'react';
import type { CategorySummary, CatEvent, CatPoint, CatProduct, Category, Meta, Sev } from '../types';
import { categoryCsvUrl } from '../api';
import { CAT_NAME, cssVar, fmtMD, fmtN, levelColor, SEV_LABEL, SEVS, useTheme, isPending } from '../lib';
import DataTable, { type Col } from './DataTable';
import EChart from './EChart';

type Props = {
  meta: Meta; data?: CategorySummary; loading: boolean; error?: Error | null; cat: Category;
  onCat: (c: Category) => void; onHome: () => void; onProduct: (id: string, detail?: string) => void;
};

const SEV_VAR: Record<Sev, string> = { CRIT: '--crit', HIGH: '--high', MED: '--med', LOW: '--aqua' };
type EvCol = [key: string, label: string, opt?: { num?: boolean; mono?: boolean; wrap?: boolean; dt?: boolean }];

/** 점검 항목별 실제 이력 컬럼 · 실데이터에서 항목을 늘리면 여기에 컬럼만 추가 */
const EVENT_COLS: Partial<Record<Category, EvCol[]>> = {
  interlock: [['occurred_at', '발생', { dt: true, mono: true }], ['eqp_id', '설비', { mono: true }], ['il_code', '코드', { mono: true }], ['category', '분류'], ['severity', '등급'],
    ['description', '내용', { wrap: true }], ['release_type', '해제 방식'], ['released_by', '해제자'], ['released_at', '해제', { dt: true, mono: true }], ['lot_id', 'LOT', { mono: true }], ['step_id', '스텝', { mono: true }]],
  maint: [['start_at', '시작', { dt: true, mono: true }], ['eqp_id', '설비', { mono: true }], ['mt_type', '구분'], ['reason', '사유', { wrap: true }], ['parts', '교체 부품', { wrap: true }],
    ['qual_result', 'Qual 결과'], ['qual_at', 'Qual 완료', { dt: true, mono: true }], ['lots_before_qual', 'Qual 전 LOT', { num: true }], ['performed_by', '작업자']],
  change: [['changed_at', '변경', { dt: true, mono: true }], ['eqp_id', '설비', { mono: true }], ['category', '분류'], ['item', '항목', { wrap: true }], ['before', '변경 전', { wrap: true }], ['after', '변경 후', { wrap: true }],
    ['ecn_no', 'ECN', { mono: true }], ['requested_by', '요청'], ['approved_by', '승인'], ['verify_status', '검증']],
  spec: [['changed_at', '개정', { dt: true, mono: true }], ['product_id', '공법', { mono: true }], ['step_id', '스텝', { mono: true }], ['param', '파라미터'], ['rev', 'Rev', { num: true }],
    ['target_before', '타겟 전', { num: true }], ['target_after', '타겟 후', { num: true }], ['lsl_before', 'LSL 전', { num: true }], ['lsl_after', 'LSL 후', { num: true }],
    ['usl_before', 'USL 전', { num: true }], ['usl_after', 'USL 후', { num: true }], ['reason', '사유', { wrap: true }], ['requested_by', '요청'], ['approved_by', '승인']],
  process: [['product_id', '공법', { mono: true }], ['step_id', '스텝', { mono: true }], ['step_name', '스텝명'], ['stage', '스테이지'], ['step_grade', '등급'], ['param', '파라미터'],
    ['meas_step_id', '계측 스텝', { mono: true }], ['target', '타겟', { num: true }], ['lsl', 'LSL', { num: true }], ['usl', 'USL', { num: true }], ['mean', '평균', { num: true }],
    ['sigma_within', 'σ군내', { num: true }], ['sigma_overall', 'σ전체', { num: true }], ['cp', 'Cp', { num: true }], ['cpk', 'Cpk', { num: true }], ['pp', 'Pp', { num: true }], ['ppk', 'Ppk', { num: true }],
    ['req', '요구 Cpk', { num: true }], ['ooc_30d', 'OOC 30일', { num: true }], ['oos_30d', 'OOS 30일', { num: true }]],
  tttm: [['product_id', '공법', { mono: true }], ['step_id', '스텝', { mono: true }], ['step_name', '스텝명'], ['step_grade', '등급'], ['param', '파라미터'], ['eqp_id', '설비', { mono: true }],
    ['n', 'n', { num: true }], ['mean', '평균', { num: true }], ['sigma_within', 'σ군내', { num: true }], ['ms', 'M/S', { num: true }], ['sr', 'S/R', { num: true }], ['cpk', '설비 Cpk', { num: true }], ['ppk', '설비 Ppk', { num: true }]],
  equip: [['eqp_id', '설비', { mono: true }], ['eqp_model', '모델'], ['maker', '제조사'], ['module', '모듈'], ['status', '상태'], ['qualified', 'Qual'], ['steps', '담당 스텝', { num: true }],
    ['pm_overdue_days', 'PM 초과일', { num: true }], ['il_window', '인터락', { num: true }], ['bm_window', 'BM', { num: true }], ['unapproved', '미승인 변경', { num: true }]],
};
EVENT_COLS.detect = EVENT_COLS.change;

const TITLE_HINT: Partial<Record<Category, string>> = {
  interlock: '호환설비 인터락 이벤트', tttm: '스텝×설비 출력 (M/S · S/R · 설비 Cpk)', maint: 'PM/BM 작업', change: '설비·레시피 변경', detect: 'FDC/NPW·인터락 기준 변경', spec: '타겟표준 개정', process: '계측 스텝 SPC', equip: '호환설비',
};

export default function CategoryPage({ meta, data, loading, error, cat, onCat, onHome, onProduct }: Props) {
  const { dark, tick } = useTheme();
  const group = meta.groups.find((g) => g.cats.includes(cat))!;
  const connected = !isPending(meta, cat);
  const lineName = useMemo(() => Object.fromEntries(meta.lines.map((l) => [l.line_id, l.line_name.replace(/^FAB\d\s*/, '')])), [meta]);
  const [lineF, setLineF] = useState('');

  const prods = useMemo(() => (data?.products ?? []).filter((p) => !lineF || p.line_id === lineF), [data, lineF]);
  const worst = prods.filter((p) => p.points > 0).slice(0, 10);
  const best = [...prods].sort((a, b) => a.points - b.points || b.wip_wafers - a.wip_wafers).slice(0, 10);
  const maxPts = Math.max(...prods.map((p) => p.points), 1);
  const detail = data?.products[0]?.detail;

  const dist = useMemo(() => {
    if (!data) return {};
    const mute = cssVar('--muted'), grid = cssVar('--line'), fg = cssVar('--fg-2');
    const ps = prods.filter((p) => p.points > 0);
    return {
      animationDuration: 700,
      grid: { left: 44, right: 16, top: 30, bottom: 70 },
      legend: { top: 0, right: 8, textStyle: { color: fg }, itemWidth: 12, itemHeight: 10 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: cssVar('--panel'), borderColor: grid, textStyle: { color: fg } },
      xAxis: { type: 'category', data: ps.map((p) => p.product_id), axisLabel: { color: mute, rotate: 55, fontSize: 11, fontFamily: 'IBM Plex Mono' }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', name: '건', nameTextStyle: { color: mute }, axisLabel: { color: mute }, splitLine: { lineStyle: { color: grid } } },
      series: SEVS.map((s) => ({
        name: SEV_LABEL[s], type: 'bar', stack: 'p', barMaxWidth: 22, cursor: 'pointer',
        itemStyle: { color: cssVar(SEV_VAR[s]), borderRadius: s === 'LOW' ? [3, 3, 0, 0] : 0 },
        data: ps.map((p) => p.severity[s] ?? 0),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prods, dark, tick]);

  const prodCols: Col<CatProduct>[] = useMemo(() => [
    { key: 'rank', label: '#', num: true, value: (r) => (data?.products.indexOf(r) ?? 0) + 1 },
    { key: 'pid', label: '공법', mono: true, value: (r) => r.product_id },
    { key: 'name', label: '제품명', value: (r) => r.product_name },
    { key: 'line', label: '라인', value: (r) => lineName[r.line_id] },
    { key: 'fam', label: '공정', mono: true, value: (r) => r.family_code },
    { key: 'wip', label: '재공', num: true, value: (r) => r.wip_wafers },
    { key: 'pts', label: 'Risk point', num: true, value: (r) => r.points, render: (r) => <b style={{ color: r.points ? 'var(--crit)' : 'var(--ok)' }}>{r.points || '✓ 0'}</b> },
    ...SEVS.map((s) => ({ key: s, label: SEV_LABEL[s], num: true, value: (r: CatProduct) => r.severity[s] ?? 0 })),
    ...(data?.rules ?? []).map((ru) => ({ key: ru.code, label: ru.name, num: true, value: (r: CatProduct) => r.rules[ru.code] ?? 0 })),
    { key: 'ev', label: '이력', num: true, value: (r) => r.events },
    { key: 'fl', label: '근거 이력', num: true, value: (r) => r.flagged },
    { key: 'basis', label: '현황', wrap: true, value: (r) => r.basis },
    { key: 'idx', label: '공법 지수', num: true, value: (r) => r.risk_index },
  ], [data, lineName]);

  const ptCols: Col<CatPoint>[] = useMemo(() => [
    { key: 'sev', label: '심각도', value: (r) => SEV_LABEL[r.severity], render: (r) => <span className={`sev ${r.severity}`}>{SEV_LABEL[r.severity]}</span> },
    { key: 'pid', label: '공법', mono: true, value: (r) => r.product_id },
    { key: 'line', label: '라인', value: (r) => lineName[r.line_id] },
    { key: 'rule', label: '규칙', value: (r) => r.rule_name },
    { key: 'title', label: '내용', wrap: true, value: (r) => r.title },
    { key: 'ev', label: '근거', wrap: true, value: (r) => r.evidence },
    { key: 'eqp', label: '설비', mono: true, value: (r) => r.eqp_id ?? '' },
    { key: 'steps', label: '스텝', mono: true, value: (r) => (r.steps ?? []).slice(0, 3).join(', ') + ((r.steps?.length ?? 0) > 3 ? ` 외 ${r.steps.length - 3}` : '') },
    { key: 'at', label: '시각', mono: true, value: (r) => fmtMD(r.at) },
  ], [lineName]);

  const evCols: Col<CatEvent>[] = useMemo(() => {
    const defs = EVENT_COLS[cat] ?? Object.keys(data?.events[0] ?? {}).filter((k) => !['_key', 'products', 'flag', 'n_products'].includes(k)).map((k) => [k, k] as EvCol);
    return [
      { key: 'flag', label: '판정', value: (r) => (r.flag ? SEV_LABEL[r.flag] : ''), render: (r) => (r.flag ? <span className={`sev ${r.flag}`}>{SEV_LABEL[r.flag]}</span> : <span className="muted">-</span>) },
      ...defs.map(([k, label, o]) => ({
        key: k, label, num: o?.num, mono: o?.mono, wrap: o?.wrap,
        value: (r: CatEvent) => { const v = r[k]; return typeof v === 'boolean' ? (v ? 'Y' : 'N') : o?.dt && typeof v === 'string' ? v.replace('T', ' ').slice(0, 16) : (v as string | number | null); },
      })),
      {
        key: 'products', label: '영향 공법', value: (r) => r.products.join(' '),
        render: (r) => (
          <span className="cp-prods" title={r.products.join(', ')}>
            {r.products.slice(0, 3).map((id) => <button key={id} className="chip mono" onClick={(e) => { e.stopPropagation(); onProduct(id, detail); }}>{id}</button>)}
            {r.products.length > 3 && <span className="muted"> 외 {r.products.length - 3}</span>}
          </span>
        ),
      },
    ];
  }, [cat, data, detail, onProduct]);

  return (
    <div className="cp">
      {/* ───── 머리 ───── */}
      <section className="panel cp-head rise">
        <div className="cp-top">
          <button className="crumb-home" onClick={onHome}>← 종합</button>
          <nav className="crumb" aria-label="현재 위치"><span className="lvl">CATEGORY</span><span>{group.name}</span><span className="sep">›</span><b>{CAT_NAME[cat]}</b></nav>
          <div className="seg" role="group" aria-label="라인 필터" style={{ marginLeft: 'auto' }}>
            <button aria-pressed={!lineF} onClick={() => setLineF('')}>전체 라인</button>
            {meta.lines.map((l) => <button key={l.line_id} aria-pressed={lineF === l.line_id} onClick={() => setLineF(l.line_id)}>{lineName[l.line_id]}</button>)}
          </div>
        </div>
        <div className="cp-groups" role="tablist" aria-label="점검 항목">
          {meta.groups.map((g) => (
            <div key={g.key} className={`cp-g${g.key === group.key ? ' cur' : ''}`}>
              <span className="eyebrow">{g.en}</span>
              <div className="cp-tabs">
                {g.cats.map((c) => {
                  const pend = isPending(meta, c);
                  return <button key={c} role="tab" aria-selected={c === cat} className={pend ? 'pend' : ''} onClick={() => onCat(c)}>{CAT_NAME[c]}{pend && <small>연결 예정</small>}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="cp-title">
          <div>
            <p className="eyebrow">{group.en} · 전 공법 집계 · 최근 {meta.window_days}일</p>
            <h1>{meta.categories[cat] ?? CAT_NAME[cat]}</h1>
          </div>
          {data && connected && (
            <dl className="cp-kpis">
              <div className={data.total ? 'bad' : 'good'}><dt>Risk point</dt><dd>{fmtN(prods.reduce((a, p) => a + p.points, 0))}<small>건</small></dd>
                <span>{SEVS.filter((s) => data.severity[s]).map((s) => <span key={s} className={`sev ${s}`}>{SEV_LABEL[s]} {data.severity[s]}</span>)}</span></div>
              <div><dt>리스크 공법</dt><dd>{prods.filter((p) => p.points).length}<small>/ {prods.length}</small></dd><span>이상 없음 {prods.filter((p) => !p.points).length}개</span></div>
              <div><dt>실제 이력</dt><dd>{fmtN(data.events_total)}<small>건</small></dd><span>리스크 근거 {fmtN(data.events_flagged)}건 · {TITLE_HINT[cat] ?? ''}</span></div>
              <div><dt>판정 규칙</dt><dd>{data.rules.filter((r) => r.count).length}<small>/ {data.rules.length}</small></dd><span>걸린 규칙 / 전체</span></div>
            </dl>
          )}
        </div>
      </section>

      {error && <div className="err" role="alert"><h2>{CAT_NAME[cat]} 집계를 불러오지 못했습니다</h2><p>{error.message}</p></div>}
      {loading && <div className="skeleton" aria-label="불러오는 중" />}

      {!connected && !loading && (
        <section className="panel cp-pending rise">
          <h2>{CAT_NAME[cat]} — 데이터 연결 예정</h2>
          <p>{meta.pending?.[cat] ? `${meta.pending[cat]} · ` : ''}{CAT_NAME[cat]} 원천 테이블이 아직 연결되지 않았습니다. 연결하면 이 페이지에 공법별 Worst/Best, 판정 규칙별 건수, 실제 이력이 같은 형태로 나옵니다.</p>
          <ol>
            <li><code>docs/EXTENDING.md</code> 2장의 절차대로 원천 테이블을 저장소(CSV/SQL)에 추가</li>
            <li><code>backend/app/services/risk.py</code> 에 판정 규칙(Rule, category="{cat}") 추가</li>
            <li><code>backend/app/services/catalog.py</code> 의 <code>EVENT_SOURCE</code> 에 이력 원천 한 줄 추가 · 화면 컬럼은 <code>CategoryPage.tsx</code> 의 <code>EVENT_COLS</code></li>
          </ol>
        </section>
      )}

      {data && connected && (
        <>
          {/* ───── Worst / Best ───── */}
          <div className="cp-wb">
            <section className="panel rise" style={{ ['--i' as string]: 1 }} aria-labelledby="h-worst">
              <div className="ph"><h2 id="h-worst"><span className="eyebrow" style={{ color: 'var(--crit)' }}>Worst</span>리스크가 많은 공법</h2><span className="ph-note">누르면 그 공법의 {CAT_NAME[cat]} 상세</span></div>
              {worst.length ? <ol className="cp-list">{worst.map((p, i) => <Row key={p.product_id} p={p} i={i} max={maxPts} lineName={lineName} onClick={() => onProduct(p.product_id, p.detail)} />)}</ol>
                : <div className="empty">리스크가 있는 공법이 없습니다.</div>}
            </section>
            <section className="panel rise" style={{ ['--i' as string]: 2 }} aria-labelledby="h-best">
              <div className="ph"><h2 id="h-best"><span className="eyebrow" style={{ color: 'var(--ok)' }}>Best</span>리스크가 적은 공법</h2><span className="ph-note">Risk point 적은 순 · 같으면 재공 큰 순</span></div>
              <ol className="cp-list best">{best.map((p, i) => <Row key={p.product_id} p={p} i={i} max={maxPts} lineName={lineName} onClick={() => onProduct(p.product_id, p.detail)} />)}</ol>
            </section>
          </div>

          {/* ───── 분포 + 규칙 ───── */}
          <div className="cp-wb wide">
            <section className="panel rise" style={{ ['--i' as string]: 3 }} aria-labelledby="h-dist">
              <div className="ph"><h2 id="h-dist"><span className="eyebrow">Distribution</span>공법별 Risk point 분포</h2><span className="ph-note">리스크가 있는 {prods.filter((p) => p.points).length}개 공법 · 막대를 누르면 공법 상세</span></div>
              <EChart className="cp-chart" option={dist} ariaLabel="공법별 Risk point 분포"
                onClick={(e) => { const id = String(e.name ?? ''); const p = data.products.find((x) => x.product_id === id); if (p) onProduct(id, p.detail); }} />
            </section>
            <section className="panel rise" style={{ ['--i' as string]: 4 }} aria-labelledby="h-rules">
              <div className="ph"><h2 id="h-rules"><span className="eyebrow">Rules</span>판정 규칙별 집계</h2><span className="ph-note">건수 / 걸린 공법 수</span></div>
              <ul className="cp-rules">
                {data.rules.map((r) => {
                  const mx = Math.max(...data.rules.map((x) => x.count), 1);
                  return (
                    <li key={r.code} className={r.count ? 'bad' : 'good'} title={r.criterion}>
                      <div><b>{r.name}</b><span className={`sev ${r.severity}`}>{SEV_LABEL[r.severity]}</span></div>
                      <p>{r.criterion}</p>
                      <i><em style={{ width: `${(r.count / mx) * 100}%` }} /></i>
                      <span className="n">{r.count ? <><b>{fmtN(r.count)}</b>건 · {r.products}개 공법</> : '✓ 통과'}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {/* ───── 실제 이력 ───── */}
          <section className="panel rise" style={{ ['--i' as string]: 5 }} aria-labelledby="h-ev">
            <div className="ph"><h2 id="h-ev"><span className="eyebrow">History</span>실제 이력 · {TITLE_HINT[cat] ?? CAT_NAME[cat]}</h2>
              <span className="ph-note">{data.events.length < data.events_total ? `화면 ${fmtN(data.events.length)}건 (리스크 근거·최근 순) · 전체 ${fmtN(data.events_total)}건은 원본 CSV` : `${fmtN(data.events_total)}건`} · 설비 이력은 같은 설비를 쓰는 공법에 함께 집계</span></div>
            <DataTable rows={lineF ? data.events.filter((e) => e.products.some((id) => data.products.find((p) => p.product_id === id)?.line_id === lineF)) : data.events}
              cols={evCols} rowKey={(r) => r._key} flag={(r) => (r.flag === 'CRIT' || r.flag === 'HIGH' ? 'flag' : r.flag ? 'warn' : '')}
              file={`${cat}_이력.csv`} placeholder="설비 · 코드 · 내용 · 공법 검색" serverCsv={categoryCsvUrl(cat, 'events')} />
          </section>

          {/* ───── 공법별 전체 ───── */}
          <section className="panel rise" style={{ ['--i' as string]: 6 }} aria-labelledby="h-cpp">
            <div className="ph"><h2 id="h-cpp"><span className="eyebrow">Products</span>공법별 집계 전체</h2><span className="ph-note">행을 누르면 그 공법의 {CAT_NAME[cat]} 상세 페이지</span></div>
            <DataTable rows={prods} cols={prodCols} rowKey={(r) => r.product_id} flag={(r) => (r.severity.CRIT ? 'flag' : r.points ? 'warn' : '')}
              file={`${cat}_공법별.csv`} placeholder="공법 · 제품명 검색" onRow={(r) => onProduct(r.product_id, r.detail)} serverCsv={categoryCsvUrl(cat, 'products')} />
          </section>

          {/* ───── Risk point 전체 ───── */}
          <section className="panel rise" style={{ ['--i' as string]: 7 }} aria-labelledby="h-cpt">
            <div className="ph"><h2 id="h-cpt"><span className="eyebrow">Risk points</span>{CAT_NAME[cat]} Risk point 전체</h2><span className="ph-note">심각도 · 재공 순 · 행을 누르면 공법 상세</span></div>
            <DataTable rows={lineF ? data.points.filter((p) => p.line_id === lineF) : data.points} cols={ptCols} rowKey={(r) => `${r.product_id}${r.id}`}
              flag={(r) => (r.severity === 'CRIT' ? 'flag' : r.severity === 'HIGH' ? 'warn' : '')}
              file={`${cat}_risk_point.csv`} placeholder="공법 · 규칙 · 설비 검색" onRow={(r) => onProduct(r.product_id, detail)} serverCsv={categoryCsvUrl(cat, 'points')} />
          </section>
        </>
      )}
    </div>
  );
}

function Row({ p, i, max, lineName, onClick }: { p: CatProduct; i: number; max: number; lineName: Record<string, string>; onClick: () => void }) {
  return (
    <li style={{ ['--i' as string]: i }}>
      <button onClick={onClick}>
        <span className="rk mono">{i + 1}</span>
        <span className="nm"><b>{p.product_name}</b><small><span className="mono">{p.product_id}</span> · {lineName[p.line_id]} · {p.family_code} · 재공 {fmtN(p.wip_wafers)}</small></span>
        <span className="bar">
          <i>{SEVS.map((s) => (p.severity[s] ? <em key={s} style={{ width: `${(p.severity[s]! / max) * 100}%`, background: `var(${SEV_VAR[s]})` }} title={`${SEV_LABEL[s]} ${p.severity[s]}`} /> : null))}</i>
          <small className="muted">{p.basis}</small>
        </span>
        <span className="pts" style={{ color: p.points ? levelColor(p.level_cat === 'CRIT' ? '위험' : p.level_cat === 'HIGH' ? '경고' : '주의') : 'var(--ok)' }}>{p.points ? p.points : '✓'}<small>{p.points ? '건' : '이상 없음'}</small></span>
      </button>
    </li>
  );
}
