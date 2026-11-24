"""라인 → 노드 → 공정(옵션 계열) → 공법(제품) 계층과 공정별 재공 Top N."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable

from ..repository.base import Repository


def light(p) -> dict[str, Any]:
    return dict(product_id=p.product_id, product_name=p.product_name, line_id=p.line_id, node=p.node,
                family_code=p.family_code, family_name=p.family_name, wip_wafers=p.wip_wafers or 0, grade=p.grade)


def hierarchy(repo: Repository) -> list[dict[str, Any]]:
    """라인마다 노드, 노드마다 공정(옵션 계열)과 공법 수·재공 합계."""
    prods = repo.products()
    tree: dict[str, dict[str, dict[str, list]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for p in prods:
        tree[p.line_id][p.node][p.family_code].append(p)
    out = []
    for l in repo.lines():
        nodes = []
        for node, fams in sorted(tree[l.line_id].items()):
            fl = []
            for code, ps in sorted(fams.items()):
                ps.sort(key=lambda p: -(p.wip_wafers or 0))
                fl.append(dict(family_code=code, family_name=ps[0].family_name, products=len(ps),
                               wip=sum(p.wip_wafers or 0 for p in ps), top=[p.product_id for p in ps[:5]]))
            nodes.append(dict(node=node, families=fl, products=sum(f["products"] for f in fl), wip=sum(f["wip"] for f in fl)))
        out.append(dict(**l.model_dump(), nodes=nodes, products=sum(n["products"] for n in nodes), wip=sum(n["wip"] for n in nodes)))
    return out


def top_products(repo: Repository, summarize: Callable[[str], dict[str, Any]], family_code: str,
                 node: str | None = None, n: int = 5) -> dict[str, Any]:
    """공정 안 재공 상위 n개 공법과 각 공법의 리스크 요약."""
    ps = [p for p in repo.products() if p.family_code == family_code and (not node or p.node == node)]
    if not ps:
        raise KeyError(family_code)
    ps.sort(key=lambda p: -(p.wip_wafers or 0))
    total = sum(p.wip_wafers or 0 for p in ps)
    items = []
    for i, p in enumerate(ps[:n]):
        d = summarize(p.product_id)
        items.append(dict(**light(p), rank=i + 1, wip_share=round((p.wip_wafers or 0) / total, 4) if total else 0,
                          reasons=d["product"]["reasons"], summary=d["summary"],
                          steps=len(d["steps"]), compat_eqps=len(d["equipment"])))
    return dict(family_code=family_code, family_name=ps[0].family_name, node=ps[0].node, line_id=ps[0].line_id,
                products=len(ps), wip=total, top_wip=sum(x["wip_wafers"] for x in items), items=items)


SEV_RANK = {"CRIT": 0, "HIGH": 1, "MED": 2, "LOW": 3}


def overview(repo: Repository, summarize: Callable[[str], dict[str, Any]], top_points: int = 15) -> dict[str, Any]:
    """종합 대시보드: 전 공법 리스크 요약 + 라인/공정별 집계 + 전사 고위험 포인트."""
    rows, hot = [], []
    for p in repo.products():
        d = summarize(p.product_id)
        s = d["summary"]
        k = s["kpis"]
        rows.append(dict(
            **light(p), risk_index=s["risk_index"], level=s["level"], points=len(d["risk_points"]),
            severity=s["severity"], by_category={c["key"]: c["points"] for c in s["checks"]},
            groups={g["key"]: g["points"] for g in s["groups"]},
            steps=k["steps"], a_steps=k["grades"].get("A", 0), compat_eqps=k["compat_eqps"],
            top_rules=s.get("top_rules", [])[:3], reasons=d["product"]["reasons"],
        ))
        for rp in d["risk_points"]:
            if rp["severity"] in ("CRIT", "HIGH"):
                hot.append(dict(product_id=p.product_id, product_name=p.product_name, line_id=p.line_id, wip_wafers=p.wip_wafers or 0,
                                id=rp["id"], rule=rp["rule"], rule_name=rp["rule_name"], category=rp["category"],
                                severity=rp["severity"], title=rp["title"], evidence=rp["evidence"], at=rp.get("at")))
    rows.sort(key=lambda r: (-r["risk_index"], -r["wip_wafers"]))
    hot.sort(key=lambda h: (SEV_RANK[h["severity"]], -h["wip_wafers"], h.get("at") or ""))
    rule_freq: dict[str, dict[str, Any]] = {}
    for h in hot:
        e = rule_freq.setdefault(h["rule"], dict(rule=h["rule"], name=h["rule_name"], category=h["category"], count=0, products=set()))
        e["count"] += 1
        e["products"].add(h["product_id"])
    rf = sorted(({**e, "products": len(e["products"])} for e in rule_freq.values()), key=lambda e: -e["count"])
    return dict(products=rows, hot_points=hot[:top_points], hot_total=len(hot), rule_freq=rf)


# 점검 항목 → 실제 이력 원천 (dossier 키, ID 컬럼, 시각 컬럼). 실데이터에서 항목을 늘리면 여기에 한 줄 추가
EVENT_SOURCE: dict[str, tuple[str, str, str]] = {
    "spec": ("target_changes", "change_id", "changed_at"),
    "interlock": ("interlocks", "interlock_id", "occurred_at"),
    "detect": ("changes", "change_id", "changed_at"),
    "maint": ("maintenance", "mt_id", "start_at"),
    "change": ("changes", "change_id", "changed_at"),
}
DETECT_CHANGE = ("FDC 한계 변경", "인터락 조건 변경", "NPW 기준 변경")


def _events(cat: str, d: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """공법 dossier 에서 점검 항목의 실제 이력 행을 (키, 행) 으로."""
    pid = d["product"]["product_id"]
    if cat in EVENT_SOURCE:
        src, idk, _ = EVENT_SOURCE[cat]
        rows = d[src]
        if cat == "detect":
            rows = [r for r in rows if r.get("category") in DETECT_CHANGE]
        return [(r[idk], r) for r in rows]
    if cat == "process":  # 계측 스텝 SPC 요약 (공법×스텝 단위)
        out = []
        for s in d["steps"]:
            if s.get("spc"):
                t = s.get("target") or {}
                out.append((f"{pid}|{s['step_id']}", dict(
                    product_id=pid, step_id=s["step_id"], step_name=s["step_name"], stage=s["stage"], step_grade=s["step_grade"],
                    param=s["spc"].get("param"), unit=t.get("unit"), target=t.get("target"), lsl=t.get("lsl"), usl=t.get("usl"),
                    meas_step_id=s.get("meas_step_id"), n=s["spc"].get("n"), mean=s["spc"].get("mean"),
                    sigma_within=s["spc"].get("sigma_within"), sigma_overall=s["spc"].get("sigma_overall"),
                    cp=s["spc"].get("cp"), cpk=s["spc"].get("cpk"), pp=s["spc"].get("pp"), ppk=s["spc"].get("ppk"), req=s["spc"].get("req"),
                    ooc_30d=s["spc"].get("ooc_30d"), oos_30d=s["spc"].get("oos_30d"))))
        return out
    if cat == "tttm":  # 설비별 출력 (공법×스텝×설비)
        return [(f"{pid}|{s['step_id']}|{x['eqp_id']}", dict(product_id=pid, step_id=s["step_id"], step_name=s["step_name"], step_grade=s["step_grade"],
                 param=(s.get("spc") or {}).get("param"), eqp_id=x["eqp_id"], n=x["n"], mean=x["mean"], sigma_within=x["sigma_within"],
                 ms=x["ms"], sr=x["sr"], cp=x.get("cp"), cpk=x["cpk"], pp=x.get("pp"), ppk=x["ppk"], flag_tttm=x["flag"]))
                for s in d["steps"] for x in (s.get("tttm") or [])]
    if cat == "equip":  # 호환설비 구성 (설비 단위)
        return [(e["eqp_id"], {k: e.get(k) for k in ("eqp_id", "eqp_model", "maker", "module", "status", "qualified", "pm_cycle_days",
                                                    "last_pm_at", "pm_overdue_days", "il_window", "bm_window", "pm_window", "unapproved")}
                 | {"steps": len(e.get("steps") or [])}) for e in d["equipment"]]
    return []


def category_summary(repo: Repository, summarize: Callable[[str], dict[str, Any]], cat: str,
                     rules: list[dict[str, Any]], cap: int = 3000) -> dict[str, Any]:
    """점검 항목 하나(예: 인터락)를 전 공법에 걸쳐 집계: 공법별 Worst/Best, 규칙별 건수, Risk point, 실제 이력."""
    rows, pts = [], []
    connected = True
    ev: dict[str, dict[str, Any]] = {}
    for p in repo.products():
        d = summarize(p.product_id)
        ck = next(c for c in d["summary"]["checks"] if c["key"] == cat)
        connected = ck["connected"]
        cps = [rp for rp in d["risk_points"] if rp["category"] == cat]
        hot_refs: dict[str, str] = {}
        for rp in cps:
            keys = list(rp.get("refs") or [])
            if cat == "process":
                keys += [f"{p.product_id}|{st}" for st in rp.get("steps") or []]
            elif cat == "equip" and rp.get("eqp_id"):
                keys.append(rp["eqp_id"])
            elif cat == "tttm" and rp.get("eqp_id"):
                keys += [f"{p.product_id}|{st}|{rp['eqp_id']}" for st in rp.get("steps") or []]
            for ref in keys:
                if SEV_RANK[rp["severity"]] < SEV_RANK.get(hot_refs.get(ref, "LOW"), 9) or ref not in hot_refs:
                    hot_refs[ref] = rp["severity"]
            pts.append(dict(product_id=p.product_id, product_name=p.product_name, line_id=p.line_id, node=p.node,
                            family_code=p.family_code, wip_wafers=p.wip_wafers or 0,
                            **{k: rp.get(k) for k in ("id", "rule", "rule_name", "severity", "kind", "steps", "eqp_id", "title", "evidence", "at")}))
        evs = _events(cat, d)
        for key, r in evs:
            e = ev.get(key)
            if e is None:
                e = ev[key] = dict(_key=key, **r, products=[], flag=None)
            e["products"].append(p.product_id)
            sv = hot_refs.get(key)
            if sv and (e["flag"] is None or SEV_RANK[sv] < SEV_RANK[e["flag"]]):
                e["flag"] = sv
        rows.append(dict(**light(p), risk_index=d["summary"]["risk_index"], level=d["summary"]["level"],
                         points=ck["points"], severity=ck["severity"], level_cat=ck["level"], basis=ck["basis"],
                         rules={r["code"]: r["count"] for r in ck["rules"]}, detail=ck["detail"], events=len(evs),
                         flagged=sum(1 for k, _ in evs if k in hot_refs)))
    rows.sort(key=lambda r: (-r["points"], -sum(r["severity"].get(s, 0) * w for s, w in (("CRIT", 8), ("HIGH", 4), ("MED", 2), ("LOW", 1))), -r["risk_index"]))
    pts.sort(key=lambda h: (SEV_RANK[h["severity"]], -(h["wip_wafers"]), h.get("at") or ""))
    tcol = EVENT_SOURCE.get(cat, (None, None, None))[2]
    events = list(ev.values())
    for e in events:
        e["n_products"] = len(e["products"])
    if tcol:
        events.sort(key=lambda e: e.get(tcol) or "", reverse=True)
        events.sort(key=lambda e: e["flag"] is None)
    elif cat == "process":
        events.sort(key=lambda e: (e["flag"] is None, e.get("cpk") if e.get("cpk") is not None else 99))
    else:
        events.sort(key=lambda e: (e["flag"] is None, -(e.get("il_window") or 0) - (e.get("bm_window") or 0)))
    rs = [r for r in rules if r["category"] == cat]
    rule_stats = [dict(code=r["code"], name=r["name"], severity=r["severity"], criterion=r["criterion"],
                       count=sum(x["rules"].get(r["code"], 0) for x in rows),
                       products=sum(1 for x in rows if x["rules"].get(r["code"], 0))) for r in rs]
    sev: dict[str, int] = defaultdict(int)
    for h in pts:
        sev[h["severity"]] += 1
    return dict(category=cat, connected=bool(rs) and connected, total=len(pts), products_hit=sum(1 for r in rows if r["points"]),
                severity=dict(sev), rules=rule_stats, products=rows, points=pts[:cap], points_total=len(pts),
                events=events[:cap], events_total=len(events), events_flagged=sum(1 for e in events if e["flag"]), time_col=tcol)
