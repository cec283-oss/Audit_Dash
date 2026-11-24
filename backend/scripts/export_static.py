"""API 응답을 JSON 스냅샷으로 저장합니다 (백엔드 없이 여는 데모 빌드용).

python scripts/export_static.py  ->  frontend/src/mock/bundle.json
- 데모 크기를 줄이려고 공정별 재공 상위 2개 공법의 상세만 담습니다 (Top 5 밖 공법은 백엔드 모드에서 조회)
- 설비 이력은 여러 공법이 공유하므로 한 번만 저장하고 공법별로는 ID만 둡니다
- 스텝 목록은 열 이름을 한 번만 쓰는 컬럼형으로 저장합니다
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("WARMUP", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.main import category_api, meta, overview_api, product_dossier, top  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "mock" / "bundle.json"
DEMO_PER_FAMILY = 2  # 데모 HTML 크기 제한: 공정별 재공 상위 2개만 상세 포함
DEMO_EVENTS = 300  # 데모 HTML: 항목별 이력·Risk point 는 상위 300건만 (전체는 백엔드 모드 CSV)
KEYS = {"interlocks": "interlock_id", "maintenance": "mt_id", "changes": "change_id"}


def main() -> None:
    w = settings.window_days
    m = meta(w)
    tops, ids = {}, []
    for line in m["lines"]:
        for nd in line["nodes"]:
            for f in nd["families"]:
                t = top(f["family_code"], nd["node"], 5, w)
                tops[f"{nd['node']}|{f['family_code']}"] = t
                ids += [x["product_id"] for x in t["items"][:DEMO_PER_FAMILY]]
    events = {k: {} for k in KEYS}
    dossiers = {}
    for pid in ids:
        d = dict(product_dossier(pid, w))
        for k, idk in KEYS.items():
            for r in d[k]:
                events[k][r[idk]] = r
            d[k] = [r[idk] for r in d[k]]
        cols = list(d["steps"][0].keys()) if d["steps"] else []
        d["steps"] = {"cols": cols, "rows": [[s[c] for c in cols] for s in d["steps"]]}
        dossiers[pid] = d
    cats = {}
    for c in m["categories"]:
        cd = json.loads(category_api(c, w).body)
        cd["events"] = cd["events"][:DEMO_EVENTS]
        cd["points"] = cd["points"][:DEMO_EVENTS]
        cats[c] = cd
    bundle = {"meta": m, "overview": json.loads(overview_api(w).body), "categories": cats, "tops": tops, "events": events, "dossiers": dossiers}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}  {OUT.stat().st_size / 1024:.0f} KB · 상세 포함 공법 {len(dossiers)}개 / 전체 {len(m['products'])}개")


if __name__ == "__main__":
    main()
