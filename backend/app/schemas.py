"""데이터 계약 (테이블 스키마).

사내 실데이터는 이 모델의 필드명과 같은 컬럼으로 맞추면 됩니다.
자세한 설명은 docs/DATA_CONTRACT.md 에 있습니다.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict


def _blank_none(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def _dt(v: Any) -> Any:
    v = _blank_none(v)
    if v is None or isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    s = str(v).strip().replace("T", " ").replace("/", "-")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"날짜 형식을 읽을 수 없습니다: {v!r}")


def _yn(v: Any) -> Any:
    v = _blank_none(v)
    if isinstance(v, bool) or v is None:
        return bool(v)
    return str(v).strip().upper() in ("Y", "YES", "TRUE", "1")


DT = Annotated[Optional[datetime], BeforeValidator(_dt)]
YN = Annotated[bool, BeforeValidator(_yn)]
OptStr = Annotated[Optional[str], BeforeValidator(_blank_none)]
OptFloat = Annotated[Optional[float], BeforeValidator(_blank_none)]
OptInt = Annotated[Optional[int], BeforeValidator(_blank_none)]


class Row(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class Line(Row):
    line_id: str
    line_name: str
    fab: OptStr = None
    node: OptStr = None
    tech: OptStr = None


class Product(Row):
    product_id: str
    product_name: str
    line_id: str
    node: str  # 라인 아래 노드 (예: N4)
    family_code: str  # 공정(옵션 계열) 코드 (예: 4F-P)
    family_name: OptStr = None  # 공정 이름 (예: 성능 개선형)
    flow_type: OptStr = None
    wip_wafers: OptInt = 0  # 재공 (Top N 정렬 기준)
    grade: OptStr = None  # Mobile / HPC / Automotive / RF ...
    audit_reasons: OptStr = None  # 감사 메모, ';' 구분 (자동 태그와 함께 표시)
    mass_prod_start: OptStr = None


class FlowStep(Row):
    product_id: str
    seq: int
    step_id: str
    step_name: str
    stage: OptStr = None  # 스테이지(블록): STI, Dummy Gate, BEOL M1 … 없으면 연속된 같은 모듈 구간으로 자동 묶음
    module: str
    param: OptStr = None  # 계측(타겟 관리) 항목이 있으면 표기
    unit: OptStr = None
    step_grade: OptStr = None  # A(핵심) / B(주요·계측) / C(일반). 없으면 critical·계측 여부로 추정
    critical: YN = False
    recipe_id: OptStr = None
    meas_step_id: OptStr = None    # 이 공정 스텝의 결과를 재는 계측 스텝 (없으면 비움)
    meas_step_name: OptStr = None


class TargetStandard(Row):
    product_id: str
    step_id: str
    param: str
    unit: OptStr = None
    target: OptFloat = None
    lsl: OptFloat = None              # 규격한계 S/L
    usl: OptFloat = None
    lcl: OptFloat = None              # 관리한계 C/L (없으면 평균 ± 3σ군내 로 추정)
    ucl: OptFloat = None
    rev: OptInt = None
    effective_from: OptStr = None
    owner: OptStr = None


class TargetChange(Row):
    change_id: str
    product_id: str
    step_id: str
    param: OptStr = None
    rev: OptInt = None
    changed_at: DT = None
    target_before: OptFloat = None
    target_after: OptFloat = None
    lsl_before: OptFloat = None
    lsl_after: OptFloat = None
    usl_before: OptFloat = None
    usl_after: OptFloat = None
    reason: OptStr = None
    requested_by: OptStr = None
    approved_by: OptStr = None
    ecn_no: OptStr = None


class Equipment(Row):
    eqp_id: str
    eqp_model: str
    maker: OptStr = None
    module: OptStr = None
    line_id: OptStr = None
    status: OptStr = None
    pm_cycle_days: OptInt = None
    last_pm_at: DT = None


class CompatEquipment(Row):
    product_id: str
    step_id: str
    eqp_id: str
    qualified: YN = True
    qual_date: OptStr = None


class Interlock(Row):
    interlock_id: str
    eqp_id: str
    occurred_at: DT = None
    il_code: str
    category: OptStr = None
    severity: OptStr = None  # CRIT / MAJOR / MINOR
    description: OptStr = None
    released_at: DT = None
    release_type: OptStr = None  # 정상 조치 / 강제 해제
    released_by: OptStr = None
    lot_id: OptStr = None
    product_id: OptStr = None
    step_id: OptStr = None


class Maintenance(Row):
    mt_id: str
    eqp_id: str
    mt_type: str  # PM / BM
    start_at: DT = None
    end_at: DT = None
    reason: OptStr = None
    parts: OptStr = None
    qual_result: OptStr = None  # PASS / FAIL / PENDING
    qual_at: DT = None
    lots_before_qual: OptInt = 0
    performed_by: OptStr = None


class Change(Row):
    change_id: str
    eqp_id: OptStr = None
    product_id: OptStr = None
    step_id: OptStr = None
    changed_at: DT = None
    category: str
    item: OptStr = None
    before: OptStr = None
    after: OptStr = None
    ecn_no: OptStr = None
    requested_by: OptStr = None
    approved_by: OptStr = None
    approved_at: DT = None
    verify_status: OptStr = None  # 완료 / 진행 / 미실시


class SpcSummary(Row):
    """공정 스텝(계측 결과) 단위 공정능력. Cp·Cpk 는 군내 σ, Pp·Ppk 는 전체 σ 기준.
    cp/cpk/pp/ppk 가 비어 있으면 타겟표준 LSL·USL 과 σ 로 계산합니다 (sigma 만 있는 예전 형식도 그대로 읽음)."""
    product_id: str
    step_id: str
    meas_step_id: OptStr = None
    param: OptStr = None
    n: OptInt = None
    mean: OptFloat = None
    sigma: OptFloat = None            # 예전 형식 (= sigma_within 으로 간주)
    sigma_within: OptFloat = None     # 군내(단기) σ
    sigma_overall: OptFloat = None    # 전체(장기) σ
    cp: OptFloat = None
    cpk: OptFloat = None
    pp: OptFloat = None
    ppk: OptFloat = None
    ooc_30d: OptInt = 0
    oos_30d: OptInt = 0


class SpcByEqp(Row):
    """설비별 출력 (TTTM): 공정 스텝을 진행한 설비별로 묶은 계측 결과"""
    product_id: str
    step_id: str
    meas_step_id: OptStr = None
    param: OptStr = None
    eqp_id: str
    n: OptInt = None
    mean: OptFloat = None
    sigma_within: OptFloat = None
    sigma_overall: OptFloat = None
