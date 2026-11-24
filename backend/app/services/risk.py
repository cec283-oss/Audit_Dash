"""공법(제품) 감사 도시에(dossier)와 리스크 포인트 판정.

공정 데이터(흐름·타겟표준·SPC·스펙 이력)는 공법 기준으로,
설비 데이터(인터락·PM/BM·변경)는 그 공법의 호환설비 기준으로 모읍니다.

라우트가 수천 스텝이어도 읽히도록
  - 리스크 포인트를 '스텝 리스크'(그 스텝 자체의 문제)와 '설비 노출'(호환설비의 문제)로 나누고
  - 스테이지(블록) 단위로 집계하며
  - 단일 설비·모델 혼재처럼 여러 스텝에 반복되는 항목은 설비(모델 조합) 단위로 한 건으로 묶습니다.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..repository.base import Repository

SEV_W = {"CRIT": 12, "HIGH": 6, "MED": 3, "LOW": 1}
SEV_ORDER = ["CRIT", "HIGH", "MED", "LOW"]
# 대분류 → 점검 항목 (화면의 Risk point 카드가 이 순서·묶음으로 나옵니다)
GROUPS = [
    dict(key="process_data", name="공정 데이터", en="PROCESS DATA", desc="타겟표준 · 공정능력(SPC)", cats=["spec", "process"]),
    dict(key="equip_data", name="설비 데이터", en="EQUIPMENT DATA", desc="인터락 · FDC/NPW 이상감지 기준정보 · 설비별 출력 매칭(TTTM) · 호환설비 구성",
         cats=["interlock", "detect", "tttm", "equip"]),
    dict(key="change_point", name="변경점", en="CHANGE POINTS", desc="PM/BM · CTTTM · RACB · 설비·레시피 변경", cats=["maint", "cttm", "racb", "change"]),
]
CATEGORIES = {
    "spec": "타겟표준",
    "process": "공정능력 (SPC)",
    "interlock": "인터락",
    "detect": "FDC/NPW 이상감지 기준정보",
    "tttm": "설비별 출력 매칭 (TTTM)",
    "equip": "호환설비 구성",
    "maint": "PM/BM",
    "cttm": "CTTTM",
    "racb": "RACB",
    "change": "설비·레시피 변경",
}
GROUP_OF = {c: g["key"] for g in GROUPS for c in g["cats"]}
# 점검 항목 → 상세 페이지
CHECK_DETAIL = {"spec": "spec", "process": "target", "interlock": "il", "detect": "chg", "tttm": "target", "equip": "eqp", "maint": "pmbm",
                "cttm": "pmbm", "racb": "chg", "change": "chg"}
# 점검 항목 → 필요한 원천 테이블. 하나라도 없으면 그 항목은 '데이터 연결 예정' 으로 표시 (실데이터에서 테이블이 빠져도 화면은 동작)
CAT_TABLES = {
    "spec": ["target_standards", "target_changes"], "process": ["target_standards", "spc_summary"],
    "interlock": ["equipment", "compat_equipment", "interlocks"], "detect": ["changes"], "tttm": ["target_standards", "spc_summary", "spc_by_eqp"],
    "equip": ["equipment", "compat_equipment"], "maint": ["equipment", "compat_equipment", "maintenance"], "change": ["changes"],
    "cttm": [], "racb": [],
}


def missing_of(repo) -> set[str]:
    return repo.missing_tables() if hasattr(repo, "missing_tables") else set()


def pending_categories(repo) -> dict[str, str]:
    """연결 안 된 점검 항목과 이유 (규칙 없음 / 원천 테이블 없음)"""
    miss = missing_of(repo)
    out = {}
    for cat in CATEGORIES:
        if not any(r.category == cat for r in RULES.values()):
            out[cat] = PENDING_NOTE.get(cat, "판정 규칙 없음")
        elif any(t in miss for t in CAT_TABLES.get(cat, [])):
            out[cat] = "원천 테이블 없음: " + ", ".join(t for t in CAT_TABLES[cat] if t in miss) + " · docs/REAL_DATA_GUIDE.md 참고"
    return out


# 원천 데이터가 아직 연결되지 않은 점검 항목 (규칙이 하나도 없으면 '연결 예정'으로 표시)
PENDING_NOTE = {
    "cttm": "CTTTM 원천 테이블 연결 후 활성화 · docs/EXTENDING.md 2장 참고",
    "racb": "RACB 원천 테이블 연결 후 활성화 · docs/EXTENDING.md 2장 참고",
}


@dataclass(frozen=True)
class Rule:
    code: str
    name: str
    category: str
    severity: str
    criterion: str


RULES: dict[str, Rule] = {r.code: r for r in [
    Rule("SPEC_WIDEN", "스펙 완화", "spec", "HIGH", "타겟표준 개정에서 LSL~USL 폭이 넓어짐. 요청자=승인자이거나 승인이 없으면 CRIT"),
    Rule("LOW_CPK", "공정능력 부족", "process", "HIGH", "Cpk 가 스텝 등급 요구치 미만 (A 1.67 · B 1.33 · C 1.00). 1.0 미만이면 CRIT"),
    Rule("LOW_PPK", "장기 공정능력 저하", "process", "MED", "Cpk 는 요구치 이상인데 Ppk 가 1.33 미만 (장기 드리프트·설비 간 차이). 1.0 미만이면 HIGH"),
    Rule("OOS", "규격 이탈 발생", "process", "HIGH", "최근 30일 규격 이탈(OOS) 발생"),
    Rule("FORCED_RELEASE", "인터락 강제 해제", "interlock", "HIGH", "원인 조치 없이 운영자가 강제로 해제한 인터락. 최근 30일 2회 이상이면 CRIT"),
    Rule("REPEAT_IL", "인터락 반복", "interlock", "HIGH", "같은 설비·같은 코드 인터락이 최근 30일 3회 이상. 5회 이상이면 CRIT"),
    Rule("ACTIVE_IL", "미해제 인터락", "interlock", "MED", "기준 시각 현재 해제되지 않은 인터락"),
    Rule("LOT_BEFORE_QUAL", "Qual 전 LOT 진행", "maint", "CRIT", "PM/BM 후 Qual 완료 전에 LOT 진행 기록이 있음"),
    Rule("QUAL_FAIL", "Qual 불합격·대기", "maint", "HIGH", "PM/BM 후 Qual 결과가 FAIL 이거나 아직 PENDING"),
    Rule("BM_REPEAT", "BM 반복", "maint", "HIGH", "같은 설비 BM 이 최근 30일 2회 이상. 3회 이상이면 CRIT"),
    Rule("PM_OVERDUE", "PM 주기 초과", "maint", "MED", "마지막 PM 후 PM 주기를 넘김. 7일 넘게 초과하면 HIGH"),
    Rule("NO_APPROVAL", "미승인 변경", "change", "CRIT", "변경 이력에 승인자·승인일이 없음"),
    Rule("SELF_APPROVAL", "자기 승인", "change", "HIGH", "변경 요청자와 승인자가 같은 사람"),
    Rule("CRITERIA_CHANGE", "FDC/NPW·인터락 기준 변경", "detect", "MED", "FDC·NPW 이상감지 한계나 인터락 해제 조건을 바꾼 변경. 요청자=승인자이거나 승인이 없으면 HIGH"),
    Rule("UNVERIFIED", "변경 후 검증 미완료", "change", "MED", "변경 후 7일이 지났는데 검증 상태가 완료가 아님"),
    Rule("TTTM_MS", "설비 평균 이동 (M/S)", "tttm", "MED", "설비 출력 평균이 나머지 호환설비 평균에서 군내 σ 의 1.0배 이상 벗어남 (M/S = (설비 평균 − 나머지 평균) / 나머지 σ). 1.5 이상 HIGH, A등급 스텝은 한 단계 상향 · 기준값 TTTM_LIMIT"),
    Rule("TTTM_SR", "설비 산포 과대 (S/R)", "tttm", "MED", "설비 군내 σ 가 나머지 호환설비 군내 σ 의 1.2배 이상 (S/R = 설비 σ / 나머지 σ). 1.5 이상 HIGH, A등급 스텝은 한 단계 상향 · 기준값 TTTM_LIMIT"),
    Rule("SINGLE_TOOL", "단일 호환설비", "equip", "MED", "인증된 호환설비가 1대뿐인 스텝 (설비별로 묶음). A등급 포함 HIGH, B등급 포함 MED, C등급만이면 LOW"),
]}

# 스텝 등급별 공정능력 요구치 (사내 기준으로 바꾸세요)
CPK_REQ = {"A": 1.67, "B": 1.33, "C": 1.00}
# 설비 출력 매칭(TTTM) 기준: |M/S| ≥ ms_med 또는 S/R ≥ sr_med 이면 이상 (ms_high/sr_high 이상은 HIGH). 화면도 이 값을 그대로 씀
TTTM_LIMIT = dict(ms_med=1.0, ms_high=1.5, sr_med=1.2, sr_high=1.5)
PPK_LIMIT = dict(med=1.33, high=1.0)  # Cpk 충족인데 Ppk 가 med 미만이면 장기 공정능력 저하, high 미만이면 HIGH


def _cap(sp, t) -> dict[str, Any] | None:
    """공정능력 한 묶음: 빈 값은 LSL·USL·σ 로 계산"""
    if sp is None:
        return None
    d = _dump(sp)
    sw = sp.sigma_within or sp.sigma
    so = sp.sigma_overall or sw
    lsl, usl = (t.lsl, t.usl) if t else (None, None)
    mu = sp.mean

    def idx(sig, two_sided: bool):
        if not sig or mu is None or lsl is None or usl is None or usl <= lsl:
            return None
        return round((usl - lsl) / (6 * sig), 2) if two_sided else round(min(usl - mu, mu - lsl) / (3 * sig), 2)
    d.update(sigma_within=sw, sigma_overall=so,
             cp=sp.cp if sp.cp is not None else idx(sw, True), cpk=sp.cpk if sp.cpk is not None else idx(sw, False),
             pp=sp.pp if sp.pp is not None else idx(so, True), ppk=sp.ppk if sp.ppk is not None else idx(so, False))
    d.pop("sigma", None)
    return d


AUTOMOTIVE_ESCALATE = {"change", "spec"}  # 차량용은 변경관리·스펙 사항을 한 단계 올림 (고객 PCN 의무)


def _up(sev: str) -> str:
    return SEV_ORDER[max(0, SEV_ORDER.index(sev) - 1)]


def _max_sev(sevs) -> str:
    sevs = [s for s in sevs if s]
    return min(sevs, key=SEV_ORDER.index) if sevs else "OK"


def level_of(index: int) -> str:
    if index >= 75:
        return "위험"
    if index >= 55:
        return "경고"
    if index >= 35:
        return "주의"
    return "양호"


def _iso(d: datetime | None) -> str | None:
    return d.isoformat(timespec="minutes") if d else None


def _dump(m) -> dict[str, Any]:
    d = m.model_dump()
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = _iso(v)
    return d


def _eqp_cap(eid: str, tttm: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    """설비별 공정능력·매칭 요약 (그 설비가 진행한 계측 스텝 기준)"""
    rows = [(sid, x) for sid, xs in tttm.items() for x in xs if x["eqp_id"] == eid]
    if not rows:
        return None
    cpks = [x["cpk"] for _, x in rows if x["cpk"] is not None]
    w_ms = max(rows, key=lambda r: abs(r[1]["ms"] or 0))
    w_sr = max(rows, key=lambda r: r[1]["sr"] or 0)
    return dict(steps=len(rows), min_cpk=min(cpks) if cpks else None, avg_cpk=round(sum(cpks) / len(cpks), 2) if cpks else None,
                max_ms=w_ms[1]["ms"], max_ms_step=w_ms[0], max_sr=w_sr[1]["sr"], max_sr_step=w_sr[0],
                flagged=sum(1 for _, x in rows if x["flag"]))


def _grade_cap(cs: list[dict[str, Any]], req: float | None) -> dict[str, Any]:
    """등급(또는 전체) 공정능력 요약"""
    def avg(k):
        v = [c[k] for c in cs if c.get(k) is not None]
        return round(sum(v) / len(v), 2) if v else None

    def mn(k):
        v = [c[k] for c in cs if c.get(k) is not None]
        return min(v) if v else None
    return dict(steps=len(cs), req=req, cp=avg("cp"), cpk=avg("cpk"), pp=avg("pp"), ppk=avg("ppk"), min_cpk=mn("cpk"), min_ppk=mn("ppk"),
                below_req=sum(1 for c in cs if c.get("cpk") is not None and c["cpk"] < (req if req is not None else c.get("req", 1.33))),
                below_133=sum(1 for c in cs if (c.get("cpk") or 9) < 1.33), below_1=sum(1 for c in cs if (c.get("cpk") or 9) < 1.0),
                ppk_below_133=sum(1 for c in cs if (c.get("ppk") or 9) < 1.33))


def build_dossier(repo: Repository, product_id: str, window_days: int = 90, recent_days: int = 30) -> dict[str, Any]:
    products = {p.product_id: p for p in repo.products()}
    if product_id not in products:
        raise KeyError(product_id)
    prod = products[product_id]
    line = next((l for l in repo.lines() if l.line_id == prod.line_id), None)
    as_of = repo.as_of()
    since = as_of - timedelta(days=window_days)
    recent = as_of - timedelta(days=recent_days)
    automotive = (prod.grade or "").lower().startswith("auto")

    flow = repo.process_flow(product_id)
    targets = {t.step_id: t for t in repo.target_standards(product_id)}
    tchanges = sorted(repo.target_changes(product_id), key=lambda c: c.changed_at or datetime.min, reverse=True)
    spc = {s.step_id: s for s in repo.spc_summary(product_id)}
    spc_eqp: dict[str, list] = defaultdict(list)
    for x in (repo.spc_by_eqp(product_id) if hasattr(repo, "spc_by_eqp") else []):
        spc_eqp[x.step_id].append(x)
    compat = repo.compat_equipment(product_id)
    eqp_ids = sorted({c.eqp_id for c in compat})
    eqps = {e.eqp_id: e for e in repo.equipment(eqp_ids)}
    ils = sorted(repo.interlocks(eqp_ids, since), key=lambda r: r.occurred_at, reverse=True)
    mts = sorted(repo.maintenance(eqp_ids, since), key=lambda r: r.start_at, reverse=True)
    chs = sorted(repo.changes(eqp_ids, product_id, since), key=lambda r: r.changed_at, reverse=True)

    # ── 스텝 기본: 스테이지·등급 보정 ──
    seq_of = {s.step_id: s.seq for s in flow}
    stage_of: dict[str, str] = {}
    prev_mod, n_auto = None, 0
    for s in flow:
        if s.stage:
            stage_of[s.step_id] = s.stage
        else:  # 스테이지 컬럼이 없으면 연속된 같은 모듈 구간을 한 블록으로
            if s.module != prev_mod:
                n_auto += 1
            stage_of[s.step_id] = f"{n_auto:02d} {s.module}"
        prev_mod = s.module
    grade_of = {s.step_id: (s.step_grade or ("A" if s.critical else "B" if s.step_id in targets else "C")).upper() for s in flow}
    step_name = {s.step_id: s.step_name for s in flow}

    def ordered(ids) -> list[str]:
        return sorted(set(i for i in ids if i in seq_of), key=seq_of.get)

    step_of_eqp: dict[str, list[str]] = defaultdict(list)
    compat_by_step: dict[str, list] = defaultdict(list)
    for c in compat:
        compat_by_step[c.step_id].append(c)
        if c.qualified:
            step_of_eqp[c.eqp_id].append(c.step_id)

    points: list[dict[str, Any]] = []

    def add(code: str, steps, title: str, evidence: str, refs=None, eqp: str | None = None, sev: str | None = None,
            at: datetime | None = None, kind: str = "eqp") -> None:
        r = RULES[code]
        s = sev or r.severity
        escalated = False
        if automotive and r.category in AUTOMOTIVE_ESCALATE and s != "CRIT":
            s, escalated = _up(s), True
        points.append(dict(id="", rule=code, rule_name=r.name, category=r.category, severity=s, kind=kind,
                           steps=ordered(steps), eqp_id=eqp, title=title,
                           evidence=evidence + (" · 차량용 제품이라 한 단계 상향" if escalated else ""),
                           refs=refs or [], at=_iso(at)))

    # ── 타겟표준 (스텝) ──
    for c in tchanges:
        if None in (c.lsl_before, c.lsl_after, c.usl_before, c.usl_after):
            continue
        wb, wa = c.usl_before - c.lsl_before, c.usl_after - c.lsl_after
        if wa > wb + 1e-9:
            self_ok = c.requested_by and c.requested_by == c.approved_by
            add("SPEC_WIDEN", [c.step_id], f"{step_name.get(c.step_id, c.step_id)} {c.param} 규격 폭 {wb:g} → {wa:g} 확대",
                f"Rev.{c.rev} · LSL {c.lsl_before:g}→{c.lsl_after:g}, USL {c.usl_before:g}→{c.usl_after:g} · 사유: {c.reason or '-'} · "
                f"요청 {c.requested_by or '-'} / 승인 {c.approved_by or '없음'}" + (" (자기 승인)" if self_ok else ""),
                [c.change_id], sev="CRIT" if (self_ok or not c.approved_by) else None, at=c.changed_at, kind="step")

    # ── 공정능력 (스텝): 등급별 요구치 · Cp/Cpk(단기) · Pp/Ppk(장기) ──
    cap: dict[str, dict[str, Any]] = {}
    for s in flow:
        c = _cap(spc.get(s.step_id), targets.get(s.step_id))
        if c is None:
            continue
        g = grade_of[s.step_id]
        req = CPK_REQ.get(g, 1.33)
        c.update(req=req, meets=None if c["cpk"] is None else c["cpk"] >= req)
        cap[s.step_id] = c
        cpk, ppk = c["cpk"], c["ppk"]
        if cpk is None:
            continue
        ev = (f"{g}등급 요구 Cpk {req:.2f} · Cp {c['cp']} / Cpk {cpk} · Pp {c['pp']} / Ppk {ppk} · n={c['n']} · "
              f"평균 {c['mean']} · σ군내 {c['sigma_within']} / σ전체 {c['sigma_overall']} · OOC {c['ooc_30d']}건 (30일)")
        if cpk < req:
            add("LOW_CPK", [s.step_id], f"{s.step_name} {c['param']} Cpk {cpk:.2f} (요구 {req:.2f})", ev, [],
                sev="CRIT" if cpk < 1.0 else None, kind="step")
        elif ppk is not None and ppk < PPK_LIMIT["med"]:
            add("LOW_PPK", [s.step_id], f"{s.step_name} {c['param']} Ppk {ppk:.2f} (Cpk {cpk:.2f})", ev, [],
                sev="HIGH" if ppk < PPK_LIMIT["high"] else None, kind="step")
        if (c["oos_30d"] or 0) > 0:
            add("OOS", [s.step_id], f"{s.step_name} {c['param']} 규격 이탈 {c['oos_30d']}건 (30일)", f"Cpk {cpk:.2f} · Ppk {ppk}", [], kind="step")

    # ── 설비별 출력 매칭 (TTTM): M/S = (설비 평균 − 나머지 설비 평균) / 나머지 σ군내, S/R = 설비 σ / 나머지 σ ──
    tttm: dict[str, list[dict[str, Any]]] = {}
    tttm_hits: dict[str, list[tuple[str, str, str, float, float]]] = defaultdict(list)  # eqp -> [(step, rule, sev, ms, sr)]
    for s in flow:
        rows, c = spc_eqp.get(s.step_id), cap.get(s.step_id)
        if not rows or not c:
            continue
        mu, sw = c["mean"], c["sigma_within"]
        t = targets.get(s.step_id)
        out = []
        for x in sorted(rows, key=lambda x: x.eqp_id):
            # 기준 = 나머지 설비 (leave-one-out). 설비가 1대뿐이면 비교 대상이 없어 M/S·S/R 은 비움
            others = [o for o in rows if o.eqp_id != x.eqp_id and o.n and o.mean is not None and o.sigma_within]
            ms = sr = None
            if others and x.mean is not None and x.sigma_within:
                n_o = sum(o.n for o in others)
                mu_o = sum(o.n * o.mean for o in others) / n_o
                sw_o = (sum(o.n * o.sigma_within ** 2 for o in others) / n_o) ** 0.5
                ms, sr = round((x.mean - mu_o) / sw_o, 2), round(x.sigma_within / sw_o, 2)
            cpk_e = None
            if t and t.lsl is not None and t.usl is not None and x.sigma_within and x.mean is not None:
                cpk_e = round(min(t.usl - x.mean, x.mean - t.lsl) / (3 * x.sigma_within), 2)
            ppk_e = None
            if t and t.lsl is not None and t.usl is not None and x.sigma_overall and x.mean is not None:
                ppk_e = round(min(t.usl - x.mean, x.mean - t.lsl) / (3 * x.sigma_overall), 2)
            flag = None
            a_up = grade_of[s.step_id] == "A"
            L = TTTM_LIMIT
            if ms is not None and abs(ms) >= L["ms_med"]:
                sev = "HIGH" if abs(ms) >= L["ms_high"] else "MED"
                sev = _up(sev) if a_up else sev
                tttm_hits[x.eqp_id].append((s.step_id, "TTTM_MS", sev, ms, sr or 0))
                flag = sev
            if sr is not None and sr >= L["sr_med"]:
                sev = "HIGH" if sr >= L["sr_high"] else "MED"
                sev = _up(sev) if a_up else sev
                tttm_hits[x.eqp_id].append((s.step_id, "TTTM_SR", sev, ms or 0, sr))
                flag = _max_sev([flag, sev]) if flag else sev
            cp_e = pp_e = None
            if t and t.lsl is not None and t.usl is not None and t.usl > t.lsl:
                cp_e = round((t.usl - t.lsl) / (6 * x.sigma_within), 2) if x.sigma_within else None
                pp_e = round((t.usl - t.lsl) / (6 * x.sigma_overall), 2) if x.sigma_overall else None
            out.append(dict(eqp_id=x.eqp_id, n=x.n, mean=x.mean, sigma_within=x.sigma_within, sigma_overall=x.sigma_overall,
                            ms=ms, sr=sr, cp=cp_e, cpk=cpk_e, pp=pp_e, ppk=ppk_e, flag=flag))
        tttm[s.step_id] = out
    for eid, hits in tttm_hits.items():
        for rule in ("TTTM_MS", "TTTM_SR"):
            hs = [h for h in hits if h[1] == rule]
            if not hs:
                continue
            sev = _max_sev(h[2] for h in hs)
            worst = max(hs, key=lambda h: abs(h[3]) if rule == "TTTM_MS" else h[4])
            label = "평균 이동 M/S" if rule == "TTTM_MS" else "산포 과대 S/R"
            val = f"M/S {worst[3]:+.2f}" if rule == "TTTM_MS" else f"S/R {worst[4]:.2f}"
            add(rule, [h[0] for h in hs], f"{eid} {label} 스텝 {len(hs)}개 · 최대 {val}",
                f"{step_name.get(worst[0], worst[0])} 등 · " + ", ".join(f"{step_name.get(h[0], h[0])} M/S {h[3]:+.2f} S/R {h[4]:.2f}" for h in hs[:4])
                + (f" 외 {len(hs) - 4}" if len(hs) > 4 else ""), [], eqp=eid, sev=sev, kind="eqp")

    # ── 변경 이력 ──
    for c in chs:
        on_step = bool(c.step_id and c.step_id in seq_of)
        steps = [c.step_id] if on_step else step_of_eqp.get(c.eqp_id or "", [])
        kind = "step" if on_step else "eqp"
        what = f"{c.eqp_id or ''} {c.category} · {c.item or ''} {c.before or ''} → {c.after or ''}".strip()
        weak = not c.approved_by or c.approved_by == c.requested_by
        if not c.approved_by:
            add("NO_APPROVAL", steps, f"{c.eqp_id} {c.item or c.category} 승인 없이 변경", f"{what} · ECN {c.ecn_no or '없음'} · 요청 {c.requested_by or '-'}",
                [c.change_id], eqp=c.eqp_id, at=c.changed_at, kind=kind)
        elif c.requested_by and c.requested_by == c.approved_by:
            add("SELF_APPROVAL", steps, f"{c.eqp_id} {c.item or c.category} 요청자가 직접 승인", f"{what} · 요청·승인 {c.approved_by}",
                [c.change_id], eqp=c.eqp_id, at=c.changed_at, kind=kind)
        if c.category in ("FDC 한계 변경", "인터락 조건 변경"):
            add("CRITERIA_CHANGE", steps, f"{c.eqp_id} {c.item} 기준 변경", what, [c.change_id], eqp=c.eqp_id, at=c.changed_at,
                sev="HIGH" if weak else None, kind=kind)
        if c.verify_status != "완료" and c.changed_at and (as_of - c.changed_at).days > 7:
            add("UNVERIFIED", steps, f"{c.eqp_id} {c.item or c.category} 변경 후 {(as_of - c.changed_at).days}일째 검증 {c.verify_status or '미기록'}",
                what, [c.change_id], eqp=c.eqp_id, at=c.changed_at, kind=kind)

    # ── 인터락 (설비) ──
    il_recent = [i for i in ils if i.occurred_at >= recent]
    forced = defaultdict(list)
    for i in il_recent:
        if i.release_type == "강제 해제" and i.released_at:
            forced[i.eqp_id].append(i)
    for e, lst in forced.items():
        add("FORCED_RELEASE", step_of_eqp[e], f"{e} 인터락 강제 해제 {len(lst)}회 (30일)",
            " · ".join(f"{x.occurred_at:%m-%d} {x.il_code} ({x.released_by})" for x in lst[:4]),
            [x.interlock_id for x in lst], eqp=e, sev="CRIT" if len(lst) >= 2 else None, at=lst[0].occurred_at)
    rep = defaultdict(list)
    for i in il_recent:
        rep[(i.eqp_id, i.il_code)].append(i)
    for (e, code), lst in rep.items():
        if len(lst) >= 3:
            add("REPEAT_IL", step_of_eqp[e], f"{e} {code} 인터락 {len(lst)}회 반복 (30일)",
                f"{lst[0].description or code} · 최근 {lst[0].occurred_at:%m-%d %H:%M}, 최초 {lst[-1].occurred_at:%m-%d %H:%M}",
                [x.interlock_id for x in lst], eqp=e, sev="CRIT" if len(lst) >= 5 else None, at=lst[0].occurred_at)
    for i in ils:
        if not i.released_at:
            add("ACTIVE_IL", step_of_eqp[i.eqp_id], f"{i.eqp_id} {i.il_code} 인터락 미해제",
                f"{i.occurred_at:%m-%d %H:%M} 발생 · {i.description or ''} · 심각도 {i.severity}", [i.interlock_id], eqp=i.eqp_id, at=i.occurred_at)

    # ── PM/BM (설비) ──
    for m in mts:
        if (m.lots_before_qual or 0) > 0:
            add("LOT_BEFORE_QUAL", step_of_eqp[m.eqp_id], f"{m.eqp_id} {m.mt_type} 후 Qual 전 LOT {m.lots_before_qual}개 진행",
                f"{m.start_at:%m-%d} {m.reason or ''} · 교체 {m.parts or '-'} · Qual {m.qual_result or '-'}", [m.mt_id], eqp=m.eqp_id, at=m.start_at)
        if m.qual_result in ("FAIL", "PENDING"):
            add("QUAL_FAIL", step_of_eqp[m.eqp_id], f"{m.eqp_id} {m.mt_type} 후 Qual {m.qual_result}",
                f"{m.start_at:%m-%d} {m.reason or ''} · 교체 {m.parts or '-'}", [m.mt_id], eqp=m.eqp_id, at=m.start_at)
    bm_recent = defaultdict(list)
    for m in mts:
        if m.mt_type == "BM" and m.start_at >= recent:
            bm_recent[m.eqp_id].append(m)
    for e, lst in bm_recent.items():
        if len(lst) >= 2:
            add("BM_REPEAT", step_of_eqp[e], f"{e} BM {len(lst)}회 (30일)",
                " · ".join(f"{x.start_at:%m-%d} {x.reason}" for x in lst[:4]), [x.mt_id for x in lst], eqp=e,
                sev="CRIT" if len(lst) >= 3 else None, at=lst[0].start_at)
    pm_over: dict[str, float] = {}
    for e in eqps.values():
        if e.last_pm_at and e.pm_cycle_days:
            over = (as_of - e.last_pm_at).total_seconds() / 86400 - e.pm_cycle_days
            if over > 0:
                pm_over[e.eqp_id] = over
                add("PM_OVERDUE", step_of_eqp[e.eqp_id], f"{e.eqp_id} PM 주기 {over:.0f}일 초과",
                    f"주기 {e.pm_cycle_days}일 · 마지막 PM {e.last_pm_at:%Y-%m-%d} · 이 설비를 쓰는 스텝 {len(set(step_of_eqp[e.eqp_id]))}개",
                    [], eqp=e.eqp_id, sev="HIGH" if over > 7 else None)

    # ── 설비 구성 (스텝, 설비·모델 조합별로 묶음) ──
    single: dict[str, list[str]] = defaultdict(list)
    mix: dict[tuple, list[str]] = defaultdict(list)
    for s in flow:
        q = [c for c in compat_by_step[s.step_id] if c.qualified]
        if len(q) == 1:
            single[q[0].eqp_id].append(s.step_id)
        models = tuple(sorted({eqps[c.eqp_id].eqp_model for c in q if c.eqp_id in eqps}))
        if len(models) > 1:
            mix[models].append(s.step_id)
    for e, sts in single.items():
        a = [x for x in sts if grade_of[x] == "A"]
        add("SINGLE_TOOL", sts, f"{e} 단일 인증 설비 스텝 {len(sts)}개" + (f" (A등급 {len(a)})" if a else ""),
            "대체 설비 없음 · " + ", ".join(step_name[x] for x in ordered(sts)[:4]) + (f" 외 {len(sts) - 4}개" if len(sts) > 4 else ""),
            [], eqp=e, sev="HIGH" if a else ("MED" if any(grade_of[x] == "B" for x in sts) else "LOW"), kind="step")
    # 모델 혼재(mix)는 흔한 구성이라 리스크로 세지 않고 매트릭스·스텝 정보로만 보여 줍니다

    points.sort(key=lambda p: (SEV_ORDER.index(p["severity"]), p["at"] is None, -(datetime.fromisoformat(p["at"]).timestamp() if p["at"] else 0)))
    for i, p in enumerate(points):
        p["id"] = f"RP-{i + 1:03d}"

    # ── 설비별 건수 (한 번만 계산) ──
    cnt: dict[str, Counter] = defaultdict(Counter)
    for i in ils:
        c = cnt[i.eqp_id]
        c["il_window"] += 1
        c["il_recent"] += i.occurred_at >= recent
        c["il_forced"] += bool(i.release_type == "강제 해제" and i.released_at)
        c["il_active"] += not i.released_at
    for m in mts:
        cnt[m.eqp_id]["bm_window" if m.mt_type == "BM" else "pm_window"] += 1
    for c in chs:
        if c.eqp_id:
            cnt[c.eqp_id]["changes_window"] += 1
    KEYS = ["il_window", "il_recent", "il_forced", "il_active", "bm_window", "pm_window", "changes_window"]
    eqp_sev: dict[str, str] = {}
    eqp_pts: dict[str, list[str]] = defaultdict(list)
    for p in points:
        if p["eqp_id"]:
            eqp_pts[p["eqp_id"]].append(p["id"])
            if p["kind"] == "eqp":
                eqp_sev[p["eqp_id"]] = _max_sev([eqp_sev.get(p["eqp_id"]), p["severity"]])

    step_pts: dict[str, list[dict]] = defaultdict(list)
    for p in points:
        for s in p["steps"]:
            step_pts[s].append(p)

    steps_out = []
    for s in flow:
        cs = compat_by_step[s.step_id]
        ids = [c.eqp_id for c in cs]
        own = [p for p in step_pts[s.step_id] if p["kind"] == "step"]
        t = targets.get(s.step_id)
        lvl = _max_sev(p["severity"] for p in own)
        base = _dump(s)
        base.update(stage=stage_of[s.step_id], step_grade=grade_of[s.step_id])
        steps_out.append(dict(
            **base, measured=t is not None,
            target=_dump(t) if t else None, spc=cap.get(s.step_id), tttm=tttm.get(s.step_id, []),
            compat=[dict(eqp_id=c.eqp_id, qualified=c.qualified, qual_date=c.qual_date,
                         eqp_model=eqps[c.eqp_id].eqp_model if c.eqp_id in eqps else None) for c in cs],
            models=sorted({eqps[c.eqp_id].eqp_model for c in cs if c.eqp_id in eqps}),
            spec_revs=sum(1 for c in tchanges if c.step_id == s.step_id),
            **{k: sum(cnt[e][k] for e in ids) for k in KEYS},
            risk_score=sum(SEV_W[p["severity"]] for p in own),
            risk_level="OK" if lvl == "OK" else lvl,
            eqp_level=_max_sev(eqp_sev.get(c.eqp_id) for c in cs if c.qualified),
            point_ids=[p["id"] for p in step_pts[s.step_id]],
        ))

    # ── 스테이지 집계 ──
    stages: list[dict[str, Any]] = []
    by_stage: dict[str, dict] = {}
    for so in steps_out:
        st = by_stage.get(so["stage"])
        if st is None:
            st = dict(stage=so["stage"], idx=len(stages), first_seq=so["seq"], last_seq=so["seq"], steps=0, measured=0,
                      grades=Counter(), modules=Counter(), _eqps=set(), _pts=set(), step_levels=Counter(), eqp_levels=Counter())
            by_stage[so["stage"]] = st
            stages.append(st)
        st["last_seq"] = so["seq"]
        st["steps"] += 1
        st["measured"] += so["measured"]
        st["grades"][so["step_grade"]] += 1
        st["modules"][so["module"]] += 1
        st["_eqps"].update(c["eqp_id"] for c in so["compat"])
        st["_pts"].update(so["point_ids"])
        st["step_levels"][so["risk_level"]] += 1
        st["eqp_levels"][so["eqp_level"]] += 1
    pts_by_id = {p["id"]: p for p in points}
    for st in stages:
        own = [pts_by_id[i] for i in st["_pts"] if pts_by_id[i]["kind"] == "step"]
        st.update(
            grades=dict(st["grades"]), modules=dict(st["modules"].most_common()), step_levels=dict(st["step_levels"]), eqp_levels=dict(st["eqp_levels"]),
            eqps=len(st["_eqps"]), point_ids=sorted(st.pop("_pts")),
            risk_level=_max_sev(p["severity"] for p in own), risk_score=sum(SEV_W[p["severity"]] for p in own),
            eqp_level=_max_sev(eqp_sev.get(e) for e in st.pop("_eqps")),
            **{k: 0 for k in KEYS},
        )
    for st in stages:
        es = {c["eqp_id"] for so in steps_out if so["stage"] == st["stage"] for c in so["compat"]}
        for k in KEYS:
            st[k] = sum(cnt[e][k] for e in es)

    weeks = math.ceil(window_days / 7)
    eq_out = []
    for eid in eqp_ids:
        e = eqps.get(eid)
        wk = [0] * weeks
        for i in ils:
            if i.eqp_id == eid:
                k = min(weeks - 1, int((as_of - i.occurred_at).days // 7))
                wk[weeks - 1 - k] += 1
        pts = [pts_by_id[x] for x in eqp_pts[eid]]
        eq_out.append(dict(
            eqp_id=eid, eqp_model=e.eqp_model if e else "(미등록)", maker=e.maker if e else None, module=e.module if e else None,
            status=e.status if e else None, pm_cycle_days=e.pm_cycle_days if e else None, last_pm_at=_iso(e.last_pm_at) if e else None,
            pm_overdue_days=round(pm_over.get(eid, 0), 1),
            steps=ordered(step_of_eqp[eid]),
            qualified=bool(step_of_eqp[eid]),
            cap=_eqp_cap(eid, tttm),
            **{k: cnt[eid][k] for k in KEYS},
            unapproved=sum(1 for c in chs if c.eqp_id == eid and (not c.approved_by or c.approved_by == c.requested_by)),
            il_weekly=wk,
            risk_score=sum(SEV_W[p["severity"]] for p in pts),
            point_ids=[p["id"] for p in pts],
        ))

    # ── 점검 항목 (Risk point 카드) ──
    measured = [s for s in steps_out if s["measured"]]
    basis = {
        "spec": f"타겟 관리 스텝 {len(measured)}개 · 개정 이력 {len(tchanges)}건",
        "process": f"계측 스텝 {len(cap)}개 · 등급 요구치 미달 {sum(1 for c in cap.values() if c['meets'] is False)}개 · Ppk<1.33 {sum(1 for c in cap.values() if (c['ppk'] or 9) < 1.33)}개",
        "tttm": f"설비별 출력 {sum(len(v) for v in tttm.values())}건 (스텝×설비) · M/S·S/R 초과 {sum(1 for v in tttm.values() for x in v if x['flag'])}건",
        "interlock": f"호환설비 {len(eqp_ids)}대 · 최근 {window_days}일 인터락 {len(ils)}건",
        "maint": f"PM {sum(1 for m in mts if m.mt_type == 'PM')}건 · BM {sum(1 for m in mts if m.mt_type == 'BM')}건",
        "change": f"최근 {window_days}일 변경 {len(chs)}건",
        "detect": f"FDC·NPW·인터락 기준 변경 {sum(1 for c in chs if c.category in ('FDC 한계 변경', '인터락 조건 변경'))}건",
        "equip": f"호환설비 {len(eqp_ids)}대 · 모델 {len({e.eqp_model for e in eqps.values()})}종",
    }
    pending = pending_categories(repo)
    checks = []
    for cat, cname in CATEGORIES.items():
        cps = [p for p in points if p["category"] == cat]
        connected = cat not in pending
        checks.append(dict(
            key=cat, name=cname, group=GROUP_OF[cat], connected=connected, detail=CHECK_DETAIL[cat], points=len(cps),
            basis=pending.get(cat) or basis.get(cat, ""),
            severity={k: sum(1 for p in cps if p["severity"] == k) for k in SEV_ORDER},
            level=_max_sev(p["severity"] for p in cps),
            rules=[dict(code=r.code, name=r.name, count=sum(1 for p in cps if p["rule"] == r.code),
                        level=_max_sev(p["severity"] for p in cps if p["rule"] == r.code), criterion=r.criterion)
                   for r in RULES.values() if r.category == cat],
        ))

    total = sum(SEV_W[p["severity"]] for p in points)
    index = round(100 * (1 - math.exp(-total / 190)))
    sev_count = Counter(p["severity"] for p in points)
    grades = Counter(grade_of.values())

    return dict(
        as_of=_iso(as_of), window_days=window_days, recent_days=recent_days,
        limits=dict(tttm=TTTM_LIMIT, cpk_req=CPK_REQ, ppk=PPK_LIMIT),
        product=dict(**_dump(prod), **_context(prod, products, as_of, window_days, tchanges, points)),
        line=_dump(line) if line else None,
        summary=dict(
            risk_index=index, level=level_of(index), raw_score=total,
            severity={k: sev_count.get(k, 0) for k in SEV_ORDER},
            by_category={k: sum(SEV_W[p["severity"]] for p in points if p["category"] == k) for k in CATEGORIES},
            checks=checks,
            groups=[dict(key=g["key"], name=g["name"], en=g["en"], desc=g["desc"], cats=g["cats"],
                         points=sum(c["points"] for c in checks if c["group"] == g["key"]),
                         level=_max_sev(p["severity"] for p in points if GROUP_OF[p["category"]] == g["key"])) for g in GROUPS],
            kpis=dict(
                steps=len(flow), critical_steps=grades.get("A", 0),
                grades={g: grades.get(g, 0) for g in ("A", "B", "C")},
                measured_steps=len(measured), stages=len(stages), recipes=len({s.recipe_id for s in flow if s.recipe_id}),
                compat_eqps=len(eqp_ids), models=len({e.eqp_model for e in eqps.values()}),
                il_recent=sum(1 for i in ils if i.occurred_at >= recent), il_forced=sum(1 for i in ils if i.release_type == "강제 해제" and i.released_at),
                il_active=sum(1 for i in ils if not i.released_at),
                bm_recent=sum(1 for m in mts if m.mt_type == "BM" and m.start_at >= recent),
                pm_overdue=len(pm_over),
                changes_window=len(chs),
                unapproved=sum(1 for c in chs if not c.approved_by or c.approved_by == c.requested_by),
                spec_widen=sum(1 for p in points if p["rule"] == "SPEC_WIDEN"),
                low_cpk=sum(1 for c in cap.values() if c["cpk"] is not None and c["cpk"] < 1.33),
                cap_by_grade={g: _grade_cap([c for sid, c in cap.items() if grade_of[sid] == g], CPK_REQ[g]) for g in ("A", "B", "C")},
                cap_all=_grade_cap(list(cap.values()), None),
                tttm_flagged=sum(1 for v in tttm.values() for x in v if x["flag"]),
            ),
            top_rules=[r for r, _ in Counter(p["rule"] for p in points if p["severity"] in ("CRIT", "HIGH")).most_common(3)],
        ),
        stages=stages,
        steps=steps_out,
        equipment=eq_out,
        risk_points=points,
        interlocks=[_dump(i) for i in ils],
        maintenance=[_dump(m) for m in mts],
        changes=[_dump(c) for c in chs],
        target_changes=[_dump(c) for c in tchanges],
    )


def _context(prod, products: dict, as_of: datetime, window_days: int, tchanges: list, points: list[dict]) -> dict[str, Any]:
    """공정 안 재공 순위와 자동 태그(감사 선정 사유)."""
    fam = sorted((p for p in products.values() if p.family_code == prod.family_code and p.node == prod.node),
                 key=lambda p: -(p.wip_wafers or 0))
    rank = next((i + 1 for i, p in enumerate(fam) if p.product_id == prod.product_id), None)
    tags: list[str] = []
    if rank:
        tags.append(f"{prod.family_code} 재공 {rank}위")
    if (prod.grade or "").lower().startswith("auto"):
        tags.append("차량용 AEC-Q100")
    if prod.mass_prod_start:
        try:
            if (as_of - datetime.fromisoformat(prod.mass_prod_start)).days < 365:
                tags.append("신규 양산 1년 미만")
        except ValueError:
            pass
    recent_rev = sum(1 for c in tchanges if c.changed_at and (as_of - c.changed_at).days <= window_days)
    if recent_rev:
        tags.append(f"최근 {window_days}일 스펙 개정 {recent_rev}건")
    single = sum(len(p["steps"]) for p in points if p["rule"] == "SINGLE_TOOL")
    if single:
        tags.append(f"단일 호환설비 스텝 {single}개")
    tags += [r for r in (prod.audit_reasons or "").split(";") if r]
    return dict(rank_in_family=rank, family_size=len(fam), reasons=tags)


def rules_catalog() -> list[dict[str, Any]]:
    return [dict(code=r.code, name=r.name, category=r.category, category_name=CATEGORIES[r.category], severity=r.severity,
                 weight=SEV_W[r.severity], criterion=r.criterion) for r in RULES.values()]
