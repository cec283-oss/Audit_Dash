import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Dossier, Meta } from '../types';

type Item = { grp: string; ic: string; t: string; sub: string; run: () => void };
type Props = { meta: Meta; d?: Dossier; onClose: () => void; onProduct: (id: string) => void; onStep: (id: string) => void; onEqp: (id: string) => void };

export default function Palette({ meta, d, onClose, onProduct, onStep, onEqp }: Props) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { inp.current?.focus(); }, []);

  const all = useMemo<Item[]>(() => {
    const items: Item[] = meta.products.map((p) => ({
      grp: '공법(제품)', ic: p.node, t: p.product_name, sub: `${p.product_id} · ${p.family_code} ${p.family_name ?? ''} · 재공 ${p.wip_wafers.toLocaleString()}`, run: () => onProduct(p.product_id),
    }));
    if (d) {
      d.steps.forEach((s) => items.push({ grp: `스텝 · ${d.product.product_name}`, ic: String(s.seq).padStart(3, '0'), t: s.step_name, sub: `${s.module} · ${s.param ?? ''} · ${s.recipe_id ?? ''}`, run: () => onStep(s.step_id) }));
      d.equipment.forEach((e) => items.push({ grp: `호환설비 · ${d.product.product_name}`, ic: e.module?.slice(0, 2) ?? '', t: e.eqp_id, sub: `${e.eqp_model} · ${e.maker ?? ''} · 인터락 ${e.il_window}`, run: () => onEqp(e.eqp_id) }));
    }
    return items;
  }, [meta, d, onProduct, onStep, onEqp]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (ql ? all.filter((x) => `${x.t} ${x.sub} ${x.grp}`.toLowerCase().includes(ql)) : all).slice(0, 60);
  }, [all, q]);
  useEffect(() => setI(0), [q]);

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { list[i]?.run(); }
    else if (e.key === 'Escape') { onClose(); }
  };
  useEffect(() => { document.querySelector('.cmd-list [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [i]);

  let last = '';
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="공법·스텝·설비 검색">
        <div className="cmd-in">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input ref={inp} id="cmd-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="공법명, 스텝, 설비 ID, 모델, 레시피 검색" autoComplete="off" aria-controls="cmd-list" />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmd-list" id="cmd-list" role="listbox">
          {list.length === 0 && <li className="empty">찾는 항목이 없습니다.</li>}
          {list.map((x, k) => {
            const head = x.grp !== last ? <li className="grp" key={`g-${x.grp}`}>{x.grp}</li> : null;
            last = x.grp;
            return [head, (
              <li key={`${x.grp}-${x.t}-${k}`}>
                <button role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={x.run}>
                  <span className="ic">{x.ic}</span><span className="t">{x.t}</span><small>{x.sub}</small>
                </button>
              </li>
            )];
          })}
        </ul>
        <div className="cmd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 선택</span><span>스텝·설비는 현재 공법 기준</span></div>
      </div>
    </div>
  );
}
