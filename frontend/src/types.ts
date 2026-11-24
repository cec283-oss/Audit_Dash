// backend/app/services/risk.py 응답과 같은 모양

export type Sev = 'CRIT' | 'HIGH' | 'MED' | 'LOW';
export type Level = '양호' | '주의' | '경고' | '위험';
export type Category = 'spec' | 'process' | 'interlock' | 'detect' | 'tttm' | 'equip' | 'maint' | 'cttm' | 'racb' | 'change';

export interface Family { family_code: string; family_name?: string; products: number; wip: number; top: string[] }
export interface NodeGroup { node: string; families: Family[]; products: number; wip: number }
export interface Line { line_id: string; line_name: string; fab?: string; node?: string; tech?: string; nodes: NodeGroup[]; products: number; wip: number }

export interface Summary {
  risk_index: number;
  level: Level;
  raw_score: number;
  severity: Record<Sev, number>;
  by_category: Record<Category, number>;
  checks: Check[];
  groups: { key: string; name: string; en: string; desc: string; cats: Category[]; points: number; level: Lvl }[];
  kpis: {
    steps: number; critical_steps: number; grades: Record<'A' | 'B' | 'C', number>; measured_steps: number; stages: number; recipes: number;
    compat_eqps: number; models: number;
    il_recent: number; il_forced: number; il_active: number; bm_recent: number; pm_overdue: number;
    changes_window: number; unapproved: number; spec_widen: number; low_cpk: number;
    cap_by_grade?: Record<'A' | 'B' | 'C', CapGrade>; cap_all?: CapGrade; tttm_flagged?: number;
  };
  top_rules: string[];
}

export type Lvl = Sev | 'OK';
export interface Check {
  key: Category; name: string; group: string; connected: boolean; detail: string; points: number; basis: string; level: Lvl;
  severity: Record<Sev, number>; rules: { code: string; name: string; count: number; level: Lvl; criterion: string }[];
}

/** 목록·검색용 가벼운 공법 정보 */
export interface ProductLite {
  product_id: string; product_name: string; line_id: string; node: string; family_code: string; family_name?: string;
  wip_wafers: number; grade?: string;
}

export interface Product extends ProductLite {
  flow_type?: string; audit_reasons?: string; mass_prod_start?: string;
  reasons: string[]; rank_in_family?: number; family_size?: number;
}

export interface TopItem extends ProductLite { rank: number; wip_share: number; reasons: string[]; summary: Summary; steps: number; compat_eqps: number }
export interface TopResult { family_code: string; family_name?: string; node: string; line_id: string; products: number; wip: number; top_wip: number; items: TopItem[] }

export interface Rule { code: string; name: string; category: Category; category_name: string; severity: Sev; weight: number; criterion: string }

export interface Meta {
  as_of: string; window_days: number; recent_days: number; data_source: string;
  lines: Line[]; products: ProductLite[]; rules: Rule[]; categories: Record<Category, string>;
  groups: { key: string; name: string; en: string; desc: string; cats: Category[] }[];
  /** 연결 안 된 점검 항목 → 이유 (규칙 없음 / 원천 테이블 없음) */
  pending?: Partial<Record<Category, string>>; missing_tables?: string[];
}

export interface Target { param: string; unit?: string; target?: number; lsl?: number; usl?: number; lcl?: number; ucl?: number; rev?: number; effective_from?: string; owner?: string }
export interface Spc {
  param?: string; meas_step_id?: string; n?: number; mean?: number; sigma_within?: number; sigma_overall?: number;
  cp?: number; cpk?: number; pp?: number; ppk?: number; ooc_30d?: number; oos_30d?: number; req?: number; meets?: boolean | null;
}
/** 설비별 출력 (TTTM) */
export interface ToolOut { eqp_id: string; n?: number; mean?: number; sigma_within?: number; sigma_overall?: number; ms: number | null; sr: number | null; cp?: number | null; cpk: number | null; pp?: number | null; ppk: number | null; flag: Sev | null }
export interface CapGrade { steps: number; req: number | null; cp: number | null; cpk: number | null; pp: number | null; ppk: number | null; min_cpk: number | null; min_ppk: number | null; below_req: number; below_133: number; below_1: number; ppk_below_133: number }
export interface Compat { eqp_id: string; qualified: boolean; qual_date?: string; eqp_model?: string }

export interface Counts { il_window: number; il_recent: number; il_forced: number; il_active: number; bm_window: number; pm_window: number; changes_window: number }

export interface Step extends Counts {
  product_id: string; seq: number; step_id: string; step_name: string; stage: string; module: string; param?: string; unit?: string;
  step_grade: 'A' | 'B' | 'C'; measured: boolean;
  critical: boolean; recipe_id?: string; meas_step_id?: string; meas_step_name?: string;
  /** 공정흐름 표에서만: process(공정 스텝) · meas(계측 스텝, process_step_id 를 측정) */
  step_type?: 'process' | 'meas'; process_step_id?: string; process_step_name?: string; target: Target | null; spc: Spc | null; tttm: ToolOut[]; compat: Compat[]; models: string[];
  spec_revs: number; risk_score: number; risk_level: Lvl; eqp_level: Lvl; point_ids: string[];
}

export interface Eqp extends Counts {
  eqp_id: string; eqp_model: string; maker?: string; module?: string; status?: string; pm_cycle_days?: number; last_pm_at?: string;
  pm_overdue_days: number; steps: string[]; qualified: boolean; unapproved: number; il_weekly: number[]; risk_score: number; point_ids: string[];

  cap?: { steps: number; min_cpk: number | null; avg_cpk: number | null; max_ms: number | null; max_ms_step: string; max_sr: number | null; max_sr_step: string; flagged: number } | null;
}

export interface Stage extends Counts {
  stage: string; idx: number; first_seq: number; last_seq: number; steps: number; measured: number;
  grades: Partial<Record<'A' | 'B' | 'C', number>>; modules: Record<string, number>; eqps: number; point_ids: string[];
  risk_level: Lvl; risk_score: number; eqp_level: Lvl; step_levels: Partial<Record<Lvl, number>>; eqp_levels: Partial<Record<Lvl, number>>;
}

export interface RiskPoint {
  id: string; rule: string; rule_name: string; category: Category; severity: Sev; kind: 'step' | 'eqp'; steps: string[]; eqp_id?: string | null;
  title: string; evidence: string; refs: string[]; at?: string | null;
}

export interface Interlock {
  interlock_id: string; eqp_id: string; occurred_at: string; il_code: string; category?: string; severity?: string; description?: string;
  released_at?: string | null; release_type?: string; released_by?: string; lot_id?: string; product_id?: string; step_id?: string;
}
export interface Maint {
  mt_id: string; eqp_id: string; mt_type: 'PM' | 'BM'; start_at: string; end_at?: string; reason?: string; parts?: string;
  qual_result?: string; qual_at?: string | null; lots_before_qual?: number; performed_by?: string;
}
export interface Change {
  change_id: string; eqp_id?: string; product_id?: string; step_id?: string; changed_at: string; category: string; item?: string;
  before?: string; after?: string; ecn_no?: string; requested_by?: string; approved_by?: string | null; approved_at?: string | null; verify_status?: string;
}
export interface TargetChange {
  change_id: string; product_id: string; step_id: string; param?: string; rev?: number; changed_at: string;
  target_before?: number; target_after?: number; lsl_before?: number; lsl_after?: number; usl_before?: number; usl_after?: number;
  reason?: string; requested_by?: string; approved_by?: string; ecn_no?: string;
}

export interface Limits { tttm: { ms_med: number; ms_high: number; sr_med: number; sr_high: number }; cpk_req: Record<string, number>; ppk: { med: number; high: number } }
export interface Dossier {
  as_of: string; window_days: number; recent_days: number; limits?: Limits;
  product: Product; line: { line_id: string; line_name: string; tech?: string } | null; summary: Summary;
  stages: Stage[]; steps: Step[]; equipment: Eqp[]; risk_points: RiskPoint[];
  interlocks: Interlock[]; maintenance: Maint[]; changes: Change[]; target_changes: TargetChange[];
}

/** 종합 대시보드 (/api/overview) */
export interface OverviewProduct extends ProductLite {
  risk_index: number; level: Level; points: number; severity: Record<Sev, number>;
  /** 점검 항목별 Risk point 건수 */
  by_category: Record<Category, number>;
  groups: Record<string, number>; steps: number; a_steps: number; compat_eqps: number; top_rules: string[]; reasons: string[];
}
export interface HotPoint {
  product_id: string; product_name: string; line_id: string; wip_wafers: number; id: string; rule: string; rule_name: string;
  category: Category; severity: Sev; title: string; evidence: string; at?: string | null;
}
export interface Overview {
  products: OverviewProduct[]; hot_points: HotPoint[]; hot_total: number;
  rule_freq: { rule: string; name: string; category: Category; count: number; products: number }[];
}

/** 점검 항목 전체 집계 (/api/categories/{cat}) */
export interface CatProduct extends ProductLite {
  risk_index: number; level: Level; points: number; severity: Partial<Record<Sev, number>>; level_cat: Lvl; basis: string;
  rules: Record<string, number>; detail: string; events: number; flagged: number;
}
export interface CatPoint {
  product_id: string; product_name: string; line_id: string; node: string; family_code: string; wip_wafers: number;
  id: string; rule: string; rule_name: string; severity: Sev; kind: 'step' | 'eqp'; steps: string[]; eqp_id?: string | null; title: string; evidence: string; at?: string | null;
}
export type CatEvent = { _key: string; products: string[]; n_products: number; flag: Sev | null } & Record<string, unknown>;
export interface CategorySummary {
  category: Category; name: string; connected: boolean; total: number; products_hit: number; severity: Partial<Record<Sev, number>>;
  group: { key: string; name: string; en: string; cats: Category[] };
  rules: { code: string; name: string; severity: Sev; criterion: string; count: number; products: number }[];
  products: CatProduct[]; points: CatPoint[]; points_total: number; events: CatEvent[]; events_total: number; events_flagged: number; time_col?: string | null;
}
