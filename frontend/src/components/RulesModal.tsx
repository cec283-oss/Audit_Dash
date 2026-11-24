import { useEffect, useRef } from 'react';
import type { Meta } from '../types';
import { SEV_LABEL } from '../lib';

export default function RulesModal({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="rules-h">
        <div className="ph">
          <h2 id="rules-h"><span className="eyebrow">Rulebook</span>리스크 판정 기준</h2>
          <button ref={btn} className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="rules-b">
          <p>
            공정 데이터(공정흐름·타겟표준·SPC·스펙 개정)는 <b>공법(제품)</b> 기준으로, 설비 데이터(인터락·PM/BM·변경)는 그 공법의 <b>호환설비</b> 기준으로 최근 {meta.window_days}일을 모읍니다.
            각 규칙에 걸린 건이 리스크 포인트가 되고, 심각도 가중치(치명 12 · 높음 6 · 보통 3 · 낮음 1)의 합을 <b>지수 = 100 × (1 − e<sup>−합/90</sup>)</b>로 바꿉니다.
            75 이상 위험, 55 이상 경고, 35 이상 주의, 그 아래는 양호입니다. 차량용 제품은 변경관리·타겟표준 항목을 한 단계 올려 봅니다.
          </p>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>코드</th><th>규칙</th><th>영역</th><th>기본 심각도</th><th>판정 기준</th></tr></thead>
              <tbody>
                {meta.rules.map((r) => (
                  <tr key={r.code}>
                    <td className="mono">{r.code}</td><td style={{ fontWeight: 600 }}>{r.name}</td><td>{r.category_name}</td>
                    <td><span className={`sev ${r.severity}`}>{SEV_LABEL[r.severity]} · {r.weight}</span></td>
                    <td className="wrap">{r.criterion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">규칙과 가중치는 <code>backend/app/services/risk.py</code> 의 RULES 에서 바꿉니다.</p>
        </div>
      </div>
    </div>
  );
}
