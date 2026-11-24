import type { Category, CategorySummary, Dossier, Meta, Overview, ProductLite, TopResult } from './types';

declare const __DATA_MODE__: 'api' | 'mock';
export const DATA_MODE = __DATA_MODE__;

/* ───── mock (데모 빌드): backend/scripts/export_static.py 가 만든 스냅샷 ───── */
type Bundle = {
  meta: Meta;
  overview: Overview;
  categories: Record<string, CategorySummary>;
  tops: Record<string, TopResult>;
  events: { interlocks: Record<string, unknown>; maintenance: Record<string, unknown>; changes: Record<string, unknown> };
  dossiers: Record<string, Omit<Dossier, 'interlocks' | 'maintenance' | 'changes' | 'steps'> & {
    interlocks: string[]; maintenance: string[]; changes: string[]; steps: { cols: string[]; rows: unknown[][] };
  }>;
};
let bundle: Promise<Bundle> | null = null;
const loadBundle = () => (bundle ??= import('./mock/bundle.json').then((m) => m.default as unknown as Bundle));

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* 본문 없음 */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export async function fetchMeta(): Promise<Meta> {
  if (DATA_MODE === 'mock') return (await loadBundle()).meta;
  return get<Meta>('/api/meta');
}

/** 종합 대시보드: 전 공법 리스크 요약 */
export async function fetchOverview(): Promise<Overview> {
  if (DATA_MODE === 'mock') return (await loadBundle()).overview;
  return get<Overview>('/api/overview');
}

/** 점검 항목 하나의 전 공법 집계 (Worst/Best · 규칙별 · Risk point · 실제 이력) */
export async function fetchCategory(cat: Category): Promise<CategorySummary> {
  if (DATA_MODE === 'mock') {
    const c = (await loadBundle()).categories[cat];
    if (!c) throw new Error(`데모 데이터에 ${cat} 집계가 없습니다.`);
    return c;
  }
  return get<CategorySummary>(`/api/categories/${encodeURIComponent(cat)}`);
}
export const categoryCsvUrl = (cat: string, kind: 'points' | 'products' | 'events') =>
  (DATA_MODE === 'mock' ? undefined : `/api/categories/${encodeURIComponent(cat)}/export.csv?kind=${kind}`);

/** 공정(옵션 계열) 안 재공 상위 5개 공법 */
export async function fetchTop(node: string, family: string): Promise<TopResult> {
  if (DATA_MODE === 'mock') {
    const t = (await loadBundle()).tops[`${node}|${family}`];
    if (!t) throw new Error(`공정 ${family} 데이터가 없습니다.`);
    return t;
  }
  return get<TopResult>(`/api/top?family=${encodeURIComponent(family)}&node=${encodeURIComponent(node)}&n=5`);
}

/** 공법(제품) 직접 조회 */
export async function searchProducts(q: string): Promise<ProductLite[]> {
  if (DATA_MODE === 'mock') {
    const ql = q.trim().toLowerCase();
    return (await loadBundle()).meta.products
      .filter((p) => `${p.product_id} ${p.product_name} ${p.family_code}`.toLowerCase().includes(ql))
      .sort((a, b) => b.wip_wafers - a.wip_wafers).slice(0, 20);
  }
  return get<ProductLite[]>(`/api/products/search?q=${encodeURIComponent(q)}&limit=20`);
}

export const rawZipUrl = (id: string) => (DATA_MODE === 'mock' ? undefined : `/api/products/${encodeURIComponent(id)}/raw.zip`);

export async function fetchDossier(productId: string): Promise<Dossier> {
  if (DATA_MODE === 'mock') {
    const b = await loadBundle();
    const d = b.dossiers[productId];
    if (!d) throw new Error(`데모 HTML 에는 공정별 재공 상위 2개 공법의 상세만 들어 있습니다. ${productId} 는 백엔드(FastAPI) 모드에서 조회하세요.`);
    return {
      ...d,
      steps: d.steps.rows.map((r) => Object.fromEntries(d.steps.cols.map((c, i) => [c, r[i]]))),
      interlocks: d.interlocks.map((id) => b.events.interlocks[id]),
      maintenance: d.maintenance.map((id) => b.events.maintenance[id]),
      changes: d.changes.map((id) => b.events.changes[id]),
    } as unknown as Dossier;
  }
  return get<Dossier>(`/api/products/${encodeURIComponent(productId)}/dossier`);
}
