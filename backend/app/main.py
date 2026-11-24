"""AUDIT PREVIEW API — Pre-Audit Data & Insights.

개발:  uvicorn app.main:app --reload --port 8000   (backend 폴더에서)
배포:  frontend 를 빌드하면(frontend/dist) 같은 서버가 화면까지 제공합니다.
"""
from __future__ import annotations

import csv
import re
import io
import threading
import time
import zipfile
from functools import lru_cache
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .repository import DataError, get_repository
from .services.catalog import category_summary, hierarchy, light, overview, top_products
from .services.risk import CATEGORIES, GROUPS, build_dossier, missing_of, pending_categories, rules_catalog

try:  # orjson 이 있으면 JSON 직렬화가 수 배 빠름
    import orjson

    def _json(obj: Any) -> bytes:
        return orjson.dumps(obj)
except ImportError:  # pragma: no cover
    import json

    def _json(obj: Any) -> bytes:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


app = FastAPI(title="AUDIT PREVIEW API", version="0.2.0",
              description="라인·공법(제품)별 공정흐름, 타겟표준, 인터락, PM/BM, 변경 이력을 모아 감사 리스크 포인트를 판정합니다.")
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"])


@lru_cache(maxsize=512)
def _dossier_cached(product_id: str, window: int, sig: Any) -> dict[str, Any]:
    return build_dossier(get_repository(), product_id, window, settings.recent_days)


EVENT_CAP = settings.event_cap


@lru_cache(maxsize=512)
def _dossier_bytes(product_id: str, window: int, sig: Any) -> bytes:
    """화면용 응답: 이벤트 이력은 최근 EVENT_CAP 건만 싣고(요약·차트용), 전체는 /records 로 페이지 조회"""
    d = _dossier_cached(product_id, window, sig)
    view = dict(d)
    view["truncated"] = {}
    for k in ("interlocks", "maintenance", "changes"):
        if len(d[k]) > EVENT_CAP:
            view[k] = d[k][:EVENT_CAP]
            view["truncated"][k] = len(d[k])
    return _json(view)


def _sig() -> Any:
    repo = get_repository()
    return repo._signature() if hasattr(repo, "_signature") else None  # CSV 는 파일이 바뀌면 캐시 무효화


def dossier(product_id: str, window: int) -> dict[str, Any]:
    try:
        return _dossier_cached(product_id, window, _sig())
    except KeyError:
        raise HTTPException(404, f"공법(제품) {product_id} 를 찾을 수 없습니다.")
    except DataError as e:
        raise HTTPException(500, str(e))


def _warmup() -> None:
    """서버 시작 직후 백그라운드에서 데이터 적재 + 전 공법 사전 계산 → 첫 화면부터 즉시 응답"""
    t0 = time.time()
    try:
        repo = get_repository()
        sig = _sig()
        prods = repo.products()
        for p in sorted(prods, key=lambda p: -(p.wip_wafers or 0)):
            _dossier_bytes(p.product_id, settings.window_days, sig)
        _overview_bytes(settings.window_days, sig)
        WARM.update(done=True, products=len(prods), seconds=round(time.time() - t0, 2))
    except Exception as e:  # noqa: BLE001
        WARM.update(done=False, error=str(e))


WARM: dict[str, Any] = {"done": False}


@app.on_event("startup")
def _start_warmup() -> None:
    if settings.warmup:
        threading.Thread(target=_warmup, daemon=True).start()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "data_source": settings.data_source, "warmup": WARM}


@app.get("/api/meta")
def meta(window: int = Query(settings.window_days, ge=7, le=365)) -> dict[str, Any]:
    """라인 → 노드 → 공정(옵션 계열) 계층, 공법 목록(가벼운 형태), 판정 규칙."""
    repo = get_repository()
    try:
        tree = hierarchy(repo)
        products = [light(p) for p in repo.products()]
        as_of = repo.as_of()
    except DataError as e:
        raise HTTPException(500, str(e))
    return {
        "as_of": as_of.isoformat(timespec="minutes"),
        "window_days": window,
        "recent_days": settings.recent_days,
        "data_source": settings.data_source,
        "lines": tree,
        "products": products,
        "rules": rules_catalog(),
        "categories": CATEGORIES,
        "pending": pending_categories(repo),
        "missing_tables": sorted(missing_of(repo)),
        "groups": GROUPS,
    }


@app.get("/api/top")
def top(family: str, node: str | None = None, n: int = Query(5, ge=1, le=20),
        window: int = Query(settings.window_days, ge=7, le=365)) -> dict[str, Any]:
    """공정(옵션 계열) 안 재공 상위 n개 공법과 각 공법의 리스크 요약."""
    try:
        return top_products(get_repository(), lambda pid: dossier(pid, window), family, node, n)
    except KeyError:
        raise HTTPException(404, f"공정 {family} 를 찾을 수 없습니다.")
    except DataError as e:
        raise HTTPException(500, str(e))


@lru_cache(maxsize=8)
def _overview_bytes(window: int, sig: Any) -> bytes:
    return _json(overview(get_repository(), lambda pid: _dossier_cached(pid, window, sig)))


@app.get("/api/overview")
def overview_api(window: int = Query(settings.window_days, ge=7, le=365)) -> Response:
    """종합 대시보드: 전 공법 리스크 지수·대분류별 건수, 전사 CRIT/HIGH 포인트, 규칙별 빈도."""
    try:
        body = _overview_bytes(window, _sig())
    except DataError as e:
        raise HTTPException(500, str(e))
    return Response(body, media_type="application/json", headers={"Cache-Control": "private, max-age=60"})


@lru_cache(maxsize=32)
def _category_cached(cat: str, window: int, sig: Any) -> dict[str, Any]:
    return category_summary(get_repository(), lambda pid: _dossier_cached(pid, window, sig), cat, rules_catalog(), cap=10**9)


CAT_VIEW_CAP = settings.event_cap  # 화면에는 최근·위험 순 상위 N건만, 전체는 CSV


def category_data(cat: str, window: int = settings.window_days) -> dict[str, Any]:
    if cat not in CATEGORIES:
        raise HTTPException(404, f"점검 항목 {cat} 이 없습니다. 가능한 값: {', '.join(CATEGORIES)}")
    try:
        return _category_cached(cat, window, _sig())
    except DataError as e:
        raise HTTPException(500, str(e))


@lru_cache(maxsize=32)
def _category_bytes(cat: str, window: int, sig: Any) -> bytes:
    d = dict(_category_cached(cat, window, sig))
    d["points"] = d["points"][:CAT_VIEW_CAP]
    d["events"] = d["events"][:CAT_VIEW_CAP]
    g = next(g for g in GROUPS if cat in g["cats"])
    d.update(name=CATEGORIES[cat], group=dict(key=g["key"], name=g["name"], en=g["en"], cats=g["cats"]))
    return _json(d)


@app.get("/api/categories/{cat}")
def category_api(cat: str, window: int = Query(settings.window_days, ge=7, le=365)) -> Response:
    """점검 항목 하나를 전 공법에 걸쳐 집계: 공법별 Worst/Best·규칙별 건수·Risk point·실제 이력(영향 공법 포함)."""
    category_data(cat, window)  # 404/500 검사
    return Response(_category_bytes(cat, window, _sig()), media_type="application/json", headers={"Cache-Control": "private, max-age=60"})


@app.get("/api/categories/{cat}/export.csv")
def category_export(cat: str, kind: str = Query("points", pattern="^(points|products|events)$"),
                    window: int = Query(settings.window_days, ge=7, le=365)) -> StreamingResponse:
    """점검 항목 전체 CSV (화면 상한과 무관): points=Risk point, products=공법별 집계, events=실제 이력."""
    d = category_data(cat, window)
    if kind == "products":
        rows = [dict({k: v for k, v in r.items() if k not in ("rules", "severity")},
                     **{f"sev_{k}": v for k, v in r["severity"].items()}, **{f"rule_{k}": v for k, v in r["rules"].items()}) for r in d["products"]]
    elif kind == "events":
        rows = [dict({k: v for k, v in e.items() if k not in ("_key", "products")}, products=";".join(e["products"])) for e in d["events"]]
    else:
        rows = d["points"]
    label = {"points": "risk_point", "products": "공법별", "events": "이력"}[kind]
    return StreamingResponse(_csv_stream([_flat(r) for r in rows]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": _disposition(f"category_{cat}_{kind}.csv", f"{CATEGORIES[cat]}_{label}.csv")})


@app.get("/api/products/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
    """공법(제품) 직접 조회: ID·이름·공정 코드 부분 일치. 고른 공법은 dossier 로 바로 뽑습니다."""
    try:
        return [light(p) for p in get_repository().search_products(q, limit)]
    except DataError as e:
        raise HTTPException(500, str(e))


@app.get("/api/products/{product_id}/dossier")
def product_dossier_api(product_id: str, window: int = Query(settings.window_days, ge=7, le=365)) -> Response:
    """공법(제품) 하나의 감사 도시에: 공정흐름·스테이지·타겟표준·호환설비 집계·이력·리스크 포인트·점검 항목."""
    try:
        body = _dossier_bytes(product_id, window, _sig())
    except KeyError:
        raise HTTPException(404, f"공법(제품) {product_id} 를 찾을 수 없습니다.")
    except DataError as e:
        raise HTTPException(500, str(e))
    return Response(body, media_type="application/json", headers={"Cache-Control": "private, max-age=60"})


def product_dossier(product_id: str, window: int = settings.window_days) -> dict[str, Any]:
    return dossier(product_id, window)


RAW_TABLES = ["process_flow", "target_standards", "target_changes", "spc_summary", "compat_equipment", "equipment", "interlocks", "maintenance", "changes"]


@app.get("/api/products/{product_id}/raw.zip")
def raw_zip(product_id: str) -> Response:
    """공법 하나의 원본 테이블 전체 (CSV 9개를 ZIP 으로). 설비 테이블은 그 공법의 호환설비 기준, 기간 제한 없음."""
    repo = get_repository()
    if not hasattr(repo, "raw_rows"):
        raise HTTPException(501, "이 데이터 소스는 원본 ZIP 을 지원하지 않습니다.")
    if product_id not in {p.product_id for p in repo.products()}:
        raise HTTPException(404, f"공법(제품) {product_id} 를 찾을 수 없습니다.")
    eqp_ids = {c.eqp_id for c in repo.compat_equipment(product_id)}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
        for name in RAW_TABLES:
            rows = repo.equipment(eqp_ids) if name == "equipment" else repo.raw_rows(name, product_id, eqp_ids)
            out = io.StringIO()
            model = type(rows[0]) if rows else None
            cols = list(model.model_fields) if model else ["empty"]
            w = csv.writer(out)
            w.writerow(cols)
            for r in rows:
                w.writerow(["" if (v := getattr(r, c)) is None else (v.strftime("%Y-%m-%d %H:%M") if hasattr(v, "strftime") else ("Y" if v is True else "N" if v is False else v)) for c in cols])
            z.writestr(f"{name}.csv", "﻿" + out.getvalue())
    as_of = repo.as_of().strftime("%Y-%m-%d")
    name = f"{product_id}_원본데이터_{as_of}.zip"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": _disposition(f"{product_id}_raw.zip", name)})


EXPORT_ITEMS = {
    "risk": ("risk_points", "리스크포인트"), "flow": ("steps", "공정흐름"), "target": ("steps", "타겟표준_SPC"),
    "spec": ("target_changes", "스펙개정이력"), "eqp": ("equipment", "호환설비"), "il": ("interlocks", "인터락이력"),
    "pmbm": ("maintenance", "PM_BM이력"), "chg": ("changes", "변경이력"),
}
DATE_FIELD = {"risk_points": "at", "target_changes": "changed_at", "interlocks": "occurred_at", "maintenance": "start_at", "changes": "changed_at"}
EQP_KEYS = ("interlocks", "maintenance", "changes", "equipment", "risk_points")


def _flag(item: str, r: dict[str, Any]) -> bool:
    """'리스크 근거만' 필터 기준 (화면과 같음)"""
    if item == "risk":
        return r["severity"] in ("CRIT", "HIGH")
    if item == "flow":
        return r["risk_level"] != "OK" or r["eqp_level"] in ("CRIT", "HIGH")
    if item == "target":
        return bool(r.get("spc") and (r["spc"].get("meets") is False or (r["spc"].get("cpk") is not None and r["spc"]["cpk"] < 1.0) or any(t.get("flag") for t in r.get("tttm") or [])))
    if item == "spec":
        try:
            return (r["usl_after"] - r["lsl_after"]) > (r["usl_before"] - r["lsl_before"]) + 1e-9 or r.get("approved_by") == r.get("requested_by")
        except TypeError:
            return False
    if item == "il":
        return (r.get("release_type") == "강제 해제" and bool(r.get("released_at"))) or not r.get("released_at")
    if item == "pmbm":
        return (r.get("lots_before_qual") or 0) > 0 or r.get("qual_result") in ("FAIL", "PENDING")
    if item == "chg":
        return not r.get("approved_by") or r.get("approved_by") == r.get("requested_by") or r.get("verify_status") != "완료"
    if item == "eqp":
        return r.get("risk_score", 0) > 0
    return False


def _get(r: dict[str, Any], path: str) -> Any:
    v: Any = r
    for k in path.split("."):
        v = v.get(k) if isinstance(v, dict) else None
    return v


def flow_with_meas(d: dict[str, Any]) -> list[dict[str, Any]]:
    """공정흐름 + 계측 스텝 행. 계측 스텝은 측정 대상 공정 스텝 바로 뒤에 놓고 그 공정능력을 함께 보여 줌"""
    out: list[dict[str, Any]] = []
    for s in d["steps"]:
        out.append(dict(s, step_type="process"))
        mid = s.get("meas_step_id")
        if mid:
            m = re.search(r"(\d+)$", mid)
            out.append(dict(
                step_type="meas", seq=int(m.group(1)) if m else s["seq"], step_id=mid, step_name=s.get("meas_step_name") or f"{s.get('param')} 계측",
                stage=s["stage"], module="계측", step_grade=s["step_grade"], param=s.get("param"), unit=s.get("unit"), recipe_id=None,
                process_step_id=s["step_id"], process_step_name=s["step_name"], target=s.get("target"), spc=s.get("spc"), tttm=s.get("tttm") or [],
                compat=[], models=[], measured=True, critical=s.get("critical"), spec_revs=s.get("spec_revs", 0),
                il_window=0, il_recent=0, il_forced=0, il_active=0, bm_window=0, pm_window=0, changes_window=0,
                risk_score=0, risk_level="HIGH" if (s.get("spc") or {}).get("meets") is False else "OK",
                eqp_level="OK", point_ids=[]))
    return out


def _filter_rows(d: dict[str, Any], item: str, stage: str | None = None, step: str | None = None, eqp: str | None = None,
                 model: str | None = None, start: str | None = None, end: str | None = None, q: str | None = None,
                 flag: bool = False, kind: str | None = None) -> list[dict[str, Any]]:
    """상세 페이지·CSV 공통 필터 (서버에서 처리 → 데이터가 커도 브라우저는 한 페이지만 받음)
    kind (공정흐름만): all(기본) · process(공정 스텝) · meas(계측 스텝)"""
    key = EXPORT_ITEMS[item][0]
    rows: list[dict[str, Any]] = flow_with_meas(d) if item == "flow" else d[key]
    if item == "flow" and kind in ("process", "meas"):
        rows = [r for r in rows if r["step_type"] == kind]
    model_of = {e["eqp_id"]: e["eqp_model"] for e in d["equipment"]}
    stage_steps = {s["step_id"] for s in d["steps"] if s["stage"] == stage} if stage else None
    scope_steps = {step} if step else stage_steps
    scope_eqps = {c["eqp_id"] for s in d["steps"] if s["step_id"] in scope_steps for c in s["compat"]} if scope_steps else None
    df = DATE_FIELD.get(key)
    ql = q.strip().lower() if q else ""

    def keep(r: dict[str, Any]) -> bool:
        if scope_steps:
            if key == "steps" and r["step_id"] not in scope_steps and r.get("process_step_id") not in scope_steps:
                return False
            if key == "risk_points" and not scope_steps.intersection(r["steps"]):
                return False
            if key == "target_changes" and r["step_id"] not in scope_steps:
                return False
            if key in ("interlocks", "maintenance", "equipment") and r["eqp_id"] not in scope_eqps:
                return False
            if key == "changes" and r.get("eqp_id") not in scope_eqps and r.get("step_id") not in scope_steps:
                return False
        rid = r.get("eqp_id")
        if (eqp or model) and key == "steps":
            ids = {c["eqp_id"] for c in r["compat"]}
            if (eqp and eqp not in ids) or (model and not any(model_of.get(i) == model for i in ids)):
                return False
        if eqp and key in EQP_KEYS and rid != eqp:
            return False
        if model and key in EQP_KEYS and model_of.get(rid or "") != model:
            return False
        if df and (start or end):
            v = (r.get(df) or "")[:10]
            if not v or (start and v < start) or (end and v > end):
                return False
        if item == "target" and not r.get("measured"):
            return False
        if flag and not _flag(item, r):
            return False
        if ql and ql not in " ".join(str(v) for v in r.values() if not isinstance(v, (dict, list))).lower():
            return False
        return True

    return [r for r in rows if keep(r)]


@app.get("/api/products/{product_id}/records/{item}")
def records(product_id: str, item: str, stage: str | None = None, step: str | None = None, eqp: str | None = None, model: str | None = None,
            start: str | None = None, end: str | None = None, q: str | None = None, flag: bool = False, kind: str | None = None,
            sort: str | None = None, desc: bool = True, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=2000),
            window: int = Query(settings.window_days, ge=7, le=365)) -> Response:
    """상세 페이지 표: 서버에서 필터·검색·정렬·페이지 처리. 수십만 행이어도 한 페이지만 전송."""
    if item not in EXPORT_ITEMS:
        raise HTTPException(404, f"항목 {item} 이 없습니다. 가능한 값: {', '.join(EXPORT_ITEMS)}")
    d = dossier(product_id, window)
    rows = _filter_rows(d, item, stage, step, eqp, model, start, end, q, False, kind)
    flagged = sum(1 for r in rows if _flag(item, r))
    if flag:
        rows = [r for r in rows if _flag(item, r)]
    if sort:
        present = [r for r in rows if _get(r, sort) is not None]
        missing = [r for r in rows if _get(r, sort) is None]
        try:
            present.sort(key=lambda r: _get(r, sort), reverse=desc)
        except TypeError:
            present.sort(key=lambda r: str(_get(r, sort)), reverse=desc)
        rows = present + missing
    return Response(_json({"total": len(rows), "flagged": flagged, "offset": offset, "limit": limit, "rows": rows[offset:offset + limit]}),
                    media_type="application/json")


def _flat(row: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flat(v, f"{key}."))
        elif isinstance(v, list):
            out[key] = ";".join(x["eqp_id"] if isinstance(x, dict) and "eqp_id" in x else str(x) for x in v)
        else:
            out[key] = v
    return out


def _csv_stream(rows: list[dict[str, Any]]):
    """CSV 를 만들면서 바로 흘려보냄 (대용량도 첫 바이트가 즉시 나감)"""
    flat_first = [_flat(r) for r in rows[:200]]
    cols: list[str] = []
    for r in flat_first:
        for k in r:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols or ["empty"], extrasaction="ignore")
    buf.write("﻿")
    w.writeheader()
    for i, r in enumerate(rows):
        w.writerow(flat_first[i] if i < len(flat_first) else _flat(r))
        if buf.tell() > 256_000:
            yield buf.getvalue().encode("utf-8")
            buf.seek(0)
            buf.truncate()
    yield buf.getvalue().encode("utf-8")


def _disposition(ascii_name: str, name: str) -> str:
    return "attachment; filename=\"" + ascii_name + "\"; filename*=UTF-8''" + quote(name)


@app.get("/api/products/{product_id}/export/{item}.csv")
def export_csv(product_id: str, item: str, stage: str | None = None, step: str | None = None, eqp: str | None = None, model: str | None = None,
               start: str | None = None, end: str | None = None, q: str | None = None, flag: bool = False, kind: str | None = None,
               window: int = Query(settings.window_days, ge=7, le=365)) -> StreamingResponse:
    """상세 항목 CSV (전체 컬럼, 화면과 같은 필터 · 스트리밍). stage·step·eqp·model·start·end·q·flag"""
    if item not in EXPORT_ITEMS:
        raise HTTPException(404, f"항목 {item} 이 없습니다. 가능한 값: {', '.join(EXPORT_ITEMS)}")
    d = dossier(product_id, window)
    rows = _filter_rows(d, item, stage, step, eqp, model, start, end, q, flag, kind)
    name = f"{product_id}_{EXPORT_ITEMS[item][1]}_{d['as_of'][:10]}.csv"
    return StreamingResponse(_csv_stream(rows), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": _disposition(f"{product_id}_{item}.csv", name)})


class CachedStatic(StaticFiles):
    """해시가 붙은 빌드 산출물은 1년 캐시 (재방문 시 즉시 로드)"""
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


if settings.frontend_dist.exists():
    app.mount("/assets", CachedStatic(directory=settings.frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = settings.frontend_dist / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(settings.frontend_dist / "index.html")
