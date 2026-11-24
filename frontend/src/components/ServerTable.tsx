import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { downloadCsv } from '../lib';
import type { Col } from './DataTable';

export type Params = Record<string, string | undefined>;
type Page<T> = { total: number; flagged: number; offset: number; limit: number; rows: T[] };

type Props<T> = {
  productId: string; item: string; params: Params; cols: Col<T>[]; rowKey: (r: T) => string;
  field: Record<string, string>; flag?: (r: T) => '' | 'flag' | 'warn'; file: string; placeholder: string; onRow?: (r: T) => void;
};

const PAGE = 100;
const qs = (o: Params) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '') as [string, string][]).toString();

/** 대용량용 표: 필터·검색·정렬·페이지를 서버(/records)에서 처리 → 수십만 행이어도 한 페이지(100행)만 받음 */
export default function ServerTable<T>({ productId, item, params, cols, rowKey, field, flag, file, placeholder, onRow }: Props<T>) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [sort, setSort] = useState<{ k: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [onlyFlag, setOnlyFlag] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const pkey = JSON.stringify(params);
  useEffect(() => setPage(0), [pkey, dq, onlyFlag, sort]);

  const query: Params = { ...params, q: dq || undefined, flag: onlyFlag ? 'true' : undefined,
    sort: sort ? field[sort.k] : undefined, desc: sort ? String(sort.desc) : undefined };
  const res = useQuery({
    queryKey: ['records', productId, item, query, page],
    queryFn: async (): Promise<Page<T>> => {
      const r = await fetch(`/api/products/${encodeURIComponent(productId)}/records/${item}?${qs({ ...query, offset: String(page * PAGE), limit: String(PAGE) })}`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const data = res.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const exportUrl = `/api/products/${encodeURIComponent(productId)}/export/${item}.csv?${qs({ ...params, q: dq || undefined, flag: onlyFlag ? 'true' : undefined })}`;
  const id = `sq-${item}`;

  return (
    <>
      <div className="tab-tools">
        <label className="sfield" htmlFor={id}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input id={id} type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        {data && data.flagged > 0 && (
          <button className="chip" aria-pressed={onlyFlag} onClick={() => setOnlyFlag(!onlyFlag)}><i style={{ background: 'var(--crit)' }} />리스크 근거만 {data.flagged.toLocaleString()}</button>
        )}
        {res.isFetching && <span className="lk-spin" aria-label="불러오는 중" />}
        <span className="cnt">{data ? `${data.total.toLocaleString()}건 · ${page + 1} / ${pages} 페이지` : '불러오는 중'}</span>
        <button className="btn" disabled={!data} onClick={() => data && downloadCsv(file.replace('.csv', `_p${page + 1}.csv`), data.rows.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.value(r)]))))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>현재 페이지 CSV
        </button>
        <a className="btn primary" href={exportUrl} download title="지금 걸린 필터·검색을 적용한 전체 행, 전체 컬럼 (서버 스트리밍)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>전체 원본 CSV{data ? ` (${data.total.toLocaleString()}건)` : ''}
        </a>
      </div>
      {res.isError && <div className="empty">불러오지 못했습니다: {String((res.error as Error).message)}</div>}
      {data && data.rows.length === 0 && <div className="empty">조건에 맞는 이력이 없습니다.</div>}
      {data && data.rows.length > 0 && (
        <div className="tbl-wrap hist-tbl" style={{ opacity: res.isPlaceholderData ? 0.6 : 1 }}>
          <table>
            <thead>
              <tr>{cols.map((c) => {
                const can = !!field[c.key];
                return (
                  <th key={c.key} className={c.num ? 'num' : ''} aria-sort={sort?.k === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                    {can ? (
                      <button onClick={() => setSort(sort?.k === c.key ? { k: c.key, desc: !sort.desc } : { k: c.key, desc: true })}>
                        {c.label}{sort?.k === c.key ? (sort.desc ? ' ▼' : ' ▲') : ''}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}</tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={rowKey(r)} className={flag ? flag(r) : ''} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
                  {cols.map((c) => <td key={c.key} className={[c.num ? 'num' : '', c.wrap ? 'wrap' : '', c.mono ? 'mono' : ''].join(' ')}>{c.render ? c.render(r) : (c.value(r) ?? '-')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page === 0} onClick={() => setPage(0)}>« 처음</button>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ 이전</button>
          <span className="mono">{page + 1} / {pages}</span>
          <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음 ›</button>
          <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>끝 »</button>
        </div>
      )}
    </>
  );
}
