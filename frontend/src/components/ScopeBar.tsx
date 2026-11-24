import type { Dossier } from '../types';
import type { EqpFilter } from '../scope';

type Props = { d: Dossier; stage: string | null; stepId: string | null; eqp: EqpFilter; onClearStage: () => void; onClearStep: () => void; onClearEqp: () => void; onOpenStep: (id: string) => void };

export default function ScopeBar({ d, stage, stepId, eqp, onClearStage, onClearStep, onClearEqp, onOpenStep }: Props) {
  const s = d.steps.find((x) => x.step_id === stepId);
  return (
    <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }} aria-live="polite">
      <span className="eyebrow" style={{ color: 'var(--muted)' }}>Scope</span>
      {stage && <button className="chip" aria-pressed="true" onClick={onClearStage} aria-label="스테이지 선택 해제">스테이지 {stage}<span className="x">✕</span></button>}
      {!s && !eqp && !stage && <span className="muted" style={{ fontSize: 14 }}>공법 전체 · 라우트의 스테이지·스텝이나 설비 차트의 막대를 누르면 아래 패널이 그 범위로 좁혀집니다</span>}
      {s && (
        <>
          <button className="chip" aria-pressed="true" onClick={onClearStep} aria-label="스텝 선택 해제">
            스텝 {String(s.seq).padStart(4, '0')} {s.step_name}<span className="x">✕</span>
          </button>
          <button className="btn" onClick={() => onOpenStep(s.step_id)}>스텝 상세 열기</button>
        </>
      )}
      {eqp && (
        <button className="chip mono" aria-pressed="true" onClick={onClearEqp} aria-label="설비 선택 해제">
          {eqp.kind === 'eqp' ? '설비' : '모델'} {eqp.id}<span className="x">✕</span>
        </button>
      )}
    </div>
  );
}
