"""SQL 저장소 템플릿 (사내 DB 직접 조회용).

사용법
  1. pip install sqlalchemy <DB 드라이버>   (예: oracledb, pyodbc, psycopg)
  2. .env 에 DATA_SOURCE=sql, DB_URL=... 설정
  3. 아래 QUERIES 의 SQL 을 사내 테이블·컬럼에 맞게 수정합니다.
     SELECT 결과의 컬럼 별칭(alias)은 app/schemas.py 의 필드명과 같아야 합니다.
     :product_id, :eqp_ids, :since 바인드 변수를 그대로 쓰면 됩니다.

테이블명 MES_*, EES_*, SPC_* 등은 예시입니다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, TypeVar

from pydantic import BaseModel

from ..schemas import (Change, CompatEquipment, Equipment, FlowStep, Interlock, Line, Maintenance, Product,
                       SpcByEqp, SpcSummary, TargetChange, TargetStandard)

T = TypeVar("T", bound=BaseModel)

QUERIES: dict[str, str] = {
    "lines": """
        SELECT line_id, line_name, fab, node, tech FROM MES_LINE_MASTER WHERE use_yn = 'Y'
    """,
    "products": """
        -- 공법(제품) 마스터 + 현재 재공. 라인→노드→공정 드릴다운과 공정별 재공 Top N 에 씁니다.
        SELECT p.product_id, p.product_name, p.line_id, p.node, p.family_code, p.family_name, p.flow_type,
               NVL(w.wip_wafers, 0) AS wip_wafers, p.grade, p.audit_reasons, p.mass_prod_start
          FROM MES_PRODUCT_MASTER p
          LEFT JOIN (SELECT product_id, SUM(wafer_qty) AS wip_wafers FROM MES_WIP_CURRENT GROUP BY product_id) w
            ON w.product_id = p.product_id
         WHERE p.active_yn = 'Y'
    """,
    "search_products": """
        -- 공법 직접 조회: ID·이름·공정 코드 부분 일치
        SELECT p.product_id, p.product_name, p.line_id, p.node, p.family_code, p.family_name, p.flow_type,
               NVL(w.wip_wafers, 0) AS wip_wafers, p.grade, p.audit_reasons, p.mass_prod_start
          FROM MES_PRODUCT_MASTER p
          LEFT JOIN (SELECT product_id, SUM(wafer_qty) AS wip_wafers FROM MES_WIP_CURRENT GROUP BY product_id) w
            ON w.product_id = p.product_id
         WHERE UPPER(p.product_id) LIKE :q OR UPPER(p.product_name) LIKE :q OR UPPER(p.family_code) LIKE :q
         FETCH FIRST :limit ROWS ONLY
    """,
    "process_flow": """
        SELECT product_id, seq, step_id, step_name, stage, module, param, unit, step_grade, critical, recipe_id,
               meas_step_id, meas_step_name
          FROM MES_ROUTE_STEP WHERE product_id = :product_id ORDER BY seq
    """,
    "target_standards": """
        SELECT product_id, step_id, param, unit, target, lsl, usl, lcl, ucl, rev, effective_from, owner
          FROM SPC_TARGET_STD WHERE product_id = :product_id AND latest_yn = 'Y'
    """,
    "target_changes": """
        SELECT change_id, product_id, step_id, param, rev, changed_at,
               target_before, target_after, lsl_before, lsl_after, usl_before, usl_after,
               reason, requested_by, approved_by, ecn_no
          FROM SPC_TARGET_STD_HIST WHERE product_id = :product_id
    """,
    "compat_equipment": """
        SELECT product_id, step_id, eqp_id, qualified, qual_date
          FROM MES_STEP_EQP_COMPAT WHERE product_id = :product_id
    """,
    "equipment": """
        SELECT eqp_id, eqp_model, maker, module, line_id, status, pm_cycle_days, last_pm_at
          FROM EES_EQP_MASTER WHERE eqp_id IN :eqp_ids
    """,
    "interlocks": """
        SELECT interlock_id, eqp_id, occurred_at, il_code, category, severity, description,
               released_at, release_type, released_by, lot_id, product_id, step_id
          FROM EES_INTERLOCK_HIST WHERE eqp_id IN :eqp_ids AND occurred_at >= :since
    """,
    "maintenance": """
        SELECT mt_id, eqp_id, mt_type, start_at, end_at, reason, parts, qual_result, qual_at,
               lots_before_qual, performed_by
          FROM EES_PMBM_HIST WHERE eqp_id IN :eqp_ids AND start_at >= :since
    """,
    "changes": """
        SELECT change_id, eqp_id, product_id, step_id, changed_at, category, item, before_val AS before,
               after_val AS after, ecn_no, requested_by, approved_by, approved_at, verify_status
          FROM EES_CHANGE_HIST
         WHERE (eqp_id IN :eqp_ids OR product_id = :product_id) AND changed_at >= :since
    """,
    "spc_summary": """
        SELECT product_id, step_id, meas_step_id, param, n, mean, sigma_within, sigma_overall, cp, cpk, pp, ppk, ooc_30d, oos_30d
          FROM SPC_STEP_SUMMARY_30D WHERE product_id = :product_id
    """,
    # 설비별 출력(TTTM): 계측값을 그 LOT 이 거친 공정 설비별로 묶은 요약
    "spc_by_eqp": """
        SELECT product_id, step_id, meas_step_id, param, eqp_id, n, mean, sigma_within, sigma_overall
          FROM SPC_STEP_BY_EQP_30D WHERE product_id = :product_id
    """,
}


class SqlRepository:
    def __init__(self, url: str):
        try:
            from sqlalchemy import bindparam, create_engine, text  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("DATA_SOURCE=sql 을 쓰려면 sqlalchemy 와 DB 드라이버를 설치하세요.") from e
        self._text, self._bindparam = text, bindparam
        self.engine = create_engine(url, pool_pre_ping=True)

    def missing_tables(self) -> set[str]:
        """QUERIES 에서 비워 둔(None/"") 테이블 → 그 테이블을 쓰는 점검 항목은 '데이터 연결 예정'"""
        return {k for k, v in QUERIES.items() if not v}

    def _q(self, name: str, model: type[T], **params) -> list[T]:
        if not QUERIES.get(name):
            return []
        stmt = self._text(QUERIES[name])
        if "eqp_ids" in params:
            params["eqp_ids"] = list(params["eqp_ids"]) or ["__none__"]
            stmt = stmt.bindparams(self._bindparam("eqp_ids", expanding=True))
        with self.engine.connect() as cx:
            rows = cx.execute(stmt, params).mappings().all()
        return [model.model_validate({k.lower(): v for k, v in r.items()}) for r in rows]

    def as_of(self) -> datetime:
        return datetime.now().replace(second=0, microsecond=0)

    def lines(self): return self._q("lines", Line)
    def products(self): return self._q("products", Product)
    def search_products(self, q, limit): return self._q("search_products", Product, q=f"%{q.strip().upper()}%", limit=limit)
    def process_flow(self, product_id): return sorted(self._q("process_flow", FlowStep, product_id=product_id), key=lambda r: r.seq)
    def target_standards(self, product_id): return self._q("target_standards", TargetStandard, product_id=product_id)
    def target_changes(self, product_id): return self._q("target_changes", TargetChange, product_id=product_id)
    def compat_equipment(self, product_id): return self._q("compat_equipment", CompatEquipment, product_id=product_id)
    def equipment(self, eqp_ids: Iterable[str]): return self._q("equipment", Equipment, eqp_ids=eqp_ids)
    def interlocks(self, eqp_ids, since): return self._q("interlocks", Interlock, eqp_ids=eqp_ids, since=since)
    def maintenance(self, eqp_ids, since): return self._q("maintenance", Maintenance, eqp_ids=eqp_ids, since=since)
    def changes(self, eqp_ids, product_id, since): return self._q("changes", Change, eqp_ids=eqp_ids, product_id=product_id, since=since)
    def spc_summary(self, product_id): return self._q("spc_summary", SpcSummary, product_id=product_id)
    def spc_by_eqp(self, product_id): return self._q("spc_by_eqp", SpcByEqp, product_id=product_id)
