import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv } from '../lib';

export type Col<T> = {
  key: string; label: string; num?: boolean; wrap?: boolean; mono?: boolean;
  value: (r: T) => string | number | null | undefined;
  render?: (r: T) => ReactNode;
};

type Props<T> = { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; flag?: (r: T) => '' | 'flag' | 'warn'; file: string; placeholder: string; extra?: ReactNode; onRow?: (r: T) => void; serverCsv?: string };

export default function DataTable<T>({ rows, cols, rowKey, flag, file, placeholder, extra, onRow, serverCsv }: Props<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(100);
  const [onlyFlag, setOnlyFlag] = useState(false);

  const view = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows.filter((r) => (!onlyFlag || (flag && flag(r))) && (!ql || cols.some((c) => String(c.value(r) ?? '').toLowerCase().includes(ql))));
    if (sort) {
      const c = cols.find((x) => x.key === sort.k)!;
      out = [...out].sort((a, b) => {
        const va = c.value(a), vb = c.value(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')) * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort, cols, onlyFlag, flag]);

  const flagged = flag ? rows.filter((r) => flag(r)).length : 0;
  const id = `q-${file.replace(/\W/g, '')}`;
  return (
    <>
      <div className="tab-tools">
        <label className="sfield" htmlFor={id}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input id={id} type="search" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} autoComplete="off" />
        </label>
        {flag && flagged > 0 && (
          <button className="chip" aria-pressed={onlyFlag} onClick={() => setOnlyFlag(!onlyFlag)}><i style={{ background: 'var(--crit)' }} />리스크 근거만 {flagged}</button>
        )}
        {extra}
        <span className="cnt">{view.length.toLocaleString()} / {rows.length.toLocaleString()}건</span>
        <button className="btn" onClick={() => downloadCsv(file, view.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.value(r)]))))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>CSV · 현재 보기
        </button>
        {serverCsv && (
          <a className="btn" href={serverCsv} download title="백엔드에서 필터(스텝·설비·기간)를 적용한 전체 컬럼 원본">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>원본 CSV
          </a>
        )}
      </div>
      {view.length === 0 ? <div className="empty">조건에 맞는 이력이 없습니다.</div> : (
        <div className="tbl-wrap hist-tbl">
          <table>
            <thead>
              <tr>{cols.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''} aria-sort={sort?.k === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button onClick={() => setSort(sort?.k === c.key ? { k: c.key, dir: sort.dir === 1 ? -1 : 1 } : { k: c.key, dir: c.num ? -1 : 1 })}>
                    {c.label}{sort?.k === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>))}
              </tr>
            </thead>
            <tbody>
              {view.slice(0, limit).map((r) => (
                <tr key={rowKey(r)} className={flag ? flag(r) : ''} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
                  {cols.map((c) => <td key={c.key} className={[c.num ? 'num' : '', c.wrap ? 'wrap' : '', c.mono ? 'mono' : ''].join(' ')}>{c.render ? c.render(r) : (c.value(r) ?? '-')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.length > limit && <div className="more"><button className="btn" onClick={() => setLimit(limit + 200)}>{Math.min(200, view.length - limit)}건 더 보기</button></div>}
    </>
  );
}
