from pathlib import Path
import io
import os
import zipfile

os.environ.setdefault("WARMUP", "0")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_meta_has_line_node_family_hierarchy():
    m = client.get("/api/meta").json()
    assert [l["line_id"] for l in m["lines"]] == ["L-A", "L-B", "L-C"]
    lb = next(l for l in m["lines"] if l["line_id"] == "L-B")
    assert [n["node"] for n in lb["nodes"]] == ["N4", "N5"]
    fams = {f["family_code"] for n in lb["nodes"] for f in n["families"]}
    assert {"4F-P", "5F-A"} <= fams
    assert len(m["products"]) == 70
    assert {r["code"] for r in m["rules"]} >= {"SPEC_WIDEN", "NO_APPROVAL", "LOT_BEFORE_QUAL", "SINGLE_TOOL"}


def test_top5_is_sorted_by_wip_with_risk_summary():
    t = client.get("/api/top", params={"family": "4F-P", "node": "N4"}).json()
    assert len(t["items"]) == 5
    wips = [x["wip_wafers"] for x in t["items"]]
    assert wips == sorted(wips, reverse=True)
    assert t["items"][0]["product_id"] == "4F-P-01" and t["items"][0]["rank"] == 1
    assert all(0 <= x["summary"]["risk_index"] <= 100 for x in t["items"])
    assert client.get("/api/top", params={"family": "NOPE"}).status_code == 404


def test_search_finds_products_outside_top5():
    r = client.get("/api/products/search", params={"q": "mote-c4"}).json()
    assert r and r[0]["product_id"] == "4F-P-07"  # 4F-P 재공 7위 (Top 5 밖)
    d = client.get(f"/api/products/{r[0]['product_id']}/dossier").json()
    assert d["product"]["rank_in_family"] == 7 and d["steps"]


def test_dossier_flags_planted_audit_cases():
    d = client.get("/api/products/3G-1-02/dossier").json()  # Halcyon-3
    widen = [p for p in d["risk_points"] if p["rule"] == "SPEC_WIDEN"]
    assert widen and widen[0]["severity"] == "CRIT"
    v = client.get("/api/products/5F-A-01/dossier").json()  # Veloq-5 (차량용)
    assert any(p["rule"] == "NO_APPROVAL" and p["severity"] == "CRIT" for p in v["risk_points"])
    assert "차량용 AEC-Q100" in v["product"]["reasons"]
    r = client.get("/api/products/8F-RF-01/dossier").json()  # RFT-8
    assert any(p["rule"] == "SINGLE_TOOL" and p["eqp_id"] == "ALD-C03" for p in r["risk_points"])
    assert any(p["rule"] == "PM_OVERDUE" and p["eqp_id"] == "ALD-C03" for p in r["risk_points"])


def test_equipment_is_aggregated_from_compatible_tools():
    d = client.get("/api/products/3G-2-01/dossier").json()
    compat_ids = {c["eqp_id"] for s in d["steps"] for c in s["compat"]}
    assert {e["eqp_id"] for e in d["equipment"]} == compat_ids
    assert all(i["eqp_id"] in compat_ids for i in d["interlocks"])


def test_unknown_product_is_404():
    assert client.get("/api/products/NOPE/dossier").status_code == 404


def test_export_csv_filters_and_downloads():
    r = client.get("/api/products/3G-1-02/export/il.csv", params={"eqp": "EUV-A02"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0].startswith("interlock_id,eqp_id")
    assert len(lines) > 1 and all(",EUV-A02," in l for l in lines[1:])
    t = client.get("/api/products/3G-1-02/export/target.csv").content.decode("utf-8-sig")
    assert "target.lsl" in t.splitlines()[0] and "spc.cpk" in t.splitlines()[0]
    assert client.get("/api/products/3G-1-02/export/nope.csv").status_code == 404


def test_route_is_grouped_into_stages_and_checks():
    d = client.get("/api/products/3G-1-02/dossier").json()
    assert len(d["steps"]) > 300 and 20 <= len(d["stages"]) <= 40
    assert sum(st["steps"] for st in d["stages"]) == len(d["steps"])
    assert {s["step_grade"] for s in d["steps"]} <= {"A", "B", "C"}
    checks = {c["key"]: c for c in d["summary"]["checks"]}
    assert set(checks) == {"spec", "process", "interlock", "detect", "tttm", "equip", "maint", "cttm", "racb", "change"}
    groups = {g["key"]: g for g in d["summary"]["groups"]}
    assert set(groups) == {"process_data", "equip_data", "change_point"}
    assert groups["process_data"]["cats"] == ["spec", "process"]
    assert not checks["cttm"]["connected"] and checks["cttm"]["points"] == 0
    assert checks["spec"]["points"] >= 1 and checks["spec"]["level"] == "CRIT"  # 자기 승인 스펙 완화
    assert all(r["count"] >= 0 for c in checks.values() for r in c["rules"])


def test_raw_zip_has_all_source_tables():
    r = client.get("/api/products/8F-RF-01/raw.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"process_flow.csv", "interlocks.csv", "maintenance.csv", "changes.csv", "target_standards.csv"} <= set(z.namelist())
    flow = z.read("process_flow.csv").decode("utf-8-sig").splitlines()
    assert flow[0].startswith("product_id,seq,step_id") and len(flow) > 300


def test_records_paging_filter_sort():
    r = client.get("/api/products/3G-1-02/records/il", params={"limit": 10, "sort": "occurred_at", "desc": True}).json()
    assert r["total"] > 10 and len(r["rows"]) == 10
    assert r["rows"][0]["occurred_at"] >= r["rows"][-1]["occurred_at"]
    f = client.get("/api/products/3G-1-02/records/il", params={"flag": True}).json()
    assert f["total"] == r["flagged"] and all(x["release_type"] == "강제 해제" or not x["released_at"] for x in f["rows"])
    st = client.get("/api/products/3G-1-02/dossier").json()["stages"][0]["stage"]
    fl = client.get("/api/products/3G-1-02/records/flow", params={"stage": st, "limit": 2000}).json()
    assert fl["total"] > 0 and all(x["stage"] == st for x in fl["rows"])
    q = client.get("/api/products/3G-1-02/records/il", params={"q": "EUV-A02"}).json()
    assert q["total"] > 0 and all(x["eqp_id"] == "EUV-A02" for x in q["rows"])


def test_overview():
    r = client.get("/api/overview")
    assert r.status_code == 200
    o = r.json()
    assert len(o["products"]) == 70
    idx = [p["risk_index"] for p in o["products"]]
    assert idx == sorted(idx, reverse=True)
    assert set(o["products"][0]["groups"]) == {"process_data", "equip_data", "change_point"}
    assert all(h["severity"] in ("CRIT", "HIGH") for h in o["hot_points"])


def test_category_summary():
    r = client.get("/api/categories/interlock")
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "인터락" and d["group"]["key"] == "equip_data"
    assert len(d["products"]) == 70 and d["total"] == sum(p["points"] for p in d["products"])
    assert d["products"][0]["points"] >= d["products"][-1]["points"]  # Worst → Best
    assert d["rules"] and d["events_total"] > 0 and d["events_flagged"] > 0
    ev = d["events"][0]
    assert ev["flag"] and ev["n_products"] == len(ev["products"]) >= 1
    assert client.get("/api/categories/cttm").json()["connected"] is False
    assert client.get("/api/categories/nope").status_code == 404
    for kind in ("points", "products", "events"):
        csv = client.get(f"/api/categories/interlock/export.csv?kind={kind}")
        assert csv.status_code == 200 and csv.text.count("\n") > 1
    assert client.get("/api/categories/process").json()["events"][0]["cpk"] is not None


def test_flow_records_include_metrology_steps():
    pid = "3G-1-01"
    all_ = client.get(f"/api/products/{pid}/records/flow?limit=2000").json()
    pro = client.get(f"/api/products/{pid}/records/flow?kind=process&limit=2000").json()
    mea = client.get(f"/api/products/{pid}/records/flow?kind=meas&limit=2000").json()
    assert pro["total"] + mea["total"] == all_["total"] and mea["total"] > 0
    m = mea["rows"][0]
    assert m["step_type"] == "meas" and m["process_step_id"] and m["module"] == "계측"
    seqs = [r["seq"] for r in all_["rows"]]
    assert seqs == sorted(seqs)
    csv = client.get(f"/api/products/{pid}/export/flow.csv?kind=meas")
    assert csv.status_code == 200 and csv.text.count("\n") >= mea["total"]


def test_optional_tables_can_be_missing(tmp_path):
    """실데이터에 interlocks·spc_by_eqp 가 없어도 동작하고, 해당 항목은 연결 예정으로 표시"""
    import shutil
    from app.repository.csv_repo import CsvRepository
    from app.services.risk import build_dossier
    src = Path(__file__).resolve().parents[1] / "data" / "sample"
    for f in src.iterdir():
        if f.name not in ("interlocks.csv", "spc_by_eqp.csv"):
            shutil.copy(f, tmp_path / f.name)
    repo = CsvRepository(tmp_path)
    assert repo.missing_tables() == {"interlocks", "spc_by_eqp"}
    d = build_dossier(repo, "3G-1-01")
    checks = {c["key"]: c for c in d["summary"]["checks"]}
    assert not checks["interlock"]["connected"] and not checks["tttm"]["connected"]
    assert checks["process"]["connected"] and checks["maint"]["connected"]
    assert "interlocks" in checks["interlock"]["basis"]
    assert all(p["category"] not in ("interlock", "tttm") for p in d["risk_points"])
