# 실데이터 적용 · 카테고리 확장 · 대용량 운영 가이드

샘플 데이터는 구조 확인용입니다. 사내망에서는 **데이터만 덮어쓰고**, 점검 카테고리가 더 많으면 **규칙 파일 한 곳**만 늘리면 되도록 짜 두었습니다.
컬럼 정의는 [DATA_CONTRACT.md](DATA_CONTRACT.md)에 있습니다.

---

## 1. 실데이터로 덮어쓰기 (순서)

1. **CSV 11개 추출**: 사내 DB에서 `docs/DATA_CONTRACT.md`의 컬럼명과 같게 뽑습니다. 컬럼이 더 있어도 무시되고, 순서는 상관없습니다.
2. **폴더 지정**: `backend/.env`에 `DATA_DIR=D:/audit-data/latest`를 넣습니다. 샘플용 `meta.json`은 넣지 마세요. 없으면 현재 시각이 기준이 됩니다.
3. **검증**: `python -m pytest -q`는 샘플 기준 테스트라 실데이터에서는 일부 값이 다를 수 있습니다. 대신 서버를 띄운 뒤 `/api/health`의 `warmup.done`과 `products`를 확인하세요.
   CSV 형식 오류가 있으면 화면과 API가 `파일명 N행을 읽지 못했습니다: 원인` 메시지를 보여 줍니다.
4. **정기 갱신**: 같은 폴더에 CSV를 덮어쓰면 끝입니다. 파일 수정 시각이 바뀌면 다음 요청 때 자동으로 다시 읽고 캐시를 새로 만듭니다(서버 재시작 불필요).
   여러 파일을 순서대로 덮어쓰는 동안 읽히지 않도록, **임시 폴더에 다 쓴 뒤 폴더를 바꿔치기**하는 방식을 권장합니다.
   (`latest_tmp` → `latest`. 또는 날짜별 폴더를 쓰고 `DATA_DIR`을 바꿔 재시작)

### DB 직접 조회로 바꾸려면
`DATA_SOURCE=sql`, `DB_URL=…`을 설정하고 `backend/app/repository/sql_repo.py`의 `QUERIES` SQL을 사내 테이블에 맞춥니다.
SELECT 별칭이 `app/schemas.py`의 필드명과 같기만 하면 화면과 규칙은 그대로 동작합니다.

### 공정 스테이지(`stage`)가 사내 데이터에 없을 때
- `stage` 컬럼을 비워 두면 **연속된 같은 모듈 구간**을 자동으로 한 블록으로 묶습니다(예: `03 식각`).
- 라우트 마스터에 레이어나 모듈 블록 코드(예: `STI`, `GATE`, `M1`)가 있으면 그 값을 `stage`로 넣는 것이 가장 보기 좋습니다.
- 스테이지는 한 공법당 20~60개 정도가 적당합니다. 수천 스텝이라도 화면은 스테이지 단위로 그리고, 펼친 스테이지의 스텝만 노드로 그립니다.

### 스텝 등급(`step_grade`)
`A`(핵심) / `B`(주요·계측) / `C`(일반)입니다. 비어 있으면 `critical=Y`는 A, 타겟표준이 있는 스텝은 B, 나머지는 C로 정합니다.
사내에 CTQ·Key Step 구분이 있으면 그 값으로 매핑하세요.

---

## 2. 점검 카테고리·규칙 추가하기

화면의 **Risk point 점검 카드**, **판정 기준 모달**, **리스크 포인트 목록**, **CSV**는 모두 `backend/app/services/risk.py` 한 파일의 정의에서 나옵니다.

### 2-0. 대분류 구조 (현재)

| 대분류 (`GROUPS`) | 점검 항목 (`CATEGORIES`) | 상태 |
|---|---|---|
| **공정 데이터** PROCESS DATA | 타겟표준 `spec` · 공정능력(SPC) `process` | 연결됨 |
| **설비 데이터** EQUIPMENT DATA | 인터락 `interlock` · FDC/NPW 이상감지 기준정보 `detect` · 호환설비 구성 `equip` | 연결됨 |
| **변경점** CHANGE POINTS | PM/BM `maint` · 설비·레시피 변경 `change` | 연결됨 |
| | CTTTM `cttm` · RACB `racb` | **데이터 연결 예정** (회색 카드) |

- 규칙이 하나도 없는 점검 항목은 화면에 "데이터 연결 예정" 회색 카드로 나옵니다.
- 규칙을 하나라도 추가하면 그때부터 초록·빨강으로 판정됩니다.

**CTTTM·RACB 연결 순서** (예시는 CTTTM)
1. `app/schemas.py`에 `CtttmRecord` 모델을 추가합니다. 컬럼은 사내 테이블 기준이고, 최소한 `eqp_id`, 일시, 결과(PASS/FAIL 등), 승인자가 필요합니다.
2. `csv_repo.TABLES`에 `"ctttm": CtttmRecord`를 추가하고, `Repository`에 `ctttm(eqp_ids, since)` 메서드를 만듭니다. `sql_repo.QUERIES`에도 같은 쿼리를 둡니다.
3. `risk.py`의 `RULES`에 `Rule("CTTTM_FAIL", "CTTTM 불합격", "cttm", "HIGH", "…")` 같은 규칙을 추가하고, `build_dossier()`에서 `add("CTTTM_FAIL", …, kind="eqp")`로 판정합니다.
4. `CHECK_DETAIL["cttm"]`을 새 상세 페이지 키로 바꾸고, 필요하면 `EXPORT_ITEMS`와 프론트 `ITEMS`에 표를 추가합니다. 방법은 2-3과 같습니다.
5. `PENDING_NOTE`에서 `cttm`을 지웁니다.

### 2-1. 카테고리(점검 카드) 추가
```python
# backend/app/services/risk.py
GROUPS = [   # 대분류: 카드를 어느 묶음에 넣을지
    dict(key="process_data", name="공정 데이터", en="PROCESS DATA", desc="…", cats=["spec", "process"]),
    dict(key="equip_data",   name="설비 데이터", en="EQUIPMENT DATA", desc="…", cats=["interlock", "detect", "equip"]),
    dict(key="change_point", name="변경점",     en="CHANGE POINTS", desc="…", cats=["maint", "cttm", "racb", "change", "qtime"]),  # ← 추가
]
CATEGORIES = {..., "qtime": "Q-time"}             # 점검 항목 이름
CHECK_DETAIL = {..., "qtime": "il"}               # 카드를 눌렀을 때 열 상세 페이지
```
- 카드는 `CATEGORIES` 순서대로 자동으로 그려집니다. 프론트엔드 코드는 고칠 필요가 없습니다.
- 카드 아이콘을 따로 주려면 `frontend/src/components/RiskChecks.tsx`의 `ICON`에 같은 키로 SVG path를 추가합니다. 없으면 기본 모양이 나옵니다.
- 카드 아래 "점검 근거" 문구는 `build_dossier()` 안의 `basis` 딕셔너리에 같은 키로 추가합니다.
- 프론트엔드 `frontend/src/lib.ts`의 `CAT_ORDER`·`CAT_NAME`과 `types.ts`의 `Category`에도 같은 키를 넣어야 타입 검사가 통과합니다.

#### 항목별 전체 집계 페이지 (`#cat-<키>`, `GET /api/categories/<키>`)
종합 화면의 대분류·항목, 히트맵 열 머리글을 누르면 열리는 페이지입니다. 항목 하나를 전 공법에 걸쳐 Worst/Best, 판정 규칙별 건수, 공법별 Risk point 분포, **실제 이력**(영향 공법 포함), Risk point 전체로 보여 줍니다. 새 항목의 실제 이력을 붙이려면 두 곳만 고칩니다.
```python
# backend/app/services/catalog.py — 이력 원천: (dossier 키, ID 컬럼, 시각 컬럼)
EVENT_SOURCE = {..., "qtime": ("qtime_events", "qt_id", "occurred_at")}
```
```ts
// frontend/src/components/CategoryPage.tsx — 화면 컬럼 [키, 머리글, 옵션]
EVENT_COLS.qtime = [['occurred_at', '발생', { dt: true, mono: true }], ['eqp_id', '설비', { mono: true }], ...];
```
- `EVENT_COLS`에 없으면 이력 행의 모든 컬럼을 그대로 보여 줍니다.
- 이력 행이 Risk point의 `refs`(이벤트 ID)에 들어 있으면 그 행에 판정(치명·높음 등)이 붙고 "리스크 근거만" 필터에 잡힙니다. 규칙을 만들 때 근거 이벤트 ID를 `refs`에 넣어 주세요.
- 설비 이력은 그 설비를 호환설비로 쓰는 모든 공법에 함께 집계되고, 이력 한 줄에 "영향 공법"이 붙습니다.
- 화면에는 리스크 근거·최근 순으로 `EVENT_CAP`(기본 3000)건까지만 싣고, 전체는 `export.csv?kind=events|points|products`로 받습니다.

### 2-2. 규칙 추가 (예: 레시피 버전 불일치)
```python
RULES = {r.code: r for r in [
    ...,
    Rule("RECIPE_MISMATCH", "레시피 버전 불일치", "recipe", "HIGH", "MES 레시피와 설비 레시피 버전이 다름"),
]}
```
그리고 `build_dossier()` 안에서 판정 결과를 `add()`로 넣습니다.
```python
for r in repo.recipe_versions(product_id):           # 새 데이터 소스 (2-3 참고)
    if r.mes_ver != r.tool_ver:
        add("RECIPE_MISMATCH", [r.step_id], f"{r.step_id} 레시피 {r.mes_ver} ≠ {r.tool_ver}",
            f"설비 {r.eqp_id} · 확인 {r.checked_at:%m-%d}", refs=[r.id], eqp=r.eqp_id,
            at=r.checked_at, kind="step")   # 스텝 자체 문제면 "step", 설비 문제면 "eqp"
```
- `kind="step"`이면 라우트 띠의 **공정 리스크** 줄에, `kind="eqp"`면 **설비 노출** 줄에 칠해집니다.
- 여러 스텝에 반복되는 규칙은 설비나 조합 단위로 묶어 한 건으로 만드세요(예: `SINGLE_TOOL`은 설비별로 묶음). 그래야 지수가 부풀지 않습니다.
- 심각도 가중치(`SEV_W`)와 지수 환산식(`index = 100 × (1 − e^(−합/190))`)도 같은 파일에 있습니다. 실데이터 분포를 보고 `190`을 조정하세요 (종합 대시보드에서 위험·경고·주의·양호가 고르게 갈리도록).

### 2-3. 새 원천 테이블 추가 (예: 레시피 버전, Q-time, 계측 원시값)
1. `app/schemas.py`에 모델을 추가합니다. 필드명이 곧 CSV·SQL 컬럼명입니다.
2. `app/repository/csv_repo.py`의 `TABLES`에 `"recipe_versions": RecipeVersion`을 추가하고, 조회 메서드를 만듭니다. 공법 단위 데이터면 `_by_product`를 쓰세요.
3. `app/repository/base.py`의 `Repository`와 `sql_repo.py`의 `QUERIES`에도 같은 메서드와 SQL을 추가합니다.
4. 상세 페이지 표가 필요하면 다음 순서로 추가합니다.
   - `main.py`의 `EXPORT_ITEMS`에 항목 키를 추가합니다. 그러면 `/records/{item}`과 `/export/{item}.csv`가 자동으로 생깁니다.
   - `frontend/src/components/detail/columns.tsx`의 `ITEMS`와 `buildCols()`에 컬럼을 정의합니다.
   - 원본 ZIP에도 넣으려면 `main.py`의 `RAW_TABLES`에 추가합니다.

### 2-4. 판정 기준값 바꾸기 (한 곳만 고치면 화면까지 반영)
판정에 쓰는 숫자는 모두 `backend/app/services/risk.py` 맨 위쪽 상수에 있습니다. 공정능력·TTTM 기준은 dossier 응답의 `limits`로 화면에 그대로 전달되므로 **프론트엔드는 고칠 필요가 없습니다** (표 색, 매칭 맵 기준선·초록 영역, 안내 문구가 같이 바뀜). 고친 뒤 서버만 재시작하면 됩니다. 데모 HTML은 `python scripts/export_static.py` → `npm run build:demo`를 다시 실행하세요.

| 항목 | 상수 | 현재 값 | 의미 |
|---|---|---|---|
| 설비 출력 매칭 M/S | `TTTM_LIMIT["ms_med"]` / `["ms_high"]` | **1.0** / 1.5 | \|설비 평균 − 나머지 설비 평균\| / 나머지 σ군내 가 이 값 이상이면 이상(보통) / 높음 |
| 설비 출력 매칭 S/R | `TTTM_LIMIT["sr_med"]` / `["sr_high"]` | **1.2** / 1.5 | 설비 σ군내 / 나머지 σ군내 가 이 값 이상이면 이상(보통) / 높음 |
| TTTM A등급 상향 | `build_dossier()` 안 `a_up` | A등급 스텝은 한 단계 상향 | 끄려면 `a_up = False` |
| 등급별 요구 Cpk | `CPK_REQ` | A 1.67 · B 1.33 · C 1.00 | Cpk 가 미만이면 "공정능력 부족", 1.0 미만은 치명 |
| 장기 공정능력 | `PPK_LIMIT["med"]` / `["high"]` | 1.33 / 1.0 | Cpk 충족인데 Ppk 가 med 미만이면 "장기 공정능력 저하", high 미만이면 높음 |
| 리스크 지수 환산 | `index = 100 × (1 − e^(−합/190))` | 190 | 클수록 지수가 낮게 나옴 |
| 등급 구간 | `level_of()` | 위험 ≥75 · 경고 ≥55 · 주의 ≥35 · 양호 | 종합 화면·카드 색 |
| 심각도 가중치 | `SEV_W` | 치명 12 · 높음 6 · 보통 3 · 낮음 1 | 지수 합산 가중치 |
| 화면 이벤트 상한 | `.env`의 `EVENT_CAP` | 3000 | 화면에 싣는 이력 건수 (CSV 는 전체) |

예) TTTM 기준을 M/S 0.8 · S/R 1.3 으로 바꾸려면:
```python
TTTM_LIMIT = dict(ms_med=0.8, ms_high=1.5, sr_med=1.3, sr_high=1.5)
```
M/S 의 비교 기준(지금은 "나머지 설비 평균")을 골든 설비로 바꾸려면 `build_dossier()`의 `# ── 설비별 출력 매칭 (TTTM)` 블록에서 `others` 를 골든 설비 목록으로 바꾸면 됩니다.

---

## 3. 대용량 데이터에서 빠르게 유지하기

| 구간 | 지금 구조 | 데이터가 더 커지면 |
|---|---|---|
| 적재 | CSV를 한 번 파싱해 `backend/.cache/*.pkl`로 저장. 재시작하면 캐시에서 바로 로드 | CSV 대신 Parquet. `pyarrow`로 읽도록 `csv_repo` 교체를 권장 |
| 계산 | 서버 시작 직후 **모든 공법 도시에를 백그라운드에서 미리 계산** (`WARMUP=1`) | 공법 수천 개면 재공 상위 공법만 워밍업하고 나머지는 요청 시 계산 (`main._warmup` 수정) |
| 화면 응답 | gzip + orjson. 이벤트는 공법당 최근 `EVENT_CAP`(기본 3,000)건만 화면에 전송 | `EVENT_CAP`을 낮추면 요약 응답이 더 가벼워짐. 표·CSV는 영향 없음 |
| 상세 표 | 서버에서 필터·검색·정렬·페이지 처리 (`/records`, 100행씩) | 그대로 유지. 페이지 크기만 조정 |
| CSV | 서버 **스트리밍** (`/export/{item}.csv`). 첫 바이트가 바로 나감 | 그대로 유지 |
| 원본 ZIP | 공법 하나의 원천 테이블 9개 | 매우 크면 기간 파라미터 추가 권장 (`raw_zip`) |
| 정적 파일 | 해시 파일명 + 1년 캐시 | 그대로 유지 |

### SQL 모드에서
- `interlocks`, `maintenance`, `changes`는 `eqp_id IN (...) AND 시각 >= :since`로 조회합니다. **(eqp_id, 시각) 복합 인덱스**가 꼭 필요합니다.
- `process_flow`, `compat_equipment`, `target_*`, `spc_summary`는 `product_id` 인덱스가 필요합니다.
- 공법 하나에 호환설비가 수천 대라 `IN` 목록이 너무 길어지면, 임시 테이블이나 조인으로 바꾸세요.
- 이 경우 `sql_repo.py`의 해당 쿼리만 수정하면 됩니다.
- 매번 DB를 치지 않도록 `main._dossier_cached`의 캐시 키에 "데이터 갱신 시각"을 넣으세요. `_sig()`에서 배치 완료 시각을 조회해 반환하면 됩니다.

### 서버 여러 개로 늘리기
`uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4`로 띄우면 됩니다. 워커마다 캐시를 따로 가지므로 메모리는 워커 수만큼 늘어납니다.

### 측정값 (샘플 데이터, 노트북 기준)
- 공법 70개 × 스텝 340~419 · 호환설비 행 6만 개
- 서버 시작 후 전 공법 사전 계산: 2.6초
- 공법 상세 응답: 11ms (56KB gzip)
- 서버 페이지 표: 6ms · 스텝 CSV: 16ms · 원본 ZIP: 27ms
