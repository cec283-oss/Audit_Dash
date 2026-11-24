import { useEffect, useRef, useState } from 'react';
import { searchProducts } from '../api';
import type { Line, Meta, ProductLite } from '../types';
import { fmtN } from '../lib';

type Props = {
  meta: Meta; line: Line; node: string; family: string;
  productId: string | null; onNode: (n: string) => void; onFamily: (f: string) => void; onLookup: (p: ProductLite) => void; onHome: () => void;
};

/** 공법(제품) 직접 조회: 입력하면 백엔드 /api/products/search 로 찾고, 고르면 그 공법 데이터를 뽑습니다 */
function Lookup({ onPick }: { onPick: (p: ProductLite) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ProductLite[]>([]);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ql = q.trim();
    if (!ql) { setRes([]); setErr(''); return; }
    setBusy(true);
    const t = setTimeout(() => {
      searchProducts(ql).then((r) => { setRes(r); setI(0); setErr(''); }).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', f);
    return () => removeEventListener('mousedown', f);
  }, []);

  const pick = (p?: ProductLite) => { if (!p) return; onPick(p); setQ(''); setRes([]); setOpen(false); };

  return (
    <div className="lookup" ref={box}>
      <label className="sfield lk-field" htmlFor="lookup-q">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h10M4 17h7" /><circle cx="18" cy="16" r="3" /><path d="m20.5 18.5 2 2" /></svg>
        <input id="lookup-q" value={q} placeholder="공법(제품) 직접 조회 · ID나 이름 입력 (예: 4F-P-07, Mote)" autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === 'Enter') pick(res[i]);
            else if (e.key === 'Escape') setOpen(false);
          }}
          role="combobox" aria-expanded={open && res.length > 0} aria-controls="lookup-list" />
        {busy && <span className="lk-spin" aria-label="조회 중" />}
      </label>
      {open && q.trim() && (
        <ul className="lk-list" id="lookup-list" role="listbox">
          {err && <li className="empty">조회 실패: {err}</li>}
          {!err && !busy && res.length === 0 && <li className="empty">"{q}" 에 맞는 공법이 없습니다.</li>}
          {res.map((p, k) => (
            <li key={p.product_id}>
              <button role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => pick(p)}>
                <span className="mono id">{p.product_id}</span>
                <span className="t">{p.product_name}</span>
                <small>{p.node} · {p.family_code} {p.family_name} · 재공 {fmtN(p.wip_wafers)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Drill({ meta, line, node, family, productId, onNode, onFamily, onLookup, onHome }: Props) {
  const nd = line.nodes.find((n) => n.node === node) ?? line.nodes[0];
  const fam = nd?.families.find((f) => f.family_code === family);
  const prods = meta.products.filter((p) => p.node === nd?.node && p.family_code === family).sort((a, b) => b.wip_wafers - a.wip_wafers);
  const cur = prods.find((p) => p.product_id === productId);
  return (
    <section className="panel drill rise" aria-label="라인 · 노드 · 공정 선택">
      <div className="drill-top">
        <nav className="crumb" aria-label="현재 범위">
          <button className="crumb-home" onClick={onHome}>← 종합</button>
          <span className="lvl">SCOPE</span>
          <span>{line.line_name}</span><span className="sep">›</span>
          <span>{nd?.node}</span><span className="sep">›</span>
          <span>{fam ? `${fam.family_code} ${fam.family_name ?? ''}` : '-'}</span><span className="sep">›</span>
          <b>{cur ? `${cur.product_name} (${cur.product_id})` : '재공 상위 5개 공법'}</b>
        </nav>
        <Lookup onPick={onLookup} />
      </div>
      <div className="drow" data-lv="node">
        <span>노드</span>
        <div className="dchips" role="group" aria-label="노드">
          {line.nodes.map((n) => (
            <button key={n.node} className="dchip" aria-pressed={n.node === nd?.node} onClick={() => onNode(n.node)}>
              {n.node}<b>{n.families.length}공정 · {n.products}공법 · {fmtN(n.wip)}wf</b>
            </button>
          ))}
        </div>
      </div>
      <div className="drow" data-lv="family">
        <span>공정</span>
        <div className="dchips" role="group" aria-label="공정(옵션 계열)">
          {nd?.families.map((f) => (
            <button key={f.family_code} className="dchip" aria-pressed={f.family_code === family} onClick={() => onFamily(f.family_code)}>
              <span className="mono">{f.family_code}</span> {f.family_name}<b>{f.products}공법 · {fmtN(f.wip)}wf</b>
            </button>
          ))}
        </div>
      </div>
      <div className="drow" data-lv="product">
        <span>공법</span>
        <div className="dchips" role="group" aria-label="공법(제품)">
          {prods.map((p, i) => (
            <button key={p.product_id} className={`dchip pchip${i < 5 ? ' top' : ''}`} aria-pressed={p.product_id === productId} onClick={() => onLookup(p)}
              title={`${p.product_id} · 재공 ${fmtN(p.wip_wafers)}wf${i < 5 ? ' · Top 5' : ''}`}>
              <span className="rk">{i + 1}</span>{p.product_name}
              <b>{fmtN(p.wip_wafers)}wf</b>
              {p.grade === 'Automotive' && <span className="tag auto" style={{ padding: '0 6px', fontSize: 11.5 }}>차량용</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="drill-note">공법은 재공 순 · 1~5위가 아래 Top 5 카드로 나오고, 6위 이하도 눌러서 바로 열 수 있습니다 · 공정 데이터는 공법 기준, 설비 데이터는 그 공법의 호환설비 기준으로 최근 {meta.window_days}일 집계</p>
    </section>
  );
}
