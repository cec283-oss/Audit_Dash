"""CSV 저장소: DATA_DIR 안의 CSV 12개를 읽습니다.

파일이 바뀌면(수정 시각 변경) 다음 요청에서 다시 읽습니다.
사내 DB에서 같은 컬럼으로 추출한 CSV를 덮어쓰면 바로 반영됩니다.
"""
from __future__ import annotations

import csv
import json
import pickle
import threading
from datetime import datetime
from pathlib import Path
from typing import Iterable, TypeVar

from pydantic import BaseModel

from ..schemas import (Change, CompatEquipment, Equipment, FlowStep, Interlock, Line, Maintenance, Product,
                       SpcByEqp, SpcSummary, TargetChange, TargetStandard)

T = TypeVar("T", bound=BaseModel)
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
CACHE_VERSION = 3

TABLES: dict[str, type[BaseModel]] = {
    "lines": Line,
    "products": Product,
    "process_flow": FlowStep,
    "target_standards": TargetStandard,
    "target_changes": TargetChange,
    "equipment": Equipment,
    "compat_equipment": CompatEquipment,
    "interlocks": Interlock,
    "maintenance": Maintenance,
    "changes": Change,
    "spc_summary": SpcSummary,
    "spc_by_eqp": SpcByEqp,
}
# 반드시 있어야 하는 테이블. 나머지는 파일이 없으면 빈 테이블로 보고, 그 테이블을 쓰는 점검 항목은 "데이터 연결 예정" 으로 표시
REQUIRED = {"lines", "products", "process_flow"}
OPTIONAL = set(TABLES) - REQUIRED


class DataError(RuntimeError):
    pass


def _converters(model: type[BaseModel]) -> dict:
    """필드별 변환 함수 (수만 행을 pydantic 검증 없이 빠르게 읽기 위함)"""
    from ..schemas import _blank_none, _dt, _yn
    out = {}
    for name, f in model.model_fields.items():
        ann = str(f.annotation)
        req = f.is_required()
        if "datetime" in ann:
            fn = _dt
        elif "bool" in ann:
            fn = _yn
        elif "int" in ann:
            fn = lambda v: None if _blank_none(v) is None else int(float(v))  # noqa: E731
        elif "float" in ann:
            fn = lambda v: None if _blank_none(v) is None else float(v)  # noqa: E731
        else:
            fn = (lambda v: v.strip()) if req else (lambda v: None if _blank_none(v) is None else v.strip())  # noqa: E731
        out[name] = (fn, req, f.default)
    return out


def _fast(model, conv: dict, rec: dict):
    vals = {}
    for name, (fn, req, default) in conv.items():
        raw = rec.get(name)
        if raw is None:
            if req:
                raise ValueError(name)
            vals[name] = default
            continue
        v = fn(raw)
        if req and v in (None, ""):
            raise ValueError(name)
        vals[name] = default if v is None and default is not None else v
    return model.model_construct(**vals)


class CsvRepository:
    def __init__(self, data_dir: Path):
        self.dir = Path(data_dir)
        self._lock = threading.Lock()
        self._sig: tuple | None = None
        self._t: dict[str, list] = {}
        self._as_of: datetime | None = None
        self._idx: dict = {}

    # ───── loading ─────
    def _signature(self) -> tuple:
        out = []
        for name in TABLES:
            p = self.dir / f"{name}.csv"
            out.append(p.stat().st_mtime_ns if p.exists() else 0)
        meta = self.dir / "meta.json"
        out.append(meta.stat().st_mtime_ns if meta.exists() else 0)
        return tuple(out)

    def _ensure(self) -> None:
        sig = self._signature()
        if sig == self._sig:
            return
        with self._lock:
            if sig == self._sig:
                return
            cached = self._load_cache(sig)
            if cached is not None:
                self._t, self._as_of, self._sig, self._idx = cached[0], cached[1], sig, {}
                return
            tables: dict[str, list] = {}
            for name, model in TABLES.items():
                p = self.dir / f"{name}.csv"
                if not p.exists() and name in OPTIONAL:
                    tables[name] = []
                    continue
                if not p.exists():
                    raise DataError(f"{p} 파일이 없습니다. docs/DATA_CONTRACT.md 의 파일 목록을 확인하세요.")
                conv = _converters(model)
                with open(p, newline="", encoding="utf-8-sig") as f:
                    rows = []
                    for i, rec in enumerate(csv.DictReader(f), start=2):
                        try:
                            rows.append(_fast(model, conv, rec))
                        except Exception:  # 빠른 변환이 실패한 행은 정식 검증으로 원인을 알려 줌
                            try:
                                rows.append(model.model_validate(rec))
                            except Exception as e:  # noqa: BLE001
                                raise DataError(f"{p.name} {i}행을 읽지 못했습니다: {e}") from e
                tables[name] = rows
            meta = self.dir / "meta.json"
            as_of = None
            if meta.exists():
                as_of = json.loads(meta.read_text(encoding="utf-8")).get("as_of")
            self._as_of = datetime.fromisoformat(as_of) if as_of else None
            self._t = tables
            self._sig = sig
            self._save_cache(sig)

    # ───── 파싱 결과 캐시: CSV 가 그대로면 재시작해도 즉시 로드 ─────
    def _cache_path(self) -> Path:
        import hashlib
        key = hashlib.sha1(str(self.dir.resolve()).encode()).hexdigest()[:12]
        return CACHE_DIR / f"csv-{key}.pkl"

    def _load_cache(self, sig: tuple):
        try:
            with open(self._cache_path(), "rb") as f:
                data = pickle.load(f)
            return (data["tables"], data["as_of"]) if data.get("sig") == sig and data.get("v") == CACHE_VERSION else None
        except Exception:  # noqa: BLE001 — 캐시는 없어도 됨
            return None

    def _save_cache(self, sig: tuple) -> None:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = self._cache_path().with_suffix(".tmp")
            with open(tmp, "wb") as f:
                pickle.dump({"v": CACHE_VERSION, "sig": sig, "tables": self._t, "as_of": self._as_of}, f, protocol=pickle.HIGHEST_PROTOCOL)
            tmp.replace(self._cache_path())
        except Exception:  # noqa: BLE001
            pass

    def raw_rows(self, name: str, product_id: str | None = None, eqp_ids=None) -> list:
        """원본 테이블 행 (원본 ZIP 다운로드용)"""
        if name in ("process_flow", "target_standards", "target_changes", "compat_equipment", "spc_summary", "spc_by_eqp"):
            return list(self._by_product(name, product_id))
        ids = set(eqp_ids or [])
        return [r for r in self._all(name) if r.eqp_id in ids or (name == "changes" and r.product_id == product_id)]

    def _all(self, name: str) -> list:
        self._ensure()
        return self._t[name]

    def _by_product(self, name: str, product_id: str) -> list:
        """공법별 인덱스 (스텝 수천 × 공법 수십 규모에서도 빠르게)"""
        self._ensure()
        key = (name, self._sig)
        idx = self._idx.get(key)
        if idx is None:
            idx = {}
            for r in self._t[name]:
                idx.setdefault(r.product_id, []).append(r)
            self._idx = {k: v for k, v in self._idx.items() if k[1] == self._sig}
            self._idx[key] = idx
        return idx.get(product_id, [])

    # ───── Repository ─────
    def as_of(self) -> datetime:
        self._ensure()
        return self._as_of or datetime.now().replace(second=0, microsecond=0)

    def lines(self) -> list[Line]:
        return list(self._all("lines"))

    def products(self) -> list[Product]:
        return list(self._all("products"))

    def search_products(self, q: str, limit: int) -> list[Product]:
        ql = q.strip().lower()
        hits = [p for p in self._all("products")
                if ql in p.product_id.lower() or ql in p.product_name.lower() or ql in p.family_code.lower()]
        hits.sort(key=lambda p: (not p.product_id.lower().startswith(ql), not p.product_name.lower().startswith(ql), -(p.wip_wafers or 0)))
        return hits[:limit]

    def process_flow(self, product_id: str) -> list[FlowStep]:
        return sorted(self._by_product("process_flow", product_id), key=lambda r: r.seq)

    def target_standards(self, product_id: str) -> list[TargetStandard]:
        return list(self._by_product("target_standards", product_id))

    def target_changes(self, product_id: str) -> list[TargetChange]:
        return list(self._by_product("target_changes", product_id))

    def compat_equipment(self, product_id: str) -> list[CompatEquipment]:
        return list(self._by_product("compat_equipment", product_id))

    def equipment(self, eqp_ids: Iterable[str]) -> list[Equipment]:
        ids = set(eqp_ids)
        return [r for r in self._all("equipment") if r.eqp_id in ids]

    def interlocks(self, eqp_ids: Iterable[str], since: datetime) -> list[Interlock]:
        ids = set(eqp_ids)
        return [r for r in self._all("interlocks") if r.eqp_id in ids and r.occurred_at and r.occurred_at >= since]

    def maintenance(self, eqp_ids: Iterable[str], since: datetime) -> list[Maintenance]:
        ids = set(eqp_ids)
        return [r for r in self._all("maintenance") if r.eqp_id in ids and r.start_at and r.start_at >= since]

    def changes(self, eqp_ids: Iterable[str], product_id: str, since: datetime) -> list[Change]:
        ids = set(eqp_ids)
        return [r for r in self._all("changes")
                if (r.eqp_id in ids or r.product_id == product_id) and r.changed_at and r.changed_at >= since]

    def spc_summary(self, product_id: str) -> list[SpcSummary]:
        return list(self._by_product("spc_summary", product_id))

    def missing_tables(self) -> set[str]:
        """DATA_DIR 에 파일이 없는 (선택) 테이블"""
        return {n for n in OPTIONAL if not (self.dir / f"{n}.csv").exists()}

    def spc_by_eqp(self, product_id: str) -> list[SpcByEqp]:
        return list(self._by_product("spc_by_eqp", product_id))
