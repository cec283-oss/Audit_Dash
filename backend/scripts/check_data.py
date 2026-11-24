"""실데이터 CSV 점검: 파일·컬럼·형식·참조 무결성을 확인하고 화면에 어떤 영향이 있는지 알려 줍니다.

사용:  python scripts/check_data.py [CSV 폴더]      (기본: .env 의 DATA_DIR 또는 data/sample)
종료 코드: 0 = 사용 가능 (경고만), 1 = 필수 오류 있음
"""
from __future__ import annotations

import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.repository.csv_repo import REQUIRED, TABLES, _converters, _fast  # noqa: E402
from app.services.risk import CAT_TABLES, CATEGORIES  # noqa: E402


LEGACY = {"sigma"}  # 예전 형식 호환용 컬럼 (없어도 경고 안 함)


def main() -> int:
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else settings.data_dir
    print(f"■ 점검 폴더: {d.resolve()}\n")
    errors, warns = 0, 0
    data: dict[str, list] = {}
    for name, model in TABLES.items():
        p = d / f"{name}.csv"
        fields = model.model_fields
        req = [k for k, f in fields.items() if f.is_required()]
        if not p.exists():
            if name in REQUIRED:
                print(f"✕ {name}.csv 없음 — 필수 테이블입니다.")
                errors += 1
            else:
                cats = [CATEGORIES[c] for c, ts in CAT_TABLES.items() if name in ts]
                print(f"△ {name}.csv 없음 — 선택. 화면에서 '데이터 연결 예정' 이 되는 항목: {', '.join(cats) or '-'}")
                warns += 1
            continue
        with open(p, newline="", encoding="utf-8-sig") as f:
            rd = csv.DictReader(f)
            cols = rd.fieldnames or []
            rows = list(rd)
        miss_req = [c for c in req if c not in cols]
        miss_opt = [c for c in fields if c not in cols and c not in req and c not in LEGACY]
        extra = [c for c in cols if c not in fields]
        conv = _converters(model)
        bad = Counter()
        parsed = []
        for i, r in enumerate(rows, start=2):
            try:
                parsed.append(_fast(model, conv, r))
            except Exception as e:  # noqa: BLE001
                bad[str(e)[:60]] += 1
                if sum(bad.values()) <= 3:
                    print(f"   {name}.csv {i}행 읽기 실패: {e}")
        data[name] = parsed
        mark = "✕" if miss_req or bad else ("△" if miss_opt or extra else "✓")
        print(f"{mark} {name}.csv  {len(rows):,}행")
        if miss_req:
            print(f"   ✕ 필수 컬럼 없음: {', '.join(miss_req)}")
            errors += 1
        if bad:
            print(f"   ✕ 읽기 실패 {sum(bad.values()):,}행 (형식·빈 필수값). 상위: {dict(bad.most_common(3))}")
            errors += 1
        if miss_opt:
            print(f"   △ 선택 컬럼 없음 (빈 값으로 처리): {', '.join(miss_opt)}")
            warns += 1
        if extra:
            print(f"   ・ 모르는 컬럼 (무시됨): {', '.join(extra)}")

    # ── 참조 무결성 ──
    print("\n■ 참조 무결성")
    pids = {p.product_id for p in data.get("products", [])}
    lines = {l.line_id for l in data.get("lines", [])}
    eqps = {e.eqp_id for e in data.get("equipment", [])}
    steps = {(s.product_id, s.step_id) for s in data.get("process_flow", [])}

    def chk(label: str, bad: int, total: int, level: str = "△") -> None:
        nonlocal warns, errors
        if bad:
            print(f"{level} {label}: {bad:,} / {total:,}")
            if level == "✕":
                errors += 1
            else:
                warns += 1
        else:
            print(f"✓ {label}")

    pr = data.get("products", [])
    chk("products.line_id 가 lines 에 있음", sum(1 for p in pr if p.line_id not in lines), len(pr), "✕")
    fl = data.get("process_flow", [])
    chk("process_flow.product_id 가 products 에 있음", sum(1 for s in fl if s.product_id not in pids), len(fl))
    chk("공법마다 공정흐름이 있음", len(pids - {s.product_id for s in fl}), len(pids))
    for name in ("target_standards", "target_changes", "compat_equipment", "spc_summary", "spc_by_eqp"):
        rs = data.get(name, [])
        if rs:
            chk(f"{name} 의 (공법, 스텝) 이 공정흐름에 있음", sum(1 for r in rs if (r.product_id, r.step_id) not in steps), len(rs))
    for name in ("compat_equipment", "interlocks", "maintenance", "spc_by_eqp"):
        rs = data.get(name, [])
        if rs and eqps:
            chk(f"{name}.eqp_id 가 equipment 에 있음", sum(1 for r in rs if r.eqp_id not in eqps), len(rs))
    ch = data.get("changes", [])
    if ch:
        chk("changes 에 changed_at 있음", sum(1 for c in ch if not c.changed_at), len(ch))

    # ── 화면 영향 요약 ──
    print("\n■ 화면 영향")
    stg = sum(1 for s in fl if not s.stage)
    if stg:
        print(f"・ stage 가 빈 스텝 {stg:,}개 → 같은 모듈이 이어지는 구간으로 자동 묶음")
    grd = sum(1 for s in fl if not s.step_grade)
    if grd:
        print(f"・ step_grade 가 빈 스텝 {grd:,}개 → critical=Y 는 A, 타겟표준 있으면 B, 나머지 C 로 추정")
    ts = data.get("target_standards", [])
    if ts and not any(t.lcl is not None for t in ts):
        print("・ 관리한계(lcl/ucl) 없음 → 시뮬레이터가 평균 ± 3σ군내 로 추정")
    sp = data.get("spc_summary", [])
    if sp and not any(s.sigma_overall for s in sp):
        print("・ sigma_overall 없음 → Pp·Ppk 를 Cp·Cpk 와 같은 σ 로 계산 (장기 공정능력 저하 판정이 사실상 꺼짐)")
    print(f"\n결과: 오류 {errors} · 경고 {warns}  →  {'사용 가능' if not errors else '필수 오류를 고친 뒤 다시 실행하세요'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
