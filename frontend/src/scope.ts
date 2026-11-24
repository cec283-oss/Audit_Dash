import type { Dossier } from './types';

export type EqpFilter = { kind: 'eqp' | 'model'; id: string } | null;
export type Group = 'eqp' | 'model';

/** 선택한 스텝·설비(또는 모델) 기준으로 화면 아래쪽 패널들이 볼 범위 */
export function makeScope(d: Dossier, stepId: string | null, eqp: EqpFilter, stage: string | null = null) {
  const modelOf = new Map(d.equipment.map((e) => [e.eqp_id, e.eqp_model]));
  let ids = new Set(d.equipment.map((e) => e.eqp_id));
  const stageSteps = stage ? new Set(d.steps.filter((s) => s.stage === stage).map((s) => s.step_id)) : null;
  if (stageSteps) ids = new Set(d.steps.filter((s) => stageSteps.has(s.step_id)).flatMap((s) => s.compat.map((c) => c.eqp_id)));
  if (stepId) {
    const s = d.steps.find((x) => x.step_id === stepId);
    ids = new Set(s ? s.compat.map((c) => c.eqp_id) : []);
  }
  if (eqp) {
    ids = new Set([...ids].filter((i) => (eqp.kind === 'eqp' ? i === eqp.id : modelOf.get(i) === eqp.id)));
  }
  const active = !!stepId || !!eqp || !!stage;
  return {
    active,
    eqps: ids,
    interlocks: active ? d.interlocks.filter((i) => ids.has(i.eqp_id)) : d.interlocks,
    maintenance: active ? d.maintenance.filter((m) => ids.has(m.eqp_id)) : d.maintenance,
    changes: active
      ? d.changes.filter((c) => (c.eqp_id && ids.has(c.eqp_id)) || (!eqp && !!c.step_id && (c.step_id === stepId || !!stageSteps?.has(c.step_id))))
      : d.changes,
    targetChanges: stepId ? d.target_changes.filter((t) => t.step_id === stepId) : eqp ? [] : stageSteps ? d.target_changes.filter((t) => stageSteps.has(t.step_id)) : d.target_changes,
    points: d.risk_points.filter((p) =>
      (!stepId || p.steps.includes(stepId)) && (!stageSteps || p.steps.some((x) => stageSteps.has(x))) && (!eqp || (p.eqp_id ? ids.has(p.eqp_id) : false))),
  };
}
export type Scope = ReturnType<typeof makeScope>;
