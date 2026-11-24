import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DATA_MODE, fetchCategory, fetchDossier, fetchMeta, fetchOverview, fetchTop } from './api';
import { ThemeCtx, useThemeState } from './lib';
import { makeScope, type EqpFilter, type Group } from './scope';
import type { Category, Meta, ProductLite } from './types';
import { CAT_ORDER } from './lib';
import Boot from './components/Boot';
import TopBar from './components/TopBar';
import Drill from './components/Drill';
import Overview from './components/Overview';
import CategoryPage from './components/CategoryPage';
import TopFive from './components/TopFive';
import BasicInfo from './components/BasicInfo';
import RiskChecks from './components/RiskChecks';
import RouteMap from './components/RouteMap';
import RiskPoints from './components/RiskPoints';
import EquipmentPanel from './components/EquipmentPanel';
import Timeline from './components/Timeline';
import DetailPage from './components/detail/DetailPage';
import { isItem, type ItemKey } from './components/detail/columns';
import StepDrawer from './components/StepDrawer';
import Palette from './components/Palette';
import RulesModal from './components/RulesModal';
import ScopeBar from './components/ScopeBar';

const HASH_RE = /^#(p|risk|flow|target|spec|eqp|il|pmbm|chg)-([A-Za-z0-9-]+)$/;
const CAT_RE = /^#cat-([a-z_]+)$/;
const parseCat = (): Category | null => { const m = location.hash.match(CAT_RE); return m && (CAT_ORDER as string[]).includes(m[1]) ? (m[1] as Category) : null; };
const parseHash = () => { const m = location.hash.match(HASH_RE); return m ? { item: isItem(m[1]) ? m[1] : null, id: m[2] } : null; };
type Sel = { line: string; node: string; family: string; product: string | null };

function firstOf(meta: Meta, line: string, node?: string): Sel {
  const l = meta.lines.find((x) => x.line_id === line) ?? meta.lines[0];
  const n = l.nodes.find((x) => x.node === node) ?? l.nodes[0];
  return { line: l.line_id, node: n.node, family: n.families[0].family_code, product: null };
}
const selOf = (p: ProductLite): Sel => ({ line: p.line_id, node: p.node, family: p.family_code, product: p.product_id });

export default function App() {
  const theme = useThemeState();
  const [tick, setTick] = useState(0);
  useEffect(() => setTick((t) => t + 1), [theme.dark]);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [booted, setBooted] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [eqp, setEqp] = useState<EqpFilter>(null);
  const [group, setGroup] = useState<Group>('eqp');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [rules, setRules] = useState(false);
  // 새로고침·첫 진입은 항상 종합 OVERVIEW (주소의 #… 는 무시하고 #overview 로 교체)
  const [view, setView] = useState<ItemKey | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  // 첫 화면 = 종합 대시보드. 주소에 공법(#p-…)이 있으면 그 공법 페이지
  const [home, setHome] = useState(true);
  const overview = useQuery({ queryKey: ['overview'], queryFn: fetchOverview, enabled: home, staleTime: 5 * 60_000 });
  const [cat, setCat] = useState<Category | null>(null);
  useEffect(() => { if (location.hash !== '#overview') history.replaceState(null, '', '#overview'); }, []);
  const catQ = useQuery({ queryKey: ['cat', cat], queryFn: () => fetchCategory(cat!), enabled: !!cat, staleTime: 5 * 60_000 });
  const qc = useQueryClient();

  const resetDetail = () => { setStepId(null); setEqp(null); setDrawer(null); setStage(null); };

  // 첫 진입: 주소의 #p-<공법> 이 있으면 그 공법, 없으면 첫 라인·노드·공정
  useEffect(() => {
    if (!meta.data || sel || home) return;
    const id = parseHash()?.id;
    const p = id && meta.data.products.find((x) => x.product_id === id);
    setSel(p ? selOf(p) : firstOf(meta.data, meta.data.lines[0].line_id));
  }, [meta.data, sel, home]);

  const top = useQuery({ queryKey: ['top', sel?.node, sel?.family], queryFn: () => fetchTop(sel!.node, sel!.family), enabled: !!sel });

  // 공정을 바꾸면 재공 1위 공법을 기본 선택
  useEffect(() => {
    if (sel && !sel.product && top.data && top.data.family_code === sel.family && top.data.node === sel.node) {
      setSel({ ...sel, product: top.data.items[0]?.product_id ?? null });
    }
  }, [sel, top.data]);

  useEffect(() => {
    if (cat) { if (location.hash !== `#cat-${cat}`) history.pushState(null, '', `#cat-${cat}`); return; }
    if (home) { if (location.hash !== '#overview') history.pushState(null, '', '#overview'); return; }
    if (sel?.product && /^[A-Za-z0-9-]+$/.test(sel.product)) {
      const h = `#${view ?? 'p'}-${sel.product}`;
      if (location.hash !== h) history.pushState(null, '', h);
    }
  }, [sel?.product, view, home, cat]);

  useEffect(() => {
    const f = () => {
      const c = parseCat();
      setCat(c);
      if (c) return;
      if (!location.hash || location.hash === '#overview') { setHome(true); setView(null); return; }
      const h = parseHash();
      const p = h && meta.data?.products.find((x) => x.product_id === h.id);
      if (!p || !h) return;
      setHome(false);
      setView(h.item);
      setSel((cur) => (cur?.product === p.product_id ? cur : selOf(p)));
    };
    addEventListener('hashchange', f);
    addEventListener('popstate', f);
    return () => { removeEventListener('hashchange', f); removeEventListener('popstate', f); };
  }, [meta.data]);

  const productId = sel?.product ?? null;
  const dossier = useQuery({ queryKey: ['dossier', productId], queryFn: () => fetchDossier(productId!), enabled: !!productId });
  const d = dossier.data && dossier.data.product.product_id === productId ? dossier.data : undefined;
  const scope = useMemo(() => (d ? makeScope(d, stepId, eqp, stage) : null), [d, stepId, eqp, stage]);

  // Top 5 가 뜨면 5개 공법 상세를 미리 받아 둠 → 카드 전환 즉시
  useEffect(() => {
    top.data?.items.forEach((x) => qc.prefetchQuery({ queryKey: ['dossier', x.product_id], queryFn: () => fetchDossier(x.product_id), staleTime: 5 * 60_000 }));
  }, [top.data, qc]);

  const goProduct = useCallback((p: ProductLite) => { setCat(null); setSel(selOf(p)); resetDetail(); setView(null); setHome(false); scrollTo({ top: 0 }); }, []);
  const goHome = useCallback(() => { setCat(null); setHome(true); setView(null); setDrawer(null); scrollTo({ top: 0 }); }, []);
  const goFamily = useCallback((line: string, node: string, family: string) => {
    setCat(null); setSel({ line, node, family, product: null }); resetDetail(); setView(null); setHome(false); scrollTo({ top: 0 });
  }, []);
  const goCat = useCallback((c: Category) => { setCat(c); setDrawer(null); scrollTo({ top: 0 }); }, []);
  const openItem = useCallback((k: ItemKey | null) => { setView(k); setDrawer(null); if (!k) setTimeout(() => document.getElementById('h-items')?.scrollIntoView({ block: 'center' }), 60); }, []);
  const goProductId = useCallback((id: string) => {
    const p = meta.data?.products.find((x) => x.product_id === id);
    if (p) goProduct(p);
  }, [meta.data, goProduct]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      else if (e.key === '/' && !/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); setPalette(true); }
      else if (e.key === 'Escape') setDrawer(null);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const openStep = useCallback((id: string) => { setStepId(id); setDrawer(id); }, []);
  const pickEqp = useCallback((f: EqpFilter) => setEqp((cur) => (f && cur && cur.kind === f.kind && cur.id === f.id ? null : f)), []);

  if (meta.isError) {
    return (
      <div className="err" role="alert">
        <h2>데이터를 불러오지 못했습니다</h2>
        <p>{String((meta.error as Error).message)}</p>
        <p>백엔드가 켜져 있는지 확인하세요: <code>cd backend && uvicorn app.main:app --port 8000</code></p>
      </div>
    );
  }
  const line = meta.data && sel ? meta.data.lines.find((l) => l.line_id === sel.line) : undefined;

  return (
    <ThemeCtx.Provider value={{ dark: theme.dark, tick }}>
      <div className="bg-fx" aria-hidden="true" />
      {!booted && <Boot meta={meta.data} onDone={() => setBooted(true)} />}
      <TopBar meta={meta.data} lineId={home || cat ? '' : sel?.line ?? ''} home={home && !cat} onHome={goHome} onLine={(id) => { setCat(null); setSel(firstOf(meta.data!, id)); resetDetail(); setView(null); setHome(false); }}
        onSearch={() => setPalette(true)} onRules={() => setRules(true)} onTheme={theme.toggle} dataMode={DATA_MODE} />
      <main>
        {cat && meta.data && (
          <CategoryPage meta={meta.data} cat={cat} data={catQ.data?.category === cat ? catQ.data : undefined} loading={catQ.isLoading} error={catQ.error as Error | null}
            onCat={goCat} onHome={goHome}
            onProduct={(id, detail) => {
              const p = meta.data!.products.find((x) => x.product_id === id);
              if (!p) return;
              goProduct(p);
              if (detail && isItem(detail)) setView(detail);
            }} />
        )}
        {!cat && home && overview.isError && <div className="err" role="alert"><h2>종합 현황을 불러오지 못했습니다</h2><p>{String((overview.error as Error).message)}</p></div>}
        {!cat && home && meta.data && !overview.data && !overview.isError && <div className="skeleton" aria-label="불러오는 중" />}
        {!cat && home && meta.data && overview.data && <Overview meta={meta.data} ov={overview.data} onProduct={goProductId} onFamily={goFamily} onCat={goCat} onLine={(id) => { setSel(firstOf(meta.data!, id)); resetDetail(); setView(null); setHome(false); scrollTo({ top: 0 }); }} />}
        {!cat && !home && <>
        {meta.data && line && sel && !(view && d) && (
          <Drill meta={meta.data} line={line} node={sel.node} family={sel.family} productId={productId}
            onNode={(n) => { setSel(firstOf(meta.data!, sel.line, n)); resetDetail(); }}
            onFamily={(f) => { setSel({ ...sel, family: f, product: null }); resetDetail(); }}
            onLookup={goProduct} onHome={goHome} />
        )}
        {top.isError && <div className="err" role="alert"><h2>Top 5를 불러오지 못했습니다</h2><p>{String((top.error as Error).message)}</p></div>}
        {sel && !(view && d) && <TopFive top={top.data} loading={top.isLoading} productId={productId} lookup={d} onSelect={goProductId} />}
        {dossier.isError && <div className="err" role="alert"><h2>공법 데이터를 불러오지 못했습니다</h2><p>{String((dossier.error as Error).message)}</p></div>}
        {productId && !d && !dossier.isError && <div className="skeleton" aria-label="불러오는 중" />}
        {d && view && (
          <DetailPage key={d.product.product_id} d={d} item={view} initStage={stage} initStep={stepId} initEqp={eqp} onItem={openItem} onBack={() => openItem(null)} onOpenStep={(id) => setDrawer(id)}
            onCrumb={(lv) => {
              if (lv === 'home') { goHome(); return; }
              if (lv === 'product') { openItem(null); scrollTo({ top: 0 }); return; }
              // 보던 공법은 그대로 두고 상단 공법 선택 영역으로 · 누른 단계의 줄을 잠깐 강조
              resetDetail(); setView(null);
              scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(() => {
                const row = document.querySelector(`.drill [data-lv="${lv === 'line' ? 'node' : lv === 'node' ? 'family' : 'product'}"]`);
                row?.classList.remove('lv-flash'); void (row as HTMLElement | null)?.offsetWidth; row?.classList.add('lv-flash');
              }, 120);
            }} />
        )}
        {d && scope && !view && (
          <div key={d.product.product_id} style={{ display: 'grid', gap: 18 }}>
            <BasicInfo d={d} />
            <RiskChecks d={d} onOpen={openItem} />
            <RouteMap d={d} stage={stage} onStage={(s) => { setStage(s); setStepId(null); }} stepId={stepId} scopeEqps={eqp ? scope.eqps : null}
              onPick={setStepId} onOpen={openStep} onDetail={() => openItem('flow')} />
            <ScopeBar d={d} stage={stage} stepId={stepId} eqp={eqp} onClearStage={() => setStage(null)} onClearStep={() => setStepId(null)} onClearEqp={() => setEqp(null)} onOpenStep={openStep} />
            <div className="duo">
              <RiskPoints d={d} points={scope.points} rules={meta.data?.rules ?? []} onStep={openStep} onEqp={(id) => pickEqp({ kind: 'eqp', id })} />
              <EquipmentPanel d={d} scope={scope} stepId={stepId} group={group} setGroup={setGroup} eqp={eqp} onEqp={pickEqp} />
            </div>
            <Timeline d={d} scope={scope} />
          </div>
        )}
        </>}
      </main>
      {!cat && !home && d && drawer && <StepDrawer d={d} stepId={drawer} onClose={() => setDrawer(null)} onSim={(id) => { setStepId(id); setDrawer(null); setView('target'); scrollTo({ top: 0 }); }} onEqp={(id) => { pickEqp({ kind: 'eqp', id }); setDrawer(null); }} />}
      {palette && meta.data && (
        <Palette meta={meta.data} d={d} onClose={() => setPalette(false)}
          onProduct={(id) => { goProductId(id); setPalette(false); }}
          onStep={(id) => { openStep(id); setPalette(false); }}
          onEqp={(id) => { pickEqp({ kind: 'eqp', id }); setPalette(false); }} />
      )}
      {rules && meta.data && <RulesModal meta={meta.data} onClose={() => setRules(false)} />}
      <div id="tip" role="tooltip" />
    </ThemeCtx.Provider>
  );
}
