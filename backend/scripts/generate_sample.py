"""시연용 샘플 데이터 생성기.

backend/data/sample/*.csv 를 만듭니다. 사내 실데이터로 바꿀 때는 이 스크립트를 쓰지 않고
같은 파일명·같은 컬럼의 CSV를 DATA_DIR 에 넣으면 됩니다 (docs/DATA_CONTRACT.md 참고).
회사·제품·설비 모델·인명은 모두 가상입니다.
"""
from __future__ import annotations

import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "sample"
AS_OF = datetime(2026, 11, 24, 9, 0)
WINDOW = 90
R = random.Random(20261124)

# code: (공정 모듈, 스텝명, 계측 항목, 단위, target, lsl, usl, 설비 prefix, 설비 번호, CD 스케일 대상, critical)
CATALOG = {
    "NS": ("식각", "Nanosheet 식각", "Sheet 폭", "nm", 30, 28, 32, "ETCH", [14, 15], True, True),
    "FIN": ("식각", "Fin 식각", "Fin CD", "nm", 6.5, 5.9, 7.1, "ETCH", [11, 12, 13], True, True),
    "SAQP": ("포토", "ArFi SAQP", "Mandrel CD", "nm", 24, 22.5, 25.5, "ArFi", [2, 4], True, False),
    "STICMP": ("CMP", "STI CMP", "잔막 두께", "nm", 45, 41, 49, "CMP", [1, 2], False, False),
    "EUVOV": ("포토", "EUV 노광", "Overlay X", "nm", 0, -2.5, 2.5, "EUV", [1, 2, 3], False, True),
    "ARFOV": ("포토", "ArFi 노광", "Overlay X", "nm", 0, -4, 4, "ArFi", [2, 4, 6], False, False),
    "GATE": ("식각", "Gate 식각", "Dummy Gate CD", "nm", 16, 14.8, 17.2, "ETCH", [21, 22, 23], True, True),
    "IS": ("식각", "Inner Spacer 식각", "SiGe Recess 깊이", "nm", 7, 6.2, 7.8, "ETCH", [16, 17], False, False),
    "SPC": ("식각", "Spacer 식각", "Spacer 두께", "nm", 8, 7.2, 8.8, "ETCH", [25, 26], False, False),
    "SDEPI": ("증착", "SiGe S/D EPI", "Ge 농도", "%", 35, 33, 37, "EPI", [1, 2], False, False),
    "SDIMP": ("확산·주입", "S/D 이온주입", "면저항 Rs", "Ω/□", 180, 170, 190, "IMP", [1, 2], False, False),
    "ANN": ("확산·주입", "Laser 어닐", "접합 Rs", "Ω/□", 120, 112, 128, "LSA", [1, 2], False, False),
    "GCMP": ("CMP", "Gate CMP", "Gate 높이", "nm", 60, 56, 64, "CMP", [3, 4], False, False),
    "IL": ("확산·주입", "ISSG 산화", "IL 두께", "Å", 6, 5.6, 6.4, "RTP", [3, 4], False, True),
    "HK": ("증착", "HKMG ALD", "HfO₂ EOT", "Å", 9.5, 9.0, 10.0, "ALD", [3, 4], False, True),
    "TIN": ("증착", "PVD 금속", "TiN 두께", "Å", 30, 28, 32, "PVD", [5, 6], False, False),
    "CT": ("식각", "Contact 식각", "CA 하부 CD", "nm", 18, 16.5, 19.5, "ETCH", [31, 32, 33], True, False),
    "EUVCD": ("포토", "EUV M0 노광", "M0 라인 CD", "nm", 14, 13, 15, "EUV", [1, 2, 3], True, True),
    "ECP": ("증착", "Cu ECP 도금", "Cu 두께", "nm", 420, 400, 440, "ECP", [1, 2], False, False),
    "CUCMP": ("CMP", "Cu CMP", "Dishing", "nm", 8, 0, 18, "CMP", [7, 8], False, False),
    "WET": ("세정", "습식 세정", "파티클 Adder", "ea", 6, 0, 25, "WET", [1, 2, 3], False, False),
}
FLOWS = {
    "GAA": ["NS", "STICMP", "EUVOV", "GATE", "IS", "SPC", "SDEPI", "SDIMP", "ANN", "GCMP", "IL", "HK", "TIN", "CT", "EUVCD", "ECP", "CUCMP", "WET"],
    "FINEUV": ["FIN", "STICMP", "EUVOV", "GATE", "SPC", "SDEPI", "SDIMP", "ANN", "GCMP", "IL", "HK", "TIN", "CT", "EUVCD", "ECP", "CUCMP", "WET"],
    "FIN": ["SAQP", "FIN", "STICMP", "ARFOV", "GATE", "SPC", "SDEPI", "SDIMP", "ANN", "GCMP", "IL", "HK", "TIN", "CT", "ECP", "CUCMP", "WET"],
}
NODE_SCALE = {"N3": 1.0, "N4": 1.1, "N5": 1.25, "N8": 1.7}

LINES = [
    ("L-A", "FAB2 LINE-A", "FAB2", "N3", "3nm GAA"),
    ("L-B", "FAB2 LINE-B", "FAB2", "N4·N5", "4·5nm FinFET"),
    ("L-C", "FAB1 LINE-C", "FAB1", "N8", "8nm FinFET"),
]
# 라인 → 노드 → 공정(옵션 계열) → 공법(제품). FAB TRACE 와 같은 체계·이름·재공 (공법 ID = 공정코드-순번)
NODES = [
    ("L-A", "N3", "GAA", [
        ("3G-1", "GAA 1세대", "Mobile", [("Arkis-9 Ultra AP", 9200), ("Halcyon-3 HPC CPU", 6400), ("NIC-Q8 스마트 NIC", 3900), ("Arkis-9 Lite AP", 3100), ("Strata-X3 서버 IO", 2400), ("Halcyon-3E 엣지 CPU", 1700), ("Mote-C3 컴패니언 칩", 900)]),
        ("3G-2", "GAA 2세대", "HPC", [("Zephra-A9 AI 가속기", 8100), ("Kestrel-G5 GPU", 3300), ("Quill-N3 NPU", 2900), ("Arkis-10 Pro AP", 2600), ("Halcyon-4 HPC CPU", 2000), ("Zephra-A9L 추론 칩", 1400), ("Nexo-D3 DPU", 1100)])]),
    ("L-B", "N4", "FINEUV", [
        ("4F-E", "초기형", "Mobile", [("RFM-5 5G 모뎀", 8700), ("Arkis-7 AP", 4900), ("WR-3 웨어러블 SoC", 2600), ("ISP-M5 이미지 프로세서", 2300), ("Arkis-7 Lite AP", 1800), ("BT-L4 커넥티비티", 900)]),
        ("4F-P", "성능 개선형", "Mobile", [("Arkis-8 Pro AP", 14800), ("Quill-N2 NPU", 11300), ("RFM-6 5G 모뎀", 5600), ("Arkis-8 AP", 4800), ("XR-V2 XR 프로세서", 3200), ("WR-4 웨어러블 SoC", 2100), ("Mote-C4 컴패니언 칩", 1500)]),
        ("4F-X", "HPC형", "HPC", [("Kestrel-G4 GPU", 6200), ("Zephra-A5 AI 가속기", 5400), ("Halcyon-2 서버 CPU", 4100), ("NetSW-41 스위치", 3000), ("Nexo-D2 DPU", 2200), ("Strata-X2 서버 IO", 1300)])]),
    ("L-B", "N5", "FINEUV", [
        ("5F-P", "모바일형", "Mobile", [("Arkis-6 AP", 12100), ("RFM-4 5G 모뎀", 7300), ("Arkis-6 Lite AP", 4200), ("ISP-M4 이미지 프로세서", 3500), ("WR-2 웨어러블 SoC", 1900), ("BT-L3 커넥티비티", 1100)]),
        ("5F-N", "네트워크형", "Network", [("NetSW-51 스위치", 8600), ("Edge-K2 AI 칩", 5100), ("Nexo-D1 DPU", 3900), ("NIC-Q5 스마트 NIC", 3300), ("Photon-5 광 DSP", 2400), ("Edge-K1 AI 칩", 1200)]),
        ("5F-A", "차량용", "Automotive", [("Veloq-5 ADAS", 3800), ("IVI-5 인포테인먼트", 2200), ("Veloq-5R 레이더 DSP", 1900), ("ZC-5 존 컨트롤러", 1600), ("GW-5 차량 게이트웨이", 1300), ("DMS-5 운전자 모니터", 800)])]),
    ("L-C", "N8", "FIN", [
        ("8F-P", "범용형", "Mobile", [("Arkis-L5 보급형 AP", 16400), ("ISP-M3 이미지 프로세서", 11800), ("IVI-8 인포테인먼트", 7200), ("Arkis-L4 보급형 AP", 6100), ("CAM-S8 카메라 SoC", 4300), ("DPC-8 디스플레이 컨트롤러", 3600), ("SSD-C8 SSD 컨트롤러", 2900)]),
        ("8F-U", "초저전력형", "IoT", [("TV-N7 스마트TV SoC", 5400), ("WR-1 웨어러블 SoC", 3100), ("STB-8 셋톱 SoC", 2700), ("IoT-O1 SoC", 2300), ("IoT-O2 SoC", 1800), ("HUB-8 스마트홈 허브", 1100)]),
        ("8F-RF", "RF형", "RF", [("RFT-8 트랜시버", 9300), ("RFT-8L 트랜시버", 5200), ("mmW-28 모듈", 3400), ("WiFi-7R 라디오", 2900), ("GNSS-8 수신기", 1600), ("UWB-8 칩", 1000)])]),
]
# 감사 포인트를 심어 둔 대표 공법 (스크립트 안에서만 쓰는 별칭 → 공법 ID)
ALIAS = {"AK9U": "3G-1-01", "HC3": "3G-1-02", "ZA9": "3G-2-01", "AK8P": "4F-P-01", "QN2": "4F-P-02", "VQ5": "5F-A-01",
         "NS51": "5F-N-01", "AKL5": "8F-P-01", "IVI8": "8F-P-03", "RFT8": "8F-RF-01"}
TAG = {v: k for k, v in ALIAS.items()}
MANUAL_REASONS = {
    "3G-2-01": "고객 품질협약(HPC);EUV 다층 적용", "3G-1-02": "수율 손실 상위", "4F-P-01": "S/W 변경 다수",
    "4F-P-02": "CMP BM 반복", "5F-A-01": "변경 시 고객 PCN 의무;인증 설비 한정", "5F-N-01": "고객 클레임 이력",
    "8F-P-01": "세정 Q-time 이슈", "8F-P-03": "변경 시 고객 PCN 의무", "8F-RF-01": "RF 특수 공정",
}
# product_id, 공법(제품)명, line, node, 공정코드, 공정명, flow, 재공, 등급, 감사 메모(;), 양산 시작
PRODUCTS = []
for _line, _node, _flow, _fams in NODES:
    for _fc, _fn, _grade, _prods in _fams:
        for _j, (_name, _wip) in enumerate(_prods):
            _pid = f"{_fc}-{_j + 1:02d}"
            _g = "Automotive" if ("IVI" in _name or _fc == "5F-A") else _grade
            _start = "2026-03-02" if _pid == "3G-2-01" else (AS_OF - timedelta(days=R.uniform(200, 1300))).strftime("%Y-%m-%d")
            PRODUCTS.append((_pid, _name, _line, _node, _fc, _fn, _flow, _wip, _g, MANUAL_REASONS.get(_pid, ""), _start))
MODELS = {
    "EUV": [("LX-3600", "Lumetra"), ("LX-3800", "Lumetra")],
    "ArFi": [("AQ-2100i", "Lumetra"), ("AQ-2200i", "Lumetra")],
    "ETCH": [("Kyros E7", "Vantec"), ("Kyros E9", "Vantec"), ("Helion C5", "Orbis")],
    "EPI": [("Epix 300", "Thermion")],
    "ALD": [("Atomis 4", "Orbis"), ("Atomis 4X", "Orbis")],
    "PVD": [("Sputra 8", "Vantec")],
    "ECP": [("Platex 3", "Nanoplate")],
    "CMP": [("Planix 300", "Polaris"), ("Planix 300X", "Polaris")],
    "IMP": [("Ionix HC", "Beamtek")],
    "LSA": [("Lasa 2", "Beamtek")],
    "RTP": [("Rapida 5", "Thermion")],
    "WET": [("Cleanix S", "Wetronic")],
}
PM_CYCLE = {"EUV": 14, "ArFi": 21, "ETCH": 21, "EPI": 28, "ALD": 30, "PVD": 28, "ECP": 14, "CMP": 10, "IMP": 30, "LSA": 30, "RTP": 30, "WET": 14}
MODULE_OF = {"EUV": "포토", "ArFi": "포토", "ETCH": "식각", "EPI": "증착", "ALD": "증착", "PVD": "증착", "ECP": "증착", "CMP": "CMP", "IMP": "확산·주입", "LSA": "확산·주입", "RTP": "확산·주입", "WET": "세정"}
ENGINEERS = {"포토": ["김하준", "서지안"], "식각": ["이도윤", "강태오", "조하린"], "증착": ["최예린", "임가온"], "CMP": ["박서연", "윤채원"], "확산·주입": ["정민서", "문서우"], "세정": ["오승현", "한지우"]}
APPROVERS = {"포토": "배수현", "식각": "권도현", "증착": "신예원", "CMP": "홍재민", "확산·주입": "유하은", "세정": "장민혁"}
TEAMS = {"포토": "포토기술팀", "식각": "식각기술팀", "증착": "박막기술팀", "CMP": "CMP기술팀", "확산·주입": "확산·주입팀", "세정": "세정·결함팀"}

IL_CODES = {
    "ETCH": [("FDC-RF-REFL", "FDC", "RF 반사파 상한 초과"), ("FDC-HE-PRESS", "FDC", "ESC He 압력 저하"), ("CH-PRESS", "HW", "챔버 압력 이상"), ("RCP-MISMATCH", "RECIPE", "레시피 버전 불일치")],
    "EUV": [("FDC-DOSE-DRIFT", "FDC", "도즈 드리프트 한계 초과"), ("OVL-OOC", "SPC", "Overlay 관리한계 이탈"), ("RS-TEMP", "HW", "레티클 스테이지 온도 이상")],
    "ArFi": [("OVL-OOC", "SPC", "Overlay 관리한계 이탈"), ("IMM-BUBBLE", "HW", "액침 기포 감지")],
    "CMP": [("EPD-FAIL", "FDC", "종말점 검출 실패"), ("PAD-LIFE", "HW", "패드 수명 한계"), ("SLURRY-FLOW", "FDC", "슬러리 유량 이상")],
    "ALD": [("PREC-PULSE", "FDC", "전구체 펄스 불안정"), ("CAN-LOW", "HW", "캐니스터 잔량 부족"), ("THK-OOC", "SPC", "두께 관리한계 이탈")],
    "EPI": [("LAMP-ZONE", "HW", "램프 존 출력 저하"), ("GE-OOC", "SPC", "Ge 농도 관리한계 이탈")],
    "IMP": [("BEAM-ANGLE", "FDC", "빔 각도 편차"), ("DOSE-FARADAY", "FDC", "패러데이 도즈 편차")],
    "LSA": [("BEAM-PROFILE", "FDC", "빔 프로파일 균일도 저하")],
    "RTP": [("LAMP-ZONE", "HW", "램프 존 출력 저하"), ("O2-FLOW", "FDC", "O₂ 유량 이상")],
    "PVD": [("TGT-LIFE", "HW", "타깃 수명 한계"), ("ARC-COUNT", "FDC", "아킹 횟수 초과")],
    "ECP": [("ADDITIVE", "FDC", "첨가제 농도 이탈"), ("CELL-LEAK", "HW", "도금 셀 누설")],
    "WET": [("PARTICLE", "SPC", "파티클 Adder 초과"), ("IPA-NOZZLE", "HW", "IPA 노즐 위치 이상"), ("QTIME-OVER", "Q-TIME", "Q-time 초과")],
}
BM_REASONS = {
    "ETCH": [("상부 전극 아킹", "상부 전극"), ("ESC He 누설", "ESC·O-ring"), ("RF 매처 고장", "RF 매처")],
    "EUV": [("레티클 핸들러 오류", "핸들러 그리퍼"), ("소스 출력 저하", "콜렉터 미러")],
    "ArFi": [("액침 후드 누수", "액침 후드 씰")],
    "CMP": [("헤드 멤브레인 파손", "멤브레인"), ("컨디셔너 디스크 이탈", "컨디셔너 디스크")],
    "ALD": [("밸브 응답 지연", "ALD 밸브"), ("히터 단선", "서셉터 히터")],
    "EPI": [("램프 단선", "램프 모듈")],
    "IMP": [("빔라인 진공 저하", "크라이오 펌프")],
    "LSA": [("광학계 오염", "광학 윈도")],
    "RTP": [("램프 존 고장", "램프 모듈")],
    "PVD": [("셔터 고착", "셔터 어셈블리")],
    "ECP": [("셀 누설", "셀 씰")],
    "WET": [("IPA 노즐 틀어짐", "노즐 어셈블리"), ("필터 차압 상승", "필터")],
}
CHANGE_ITEMS = {
    "레시피 파라미터": ["Bias power", "공정 시간", "가스 유량", "챔버 압력", "웨이퍼 온도"],
    "H/W 개조": ["샤워헤드 교체 사양", "엣지 링 재질", "배기 라인 개조"],
    "S/W 업데이트": ["Tool S/W 버전", "APC 모델 버전", "FDC 모델 버전"],
    "FDC 한계 변경": ["RF 반사파 상한", "He 압력 하한", "종말점 시간 상한", "도즈 드리프트 한계"],
    "인터락 조건 변경": ["자동 해제 조건", "인터락 대기 시간", "재시도 횟수"],
}

# ───────── 감사 포인트로 심어 두는 사례 (hotspot) ─────────
HOT = {  # eqp: (인터락 배수, BM 배수, 강제 해제 확률)
    "EUV-A02": (2.0, 1.0, 0.0), "ETCH-A22": (2.0, 1.0, 0.05), "ALD-A04": (2.0, 1.0, 0.1),
    "ETCH-B12": (1.8, 1.0, 0.0), "CMP-B03": (2.0, 1.0, 0.0), "EPI-B02": (2.2, 1.0, 0.0), "EUV-B01": (1.5, 1.0, 0.0),
    "WET-C02": (1.8, 1.0, 0.0), "ALD-C03": (1.8, 1.5, 0.0), "RTP-C03": (1.8, 1.0, 0.0),
}


def ts(d: datetime) -> str:
    return d.strftime("%Y-%m-%d %H:%M")


def rand_time(days_back_max: float, days_back_min: float = 0) -> datetime:
    return AS_OF - timedelta(days=R.uniform(days_back_min, days_back_max))


def poisson(lam: float) -> int:
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= R.random()
        if p <= L:
            return k
        k += 1


# 계측 장비 종류 (단위로 추정)
MEAS_TOOL = {"nm": "CD-SEM/두께", "Å": "Ellipsometer", "%": "XRF", "ohm/sq": "4-Point Probe", "Ω/sq": "4-Point Probe", "ea": "Particle Counter",
             "at%": "XPS", "E/cm2": "Thermawave", "deg": "Overlay"}
# 심어 둔 TTTM 사례: 설비 → (평균 차 σ 배수 M/S, 산포 비 S/R)
TTTM_PLANT = {
    "ETCH-B12": (1.35, 1.05),   # 미승인 Bias power 변경 이후 평균 이동 (VQ5 등)
    "CMP-B03": (0.25, 1.75),    # BM 반복 · Qual 전 LOT 진행 설비 → 산포 큼
    "EUV-A02": (0.95, 1.30),    # 인터락 반복 설비 → 평균·산포 모두 벗어남
    "ALD-C03": (0.55, 1.45),    # 단일 호환설비 + PM 초과
}


def write(name: str, header: list[str], rows: list[list]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"  {name:<24} {len(rows):>5} rows")


# ───── 라우트(공정흐름) 템플릿: 스테이지 → 스텝 ─────
# 실제 라우트처럼 세정·노광·식각·애싱·증착·CMP 가 반복되는 수백 스텝. 핵심 스텝(#CODE)은 CATALOG 를 따릅니다.
OPS = {  # op: (모듈, 스텝명 접미, 설비 prefix, 설비 번호 후보)
    "CLN": ("세정", "세정", "WET", [1, 2, 3, 4]),
    "LE": ("포토", "EUV 노광", "EUV", [1, 2, 3]),
    "LA": ("포토", "ArFi 노광", "ArFi", [2, 4, 6]),
    "ETF": ("식각", "식각", "ETCH", [11, 12, 13, 14, 15, 16, 17]),
    "ETG": ("식각", "식각", "ETCH", [21, 22, 23, 25, 26]),
    "ETB": ("식각", "식각", "ETCH", [31, 32, 33, 34, 35, 36]),
    "ASH": ("식각", "애싱·스트립", "ETCH", [34, 35, 36]),
    "ALD": ("증착", "ALD 증착", "ALD", [3, 4, 5]),
    "CVD": ("증착", "CVD 증착", "ALD", [5, 6]),
    "PVD": ("증착", "PVD 증착", "PVD", [5, 6, 7]),
    "EPI": ("증착", "EPI 성장", "EPI", [1, 2]),
    "ECP": ("증착", "Cu 도금", "ECP", [1, 2, 3]),
    "CMP": ("CMP", "CMP", "CMP", [1, 2, 3, 4, 5, 6, 7, 8]),
    "IMP": ("확산·주입", "이온주입", "IMP", [1, 2, 3]),
    "ANN": ("확산·주입", "어닐", "LSA", [1, 2]),
    "OXI": ("확산·주입", "산화", "RTP", [3, 4]),
}


def route_template(flow: str) -> list[tuple]:
    """[(stage, op 또는 #CODE, label, meas)] — meas = (param, unit, target, lsl, usl)"""
    euv = flow in ("GAA", "FINEUV")
    LE = "LE" if euv else "LA"
    out: list[tuple] = []

    def add(stage, items):
        for it in items:
            out.append((stage,) + (it if isinstance(it, tuple) else (it, "", None)) + ((None,) if isinstance(it, tuple) and len(it) == 2 else ()))

    def pat(lbl, et, litho="LA"):
        return [("CLN", f"{lbl} 전"), (litho, lbl), (et, lbl), ("ASH", lbl), ("CLN", f"{lbl} 후")]

    if flow == "GAA":
        add("적층 Si/SiGe", [("CLN", "입고"), ("OXI", "패드"), ("CLN", "적층 전"), ("EPI", "SiGe 1층", ("SiGe 두께", "nm", 8, 7.4, 8.6)), ("EPI", "Si 1층"),
                            ("EPI", "SiGe 2층"), ("EPI", "Si 2층"), ("EPI", "SiGe 3층"), ("EPI", "Si 3층", ("적층 총두께", "nm", 60, 57, 63)), ("CLN", "적층 후")])
        add("Nanosheet 패터닝", [("CLN", "HM 전"), ("CVD", "하드마스크"), (LE, "NS 1차"), ("ETF", "하드마스크"), ("ASH", "HM"), ("CLN", "NS 전"), "#NS", ("ASH", "NS"), ("CLN", "NS 후")])
    else:
        add("웨이퍼 준비", [("CLN", "입고"), ("OXI", "패드"), ("CLN", "HM 전"), ("CVD", "하드마스크", ("HM 두께", "nm", 40, 37, 43)), ("CLN", "HM 후")])
        if flow == "FIN":
            add("Fin 패터닝 (SAQP)", [("CLN", "맨드릴 전"), ("CVD", "맨드릴"), "#SAQP", ("ETF", "맨드릴"), ("ASH", "맨드릴"), ("ALD", "SAQP 스페이서 1"), ("ETF", "스페이서 1"),
                                    ("ALD", "SAQP 스페이서 2"), ("ETF", "스페이서 2"), ("CLN", "Fin 전"), "#FIN", ("ASH", "Fin"), ("CLN", "Fin 후")])
        else:
            add("Fin 패터닝", [("CLN", "Fin 전"), (LE, "Fin"), ("ETF", "하드마스크"), ("ASH", "HM"), ("CLN", "Fin 식각 전"), "#FIN", ("ASH", "Fin"), ("CLN", "Fin 후")])
    add("STI", [("CLN", "STI 전"), ("OXI", "라이너"), ("CVD", "갭필", ("STI 갭필 두께", "nm", 120, 112, 128)), ("ANN", "갭필 큐어"), "#STICMP", ("CLN", "STI CMP 후"),
                ("ETF", "STI Recess", ("STI Recess 깊이", "nm", 30, 27, 33)), ("CLN", "Recess 후")])
    wells = ["N-Well", "P-Well", "Vt-N1", "Vt-P1", "Vt-N2", "Vt-P2", "Vt-N3", "Vt-P3", "Punch-N", "Punch-P"]
    for w in wells:
        add("Well·Vt 주입", [("CLN", f"{w} 전"), ("LA", w), ("IMP", w), ("ASH", w), ("CLN", f"{w} 후")])
    add("Well·Vt 주입", [("ANN", "Well 활성화")])
    add("Dummy Gate", [("CLN", "더미 산화 전"), ("OXI", "더미 게이트"), ("CVD", "폴리"), ("CMP", "폴리", ("폴리 두께", "nm", 80, 76, 84)), ("CVD", "게이트 HM"),
                       "#EUVOV" if euv else "#ARFOV", "#GATE", ("ASH", "게이트"), ("CLN", "게이트 후")] + pat("게이트 컷", "ETG"))
    add("Gate Spacer", [("CLN", "스페이서 전"), ("ALD", "스페이서 1"), "#SPC", ("CLN", "스페이서 1 후"), ("ALD", "스페이서 2"), ("ETG", "스페이서 2"), ("CLN", "스페이서 2 후")])
    if flow == "GAA":
        add("Inner Spacer", [("CLN", "IS 전"), "#IS", ("CLN", "IS Recess 후"), ("ALD", "이너 스페이서"), ("ETG", "IS 트림", ("Inner Spacer 두께", "nm", 5, 4.4, 5.6)), ("CLN", "IS 후")])
    add("S/D EPI", pat("PMOS 오픈", "ETG")[:3] + [("ASH", "PMOS"), ("CLN", "SiGe EPI 전"), "#SDEPI", ("CLN", "SiGe EPI 후")]
        + pat("NMOS 오픈", "ETG")[:3] + [("ASH", "NMOS"), ("CLN", "Si:P EPI 전"), ("EPI", "Si:P S/D", ("P 농도", "%", 2.5, 2.2, 2.8)), ("CLN", "Si:P EPI 후")])
    add("S/D 주입·활성화", [("CLN", "SDIMP 전"), ("LA", "S/D 주입"), "#SDIMP", ("ASH", "S/D"), ("CLN", "S/D 후")] + pat("Halo 주입", "IMP") + ["#ANN"])
    rmg = [("CLN", "ILD0 전"), ("CVD", "ILD0"), "#GCMP", ("ETG", "더미 게이트 제거"), ("CLN", "더미 제거 후")]
    if flow == "GAA":
        rmg += [("ETF", "채널 릴리스 (SiGe 제거)", ("릴리스 잔여 SiGe", "Å", 0, 0, 3)), ("CLN", "릴리스 후")]
    rmg += ["#IL", "#HK", ("ANN", "PDA"), "#TIN", ("PVD", "WFM 2", ("WFM 두께", "Å", 25, 23, 27)), ("PVD", "게이트 메탈 충진"), ("CMP", "게이트 메탈"),
            ("CLN", "RMG CMP 후"), ("CVD", "게이트 캡"), ("CMP", "게이트 캡", ("캡 두께", "nm", 20, 18, 22)), ("CLN", "캡 후")]
    add("RMG·HKMG", rmg)
    add("Contact (MOL)", [("CLN", "ILD1 전"), ("CVD", "ILD1"), (LE, "CA"), "#CT", ("ASH", "CA"), ("CLN", "CA 후")] + pat("CB", "ETB", LE)
        + [("PVD", "실리사이드"), ("ANN", "실리사이드"), ("PVD", "컨택 배리어"), ("PVD", "W 충진"), ("CMP", "컨택", ("CA 높이", "nm", 40, 36, 44)), ("CLN", "컨택 CMP 후")])
    add("M0", [("CLN", "M0 전"), ("CVD", "M0 ILD"), "#EUVCD" if euv else ("LA", "M0"), ("ETB", "M0 트렌치", ("M0 트렌치 깊이", "nm", 36, 33, 39)), ("ASH", "M0"),
               ("CLN", "M0 식각 후"), ("PVD", "M0 배리어"), ("ECP", "M0"), ("CMP", "M0", ("M0 Cu 두께", "nm", 32, 29, 35)), ("CLN", "M0 CMP 후")])
    layers = {"GAA": 16, "FINEUV": 14, "FIN": 11}[flow]
    for i in range(1, layers + 1):
        m, v = f"M{i}", f"V{i - 1}"
        lith = LE if i <= 4 else "LA"
        items = [("CLN", f"{m} ILD 전"), ("CVD", f"{m} ILD")] + pat(v, "ETB", lith)[1:]
        if i <= 3:
            items += [(lith, f"{m} 1차"), ("ETB", f"{m} 트렌치 1차"), ("ASH", f"{m} 1차"), ("CLN", f"{m} 1차 후"),
                      (lith, f"{m} 2차"), ("ETB", f"{m} 트렌치 2차", (f"{m} 트렌치 깊이", "nm", 40 + 4 * i, 37 + 4 * i, 43 + 4 * i)), ("ASH", f"{m} 2차"), ("CLN", f"{m} 2차 후")]
        else:
            items += [(lith, f"{m} 트렌치"), ("ETB", f"{m} 트렌치", (f"{m} 트렌치 깊이", "nm", 40 + 6 * i, 37 + 6 * i, 43 + 6 * i)), ("ASH", m), ("CLN", f"{m} 식각 후")]
        items += [("PVD", f"{m} 배리어")] + (["#ECP", "#CUCMP"] if i == 1 else [("ECP", m), ("CMP", m, (f"{m} Cu 두께", "nm", 50 + 8 * i, 46 + 8 * i, 54 + 8 * i))]) + [("CLN", f"{m} CMP 후")]
        add(f"BEOL {m}", items)
    add("Passivation·Pad", [("CLN", "패시베이션 전"), ("CVD", "패시베이션 산화막"), ("CVD", "패시베이션 질화막")] + pat("패드 오픈", "ETB")[1:4] + ["#WET", ("ANN", "신터")])
    return out


def main() -> None:
    letter = {l[0]: l[0][-1] for l in LINES}
    rs = random.Random(7)  # 라우트·호환설비 구성 전용 (다른 난수와 분리)

    # 라인 × 흐름별 라우트 (같은 라인·같은 흐름의 공법은 같은 스텝·호환설비를 씁니다)
    templates: dict[tuple[str, str], list[dict]] = {}
    for line, _node, flow, _f in NODES:
        if (line, flow) in templates:
            continue
        steps = []
        for i, (stage, op, label, meas) in enumerate(route_template(flow)):
            seq = (i + 1) * 10
            if op.startswith("#"):
                code = op[1:]
                mod, sname, param, unit, tgt, lsl, usl, pre, nums, cd, crit = CATALOG[code]
                steps.append(dict(seq=seq, step_id=f"{code}-{seq:04d}", code=code, stage=stage, module=mod, name=sname, pre=pre, nums=nums,
                                  meas=(param, unit, tgt, lsl, usl), cd=cd, grade="A" if crit else "B"))
            else:
                mod, suffix, pre, cand = OPS[op]
                k = min(len(cand), rs.choice([2, 2, 3]))
                nums = sorted(rs.sample(cand, k))
                steps.append(dict(seq=seq, step_id=f"{op}-{seq:04d}", code=None, stage=stage, module=mod, name=f"{label} {suffix}".strip(), pre=pre, nums=nums,
                                  meas=meas, cd=False, grade="B" if meas else "C"))
        templates[(line, flow)] = steps

    # ───── equipment ─────
    equipment: dict[str, dict] = {}
    for (line, _flow), steps in templates.items():
        for st in steps:
            for n in st["nums"]:
                eid = f"{st['pre']}-{letter[line]}{n:02d}"
                if eid in equipment:
                    continue
                models = MODELS[st["pre"]]
                m = models[0] if (n % 3 != 0 or len(models) == 1) else models[-1]
                if st["pre"] == "ETCH" and n in (23, 33, 36):
                    m = models[2]
                cyc = PM_CYCLE[st["pre"]]
                last_pm = AS_OF - timedelta(days=R.uniform(1, cyc * 0.9))
                equipment[eid] = dict(eqp_id=eid, prefix=st["pre"], eqp_model=m[0], maker=m[1], module=MODULE_OF[st["pre"]], line_id=line,
                                      status="RUN", pm_cycle_days=cyc, last_pm_at=last_pm)
                # 안정 설비군 (번호 +60): 안정 공법(CLEAN)만 사용 · 이벤트가 적음
                cid = f"{st['pre']}-{letter[line]}{n + 60:02d}"
                if cid not in equipment:
                    equipment[cid] = dict(eqp_id=cid, prefix=st["pre"], eqp_model=m[0], maker=m[1], module=MODULE_OF[st["pre"]], line_id=line,
                                          status="RUN", pm_cycle_days=cyc, last_pm_at=AS_OF - timedelta(days=R.uniform(1, cyc * 0.6)), clean=True)
    equipment["ALD-C03"]["last_pm_at"] = AS_OF - timedelta(days=42.3)  # PM 주기 30일 → 12일 초과
    equipment["CMP-B03"]["status"] = "QUAL"
    equipment["EUV-B01"]["last_pm_at"] = AS_OF - timedelta(days=17.5)  # 주기 14일 → 3.5일 초과

    # ───── 안정 공법: 공정마다 재공 최하위 1개 (심어 둔 사례·차량용 제외) → 양호 판정 예시 ─────
    clean: set[str] = set()
    for fam in sorted({p[4] for p in PRODUCTS}):
        cand = [p for p in PRODUCTS if p[4] == fam and p[0] not in TAG and not str(p[8]).lower().startswith("auto")]
        if cand:
            clean.add(min(cand, key=lambda p: p[7])[0])

    # ───── products / flow / target / compat / spc ─────
    prod_rows, flow_rows, tgt_rows, tchg_rows, compat_rows, spc_rows, spc_eqp_rows = [], [], [], [], [], [], []
    users_of: dict[str, list[tuple[str, str]]] = {}  # eqp -> [(product, step)]
    key_step: dict[str, dict[str, str]] = {}
    spc_plan: list[tuple] = []
    tools_of: dict[tuple[str, str], list[str]] = {}
    for p in PRODUCTS:
        pid, name, line, node, fcode, fname, flow, wip, grade, reasons, start = p
        tag = TAG.get(pid, "")
        prod_rows.append([pid, name, line, node, fcode, fname, flow, wip, grade, reasons, start])
        sc = NODE_SCALE[node]
        key_step[pid] = {}
        for st in templates[(line, flow)]:
            code, step_id, mod = st["code"], st["step_id"], st["module"]
            if code:
                key_step[pid][code] = step_id
            meas = st["meas"]
            param, unit = (meas[0], meas[1]) if meas else ("", "")
            recipe = f"{pid}_{step_id.split('-')[0]}_{st['seq']:04d}_R{R.randint(1, 9)}"
            # 계측 스텝: 공정 스텝 결과를 재는 뒤따르는 계측 스텝 (라우트 seq + 5)
            meas_id, meas_name = (f"MEAS-{st['seq'] + 5:04d}", f"{param} 계측 · {MEAS_TOOL.get(unit, '계측')}") if meas else ("", "")
            flow_rows.append([pid, st["seq"], step_id, st["name"], st["stage"], mod, param, unit, st["grade"], "Y" if st["grade"] == "A" else "N", recipe, meas_id, meas_name])

            if meas:
                _, _, tgt, lsl, usl = meas
                k = sc if st["cd"] else 1.0
                dec = 2 if abs(usl - lsl) * k < 10 else 1
                T, L, U = round(tgt * k, dec), round(lsl * k, dec), round(usl * k, dec)
                # 타겟표준 개정 이력: 과거 rev 몇 개 (대부분 규격 강화)
                revs = R.choice([1, 1, 1, 2, 2, 3])
                cur = (T, L, U)
                hist = []
                for r in range(revs - 1, 0, -1):
                    prev = (cur[0], round(cur[1] - (U - L) * 0.04, dec), round(cur[2] + (U - L) * 0.04, dec))
                    hist.append((r + 1, prev, cur))
                    cur = prev
                hist.reverse()
                day = R.uniform(260, 700)
                rev_rows = []
                for rev, before, after in hist:
                    day -= R.uniform(60, 200)
                    rev_rows.append([f"TC-{pid}-{step_id}-{rev}", pid, step_id, param, rev, ts(AS_OF - timedelta(days=max(day, 5))),
                                     before[0], after[0], before[1], after[1], before[2], after[2], "공정능력 개선에 따른 규격 강화",
                                     R.choice(ENGINEERS[mod]), APPROVERS[mod], f"ECN-{R.randint(24000, 26999)}"])
                final_rev = revs
                # 심어 둔 사례: 스펙 완화 + 자기 승인
                if tag == "HC3" and code == "GATE":
                    final_rev += 1
                    rev_rows.append([f"TC-{pid}-{step_id}-{final_rev}", pid, step_id, param, final_rev, "2026-10-28 16:42", T, T, L, round(L - 0.2, dec), U, round(U + 0.4, dec),
                                     "수율 확보 목적 USL 완화 (임시)", "이도윤", "이도윤", "ECN-26811"])
                    L, U = round(L - 0.2, dec), round(U + 0.4, dec)
                if tag == "IVI8" and code == "IL":
                    final_rev += 1
                    rev_rows.append([f"TC-{pid}-{step_id}-{final_rev}", pid, step_id, param, final_rev, "2026-11-06 10:15", T, T, L, round(L - 0.2, dec), U, U,
                                     "LSL 하향 (설비 편차 반영)", "정민서", "정민서", "ECN-26874"])
                    L = round(L - 0.2, dec)
                if tag == "NS51" and code == "SDEPI":
                    final_rev += 1
                    rev_rows.append([f"TC-{pid}-{step_id}-{final_rev}", pid, step_id, param, final_rev, "2026-09-19 14:03", T, T, L, round(L - 0.5, dec), U, round(U + 0.5, dec),
                                     "고객 협의 전 규격 확대", "최예린", "신예원", "ECN-26702"])
                    L, U = round(L - 0.5, dec), round(U + 0.5, dec)
                tchg_rows += rev_rows
                eff = rev_rows[-1][5][:10] if rev_rows else start
                # 관리한계(C/L): 규격(S/L)보다 안쪽 — 타겟에서 규격까지 거리의 60%
                LCL, UCL = round(T - (T - L) * 0.6, dec + 1), round(T + (U - T) * 0.6, dec + 1)
                tgt_rows.append([pid, step_id, param, unit, T, L, U, LCL, UCL, final_rev, eff, TEAMS[mod]])

                # 공정능력 목표(단기 Cpk): 핵심 스텝은 이전과 같은 분포, 일반 계측 스텝은 대부분 양호. 등급이 높을수록 약간 타이트
                cpk = min(2.4, max(0.85, R.gauss(1.78, 0.2) if code else R.gauss(1.95, 0.17)))
                if st["grade"] == "A":
                    cpk = max(cpk, R.gauss(1.95, 0.15))
                if pid in clean:
                    cpk = max(cpk, R.gauss(2.1, 0.12))  # 안정 공법: 공정능력 여유  # A등급(요구 1.67)은 대부분 여유 있게 관리
                if (tag, code) in {("NS51", "SDEPI"), ("QN2", "STICMP"), ("ZA9", "EUVOV"), ("HC3", "GATE"), ("AKL5", "WET")}:
                    cpk = {"NS51": 0.92, "QN2": 1.08, "ZA9": 1.21, "HC3": 1.12, "AKL5": 1.18}[tag]
                spc_plan.append((pid, step_id, meas_id, param, T, L, U, dec, cpk, code, tag, st))

            # 호환설비
            eqs = [f"{st['pre']}-{letter[line]}{n + (60 if pid in clean else 0):02d}" for n in st["nums"]]
            for j, e in enumerate(eqs):
                qualified = "Y"
                if grade == "Automotive" and j == len(eqs) - 1 and len(eqs) > 1:
                    qualified = "N"  # 차량용은 인증 설비 한정
                if tag == "RFT8" and code == "HK" and e != "ALD-C03":
                    continue  # 단일 호환설비
                compat_rows.append([pid, step_id, e, qualified, (AS_OF - timedelta(days=R.uniform(120, 600))).strftime("%Y-%m-%d")])
                if qualified == "Y":
                    users_of.setdefault(e, []).append((pid, step_id))
                    if meas:
                        tools_of.setdefault((pid, step_id), []).append(e)

    # ───── SPC: 설비별 출력(계측값) → 전체 공정능력 Cp·Cpk(군내 σ) / Pp·Ppk(전체 σ) ─────
    for pid, step_id, meas_id, param, T, L, U, dec, cpk, code, tag, st in spc_plan:
        width = U - L if U > L else max(abs(U), 1.0)
        sw = width / (6 * cpk)                    # 목표 군내 σ
        center = T + R.gauss(0, sw * 0.15)        # 공정 중심
        tools = tools_of.get((pid, step_id)) or [f"{st['pre']}-X01"]
        per = []
        for e in tools:
            ms, sr = R.gauss(0, 0.12), max(0.8, R.gauss(1.0, 0.07))    # 설비 간 평균 차(σ 배수) · 산포 비
            if pid in clean:
                ms, sr = R.gauss(0, 0.06), min(1.12, max(0.9, R.gauss(1.0, 0.04)))
            if e in TTTM_PLANT:
                ms, sr = TTTM_PLANT[e]
            n = R.randint(40, 320)
            mu = center + ms * sw
            s_w = sw * sr
            s_o = s_w * R.uniform(1.02, 1.10)    # 장기 드리프트 포함
            per.append((e, n, mu, s_w, s_o))
            spc_eqp_rows.append([pid, step_id, meas_id, param, e, n, round(mu, dec + 2), round(s_w, dec + 3), round(s_o, dec + 3)])
        N = sum(x[1] for x in per)
        mu = sum(x[1] * x[2] for x in per) / N
        s_within = (sum(x[1] * x[3] ** 2 for x in per) / N) ** 0.5
        s_overall = ((sum(x[1] * (x[4] ** 2 + (x[2] - mu) ** 2) for x in per)) / N) ** 0.5
        cp, pp = width / (6 * s_within), width / (6 * s_overall)
        cpk_ = min(U - mu, mu - L) / (3 * s_within)
        ppk = min(U - mu, mu - L) / (3 * s_overall)
        ooc = poisson(0.6 if cpk_ > 1.33 else 4)
        oos = 0 if cpk_ > 1.2 else poisson(2.5 if cpk_ > 1 else 4.5)
        spc_rows.append([pid, step_id, meas_id, param, N, round(mu, dec + 2), round(s_within, dec + 3), round(s_overall, dec + 3),
                         round(cp, 2), round(cpk_, 2), round(pp, 2), round(ppk, 2), ooc, oos])

    # ───── interlocks ─────
    il_rows = []
    il_seq = 1
    forced_ops = ["OP-2231", "OP-1874", "OP-3307", "OP-2950"]
    for e in equipment.values():
        eid, pre = e["eqp_id"], e["prefix"]
        im, bm, fp = HOT.get(eid, (0.1, 0.1, 0.0) if e.get("clean") else (1.0, 1.0, 0.012))
        lam = {"ETCH": 0.035, "EUV": 0.03, "CMP": 0.03, "WET": 0.03}.get(pre, 0.02) * im * WINDOW
        n = poisson(lam)
        for _ in range(n):
            t = rand_time(WINDOW)
            code, cat, desc = R.choice(IL_CODES[pre])
            sev = R.choices(["MINOR", "MAJOR", "CRIT"], [55, 35, 10] if im == 1 else [35, 45, 20])[0]
            forced = R.random() < fp
            rel = t + timedelta(hours=R.uniform(0.1, 0.8) if forced else R.uniform(0.5, 7))
            users = users_of.get(eid) or [("", "")]
            pid, sid = R.choice(users)
            node = next((p[3] for p in PRODUCTS if p[0] == pid), "N?")
            il_rows.append([f"IL-{il_seq:05d}", eid, ts(t), code, cat, sev, desc, ts(rel) if rel < AS_OF else "", "강제 해제" if forced else "정상 조치",
                            R.choice(forced_ops) if forced else R.choice(ENGINEERS[e["module"]]), f"{node}-{R.randint(1000, 9999)}" if pid else "", pid, sid])
            il_seq += 1
    # 심어 둔 사례: EUV-A02 도즈 드리프트 반복 (최근 30일 6회, 2회 강제 해제)
    for k, d in enumerate([2.2, 5.6, 9.1, 13.4, 19.8, 26.5]):
        t = AS_OF - timedelta(days=d, hours=R.uniform(0, 5))
        forced = k in (1, 4)
        pid, sid = R.choice(users_of["EUV-A02"])
        il_rows.append([f"IL-{il_seq:05d}", "EUV-A02", ts(t), "FDC-DOSE-DRIFT", "FDC", "MAJOR" if k % 2 else "CRIT", "도즈 드리프트 한계 초과",
                        ts(t + timedelta(minutes=R.randint(6, 40) if forced else R.randint(90, 300))), "강제 해제" if forced else "정상 조치",
                        "OP-2231" if forced else "서지안", f"N3-{R.randint(1000, 9999)}", pid, sid])
        il_seq += 1
    for d in [1.4, 4.3, 7.7, 12.9, 21.2]:
        t = AS_OF - timedelta(days=d, hours=R.uniform(0, 6))
        pid, sid = R.choice(users_of["WET-C02"])
        il_rows.append([f"IL-{il_seq:05d}", "WET-C02", ts(t), "QTIME-OVER", "Q-TIME", "MAJOR", "Q-time 초과",
                        ts(t + timedelta(minutes=R.randint(5, 25))), "강제 해제" if d < 8 else "정상 조치", "OP-3307" if d < 8 else "오승현", f"N8-{R.randint(1000, 9999)}", pid, sid])
        il_seq += 1
    il_rows.sort(key=lambda r: r[2], reverse=True)

    # ───── maintenance (PM/BM) ─────
    mt_rows = []
    mt_seq = 1
    for e in equipment.values():
        eid, pre, cyc = e["eqp_id"], e["prefix"], e["pm_cycle_days"]
        t = e["last_pm_at"]
        while t > AS_OF - timedelta(days=WINDOW):
            dur = R.uniform(4, 14)
            end = t + timedelta(hours=dur)
            mt_rows.append([f"MT-{mt_seq:05d}", eid, "PM", ts(t), ts(end), f"정기 PM ({cyc}일 주기)", "소모품 일괄", "PASS", ts(end + timedelta(hours=R.uniform(1, 4))), 0, TEAMS[e["module"]]])
            mt_seq += 1
            t -= timedelta(days=cyc + R.uniform(-2, 3))
        _, bmm, _ = HOT.get(eid, (1, 0.05 if e.get("clean") else 1.0, 0))
        for _ in range(poisson(0.007 * bmm * WINDOW)):
            t0 = rand_time(WINDOW, 1)
            reason, part = R.choice(BM_REASONS[pre])
            end = t0 + timedelta(hours=R.uniform(3, 30))
            qual = R.choices(["PASS", "FAIL"], [97, 3])[0]
            mt_rows.append([f"MT-{mt_seq:05d}", eid, "BM", ts(t0), ts(end), reason, part, qual, ts(end + timedelta(hours=R.uniform(1, 6))), 0, TEAMS[e["module"]]])
            mt_seq += 1
    planted_bm = [
        ("ETCH-A22", 3.2, "상부 전극 아킹", "상부 전극", "PASS", 2),
        ("ETCH-A22", 11.5, "상부 전극 아킹", "상부 전극", "PASS", 0),
        ("ETCH-A22", 24.0, "RF 매처 고장", "RF 매처", "PASS", 0),
        ("CMP-B03", 0.8, "헤드 멤브레인 파손", "멤브레인", "PENDING", 3),
        ("CMP-B03", 16.4, "헤드 멤브레인 파손", "멤브레인", "PASS", 0),
        ("ALD-A04", 8.6, "밸브 응답 지연", "ALD 밸브", "FAIL", 1),
    ]
    for eid, d, reason, part, qual, lots in planted_bm:
        t0 = AS_OF - timedelta(days=d)
        end = t0 + timedelta(hours=R.uniform(6, 20))
        mt_rows.append([f"MT-{mt_seq:05d}", eid, "BM", ts(t0), ts(end), reason, part, qual, "" if qual == "PENDING" else ts(end + timedelta(hours=3)), lots, TEAMS[equipment[eid]["module"]]])
        mt_seq += 1
    mt_rows.sort(key=lambda r: r[3], reverse=True)

    # ───── changes ─────
    ch_rows = []
    ch_seq = 1
    for e in equipment.values():
        eid, mod = e["eqp_id"], e["module"]
        for _ in range(poisson(0.014 * WINDOW * (0.15 if e.get("clean") else 1))):
            t = rand_time(WINDOW)
            cat = R.choices(list(CHANGE_ITEMS), [55, 15, 28, 2, 0])[0]
            item = R.choice(CHANGE_ITEMS[cat])
            users = users_of.get(eid) or [("", "")]
            pid, sid = R.choice(users) if cat == "레시피 파라미터" else ("", "")
            before, after = change_values(cat, item)
            req = R.choice(ENGINEERS[mod])
            approved = APPROVERS[mod]
            app_at = t + timedelta(hours=R.uniform(-30, -2))
            age = (AS_OF - t).days
            verify = "완료" if age > 10 or e.get("clean") else R.choice(["완료", "진행"])
            ch_rows.append([f"CH-{ch_seq:05d}", eid, pid, sid, ts(t), cat, item, before, after, f"ECN-{R.randint(25000, 26999)}", req, approved, ts(app_at), verify])
            ch_seq += 1
    planted_ch = [
        ("ETCH-B12", ALIAS["VQ5"], "FIN", 14.2, "레시피 파라미터", "Bias power", "450 W", "480 W", "강태오", "", "", "미실시"),
        ("RTP-C03", "", "", 18.5, "FDC 한계 변경", "램프 존 출력 하한", "92 %", "88 %", "정민서", "정민서", "self", "완료"),
        ("EUV-B01", "", "", 21.0, "S/W 업데이트", "Tool S/W 버전", "v7.4.2", "v7.5.0", "김하준", "배수현", "ok", "진행"),
        ("EUV-A02", "", "", 27.3, "FDC 한계 변경", "도즈 드리프트 한계", "±0.8 %", "±1.2 %", "서지안", "배수현", "ok", "완료"),
        ("WET-C02", "", "", 9.4, "인터락 조건 변경", "자동 해제 조건", "수동 확인 후 해제", "Q-time 30분 이내 자동 해제", "오승현", "오승현", "self", "진행"),
        ("ALD-A04", ALIAS["AK9U"], "HK", 6.1, "레시피 파라미터", "전구체 펄스 시간", "0.40 s", "0.44 s", "최예린", "신예원", "ok", "진행"),
    ]
    for eid, pid, sid, d, cat, item, b, a, req, appr, kind, ver in planted_ch:
        sid = key_step[pid][sid] if pid else sid  # 핵심 스텝 코드 → 실제 step_id
        t = AS_OF - timedelta(days=d)
        ch_rows.append([f"CH-{ch_seq:05d}", eid, pid, sid, ts(t), cat, item, b, a, f"ECN-{R.randint(26500, 26999)}" if appr else "", req, appr,
                        ts(t - timedelta(hours=3)) if appr else "", ver])
        ch_seq += 1
    ch_rows.sort(key=lambda r: r[4], reverse=True)

    print(f"sample data -> {OUT}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "meta.json").write_text(
        '{"as_of": "%s", "note": "샘플 데이터 기준 시각. 실데이터 폴더에는 이 파일을 두지 않으면 현재 시각을 씁니다."}\n' % AS_OF.isoformat(),
        encoding="utf-8")
    write("lines.csv", ["line_id", "line_name", "fab", "node", "tech"], [list(l) for l in LINES])
    write("products.csv", ["product_id", "product_name", "line_id", "node", "family_code", "family_name", "flow_type", "wip_wafers", "grade", "audit_reasons", "mass_prod_start"], prod_rows)
    print("안정 공법(양호 예시):", ", ".join(sorted(clean)))
    write("process_flow.csv", ["product_id", "seq", "step_id", "step_name", "stage", "module", "param", "unit", "step_grade", "critical", "recipe_id", "meas_step_id", "meas_step_name"], flow_rows)
    write("target_standards.csv", ["product_id", "step_id", "param", "unit", "target", "lsl", "usl", "lcl", "ucl", "rev", "effective_from", "owner"], tgt_rows)
    write("target_changes.csv", ["change_id", "product_id", "step_id", "param", "rev", "changed_at", "target_before", "target_after", "lsl_before", "lsl_after", "usl_before", "usl_after", "reason", "requested_by", "approved_by", "ecn_no"], tchg_rows)
    write("equipment.csv", ["eqp_id", "eqp_model", "maker", "module", "line_id", "status", "pm_cycle_days", "last_pm_at"],
          [[e["eqp_id"], e["eqp_model"], e["maker"], e["module"], e["line_id"], e["status"], e["pm_cycle_days"], ts(e["last_pm_at"])] for e in equipment.values()])
    write("compat_equipment.csv", ["product_id", "step_id", "eqp_id", "qualified", "qual_date"], compat_rows)
    write("interlocks.csv", ["interlock_id", "eqp_id", "occurred_at", "il_code", "category", "severity", "description", "released_at", "release_type", "released_by", "lot_id", "product_id", "step_id"], il_rows)
    write("maintenance.csv", ["mt_id", "eqp_id", "mt_type", "start_at", "end_at", "reason", "parts", "qual_result", "qual_at", "lots_before_qual", "performed_by"], mt_rows)
    write("changes.csv", ["change_id", "eqp_id", "product_id", "step_id", "changed_at", "category", "item", "before", "after", "ecn_no", "requested_by", "approved_by", "approved_at", "verify_status"], ch_rows)
    write("spc_summary.csv", ["product_id", "step_id", "meas_step_id", "param", "n", "mean", "sigma_within", "sigma_overall", "cp", "cpk", "pp", "ppk", "ooc_30d", "oos_30d"], spc_rows)
    write("spc_by_eqp.csv", ["product_id", "step_id", "meas_step_id", "param", "eqp_id", "n", "mean", "sigma_within", "sigma_overall"], spc_eqp_rows)


def change_values(cat: str, item: str) -> tuple[str, str]:
    if cat == "레시피 파라미터":
        base = R.randint(20, 600)
        return f"{base}", f"{round(base * R.uniform(0.95, 1.06))}"
    if cat == "S/W 업데이트":
        v = R.randint(3, 9)
        return f"v{v}.{R.randint(0, 9)}.{R.randint(0, 9)}", f"v{v}.{R.randint(0, 9) + 1}.0"
    if cat == "FDC 한계 변경":
        b = R.randint(5, 40)
        return f"{b}", f"{b + R.choice([-2, -1, 1, 2])}"
    if cat == "인터락 조건 변경":
        return "수동 확인 후 해제", R.choice(["수동 확인 후 해제 (2인 확인)", "재시도 2회 후 정지"])
    return "기존 사양", "개선 사양"


if __name__ == "__main__":
    main()
