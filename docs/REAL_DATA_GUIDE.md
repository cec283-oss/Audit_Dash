# 실데이터 교체 가이드 (사내망 적용)

AUDIT PREVIEW 는 샘플 CSV 로 동작합니다. 이 문서는 **사내 실데이터로 바꿔 끼우는 전 과정**을 순서대로 정리합니다.
실데이터에는 샘플보다 **없는 테이블·컬럼, 더 많은 항목**이 있을 것을 전제로, 빠진 경우와 늘어난 경우를 각각 어떻게 처리하는지 함께 적었습니다.

> 관련 문서
> - 테이블·컬럼 정의 (계약서): [`DATA_CONTRACT.md`](DATA_CONTRACT.md)
> - 점검 항목·규칙 추가, 판정 기준값, 대용량 운영: [`EXTENDING.md`](EXTENDING.md)
> - 감사 대상 공법 선정 기준: [`AUDIT_TARGETS.md`](AUDIT_TARGETS.md)

---

## 0. 한눈에 보기

```
① 사내망에 코드 복사 · 설치          (1장)
② 실데이터 CSV 추출 (또는 DB 직접 연결)   (2장 / 5장)
③ 검증 스크립트로 점검              python scripts/check_data.py <폴더>   (3장)
④ .env 에 DATA_DIR 지정 → 서버 실행     (4장)
⑤ 화면 확인 → 기준값·항목 조정          (6~8장)
⑥ (선택) 데모 HTML 재생성             (9장)
```

필수 테이블은 **3개**(`lines`, `products`, `process_flow`)뿐입니다. 나머지는 없으면 그 점검 항목만 **"데이터 연결 예정"** 으로 표시되고, 화면은 그대로 동작합니다.

---

## 1. 사내망 설치

| 구성 | 버전 | 비고 |
|---|---|---|
| Python | 3.10 이상 | `pip install -r backend/requirements.txt` (사내 PyPI 미러) |
| Node.js | 18 이상 | 화면을 다시 빌드할 때만 필요. `frontend/dist` 를 그대로 가져가면 Node 없이 동작 |
| DB 드라이버 | 선택 | DB 직접 연결 시 `sqlalchemy` + 드라이버 (예: `oracledb`, `pyodbc`) |

```bash
git clone <사내 저장소 또는 ZIP 복사> audit-preview
cd audit-preview/backend
pip install -r requirements.txt
# 화면 빌드 (Node 있는 PC 에서 한 번만)
cd ../frontend && npm ci && npm run build      # → frontend/dist
```

> 인터넷이 막혀 npm 설치가 어렵다면: 외부 PC 에서 `npm run build` 한 `frontend/dist` 폴더를 함께 복사하세요. 백엔드가 이 폴더를 그대로 서비스합니다.

---

## 2. 실데이터 CSV 만들기

### 2-1. 폴더 구성
저장소 **밖**(또는 `.gitignore` 된 `backend/data/real/`)에 둡니다. **실데이터를 git 에 올리지 마세요.**

```
D:/audit_data/2026-11-24/
  lines.csv  products.csv  process_flow.csv            ← 필수
  target_standards.csv  target_changes.csv  spc_summary.csv  spc_by_eqp.csv
  equipment.csv  compat_equipment.csv
  interlocks.csv  maintenance.csv  changes.csv
  meta.json                                            ← 선택: {"as_of": "2026-11-24T09:00"} 기준 시각
```

- 인코딩: **UTF-8** (BOM 있어도 됨). Excel 에서 저장하면 CP949 가 될 수 있으니 "CSV UTF-8" 로 저장.
- 날짜·시각: `2026-11-24 09:00`, `2026-11-24T09:00`, `2026/11/24 09:00` 모두 읽음.
- Y/N 컬럼: `Y/N`, `1/0`, `TRUE/FALSE` 모두 읽음.
- 첫 줄은 컬럼명. **컬럼 순서는 상관없음**, 이름만 맞으면 됩니다.
- `meta.json` 이 없으면 서버 시각이 기준 시각이 됩니다. 과거 스냅샷을 볼 때는 꼭 넣으세요 (최근 30·90일 계산 기준).

### 2-2. 테이블별 추출 매핑 (사내 시스템 예시)

| CSV | 필수 | 사내 원천 (예시) | 핵심 컬럼 |
|---|---|---|---|
| `lines` | ✓ | MES 라인 마스터 | line_id, line_name, fab, node, tech |
| `products` | ✓ | MES 제품 마스터 + 현재 재공(WIP) 합계 | product_id, product_name, line_id, node, family_code, family_name, wip_wafers, grade |
| `process_flow` | ✓ | MES 라우트(공정흐름) | product_id, seq, step_id, step_name, module, stage, step_grade, recipe_id, **meas_step_id** |
| `target_standards` | | SPC 타겟표준 (최신 Rev) | product_id, step_id, param, target, lsl, usl, **lcl, ucl**, rev |
| `target_changes` | | 타겟표준 개정 이력 | change_id, product_id, step_id, rev, changed_at, *_before/*_after, requested_by, approved_by |
| `spc_summary` | | SPC 30일 요약 (공정 스텝 단위) | product_id, step_id, n, mean, **sigma_within, sigma_overall**, cp, cpk, pp, ppk, ooc_30d, oos_30d |
| `spc_by_eqp` | | SPC 원시값 × LOT 이력(진행 설비) 조인 요약 | product_id, step_id, **eqp_id**, n, mean, sigma_within, sigma_overall |
| `equipment` | | EES 설비 마스터 | eqp_id, eqp_model, maker, module, status, pm_cycle_days, last_pm_at |
| `compat_equipment` | | 레시피·설비 인증(호환설비) | product_id, step_id, eqp_id, qualified, qual_date |
| `interlocks` | | EES 인터락 이력 | interlock_id, eqp_id, il_code, occurred_at, released_at, release_type, released_by |
| `maintenance` | | PM/BM 이력 | mt_id, eqp_id, mt_type, start_at, end_at, qual_result, qual_at, lots_before_qual |
| `changes` | | 설비·레시피 변경(ECN) 이력 | change_id, category, eqp_id, changed_at, requested_by, approved_by, verify_status |

컬럼별 상세 정의·판정에 쓰이는 방식은 [`DATA_CONTRACT.md`](DATA_CONTRACT.md) 를 보세요.

### 2-3. 꼭 맞춰야 하는 값 (안 맞으면 집계가 비어 보임)
- **ID 일치**: `process_flow.step_id` = `target_standards/spc_summary/compat_equipment.step_id`, `equipment.eqp_id` = 이력 테이블의 `eqp_id`. 공백·대소문자까지 같아야 합니다.
- **`spc_summary` 의 step_id 는 공정 스텝 기준**입니다. 사내 SPC 가 계측 스텝 기준이면 `process_flow.meas_step_id` 로 역매핑해서 공정 스텝 ID 로 바꿔 넣으세요 (`meas_step_id` 컬럼에는 원래 계측 스텝 ID).
- **`spc_by_eqp`** 는 "이 계측값의 LOT 이 해당 공정 스텝을 **어느 설비**에서 진행했는가"로 묶은 값입니다. 계측 설비가 아니라 **공정 설비** 기준입니다.
- **`changes.category`** 가 `FDC 한계 변경`, `인터락 조건 변경`, `NPW 기준 변경` 이면 "FDC/NPW 이상감지 기준정보" 항목으로 분류됩니다. 사내 분류명이 다르면 `backend/app/services/catalog.py` 의 `DETECT_CHANGE` 와 `risk.py` 의 `CRITERIA_CHANGE` 판정 부분 분류명을 맞추세요.
- **`interlocks.release_type`** 이 `강제 해제` 여야 강제 해제 규칙이 동작합니다. 사내 값(예: `FORCE`)이면 추출 SQL 에서 바꾸거나 `risk.py` 에서 비교 문자열을 바꾸세요.

---

## 3. 검증 스크립트로 먼저 점검

```bash
cd backend
python scripts/check_data.py D:/audit_data/2026-11-24
```

출력 예:
```
✓ products.csv  1,240행
△ target_standards.csv  18,330행
   △ 선택 컬럼 없음 (빈 값으로 처리): lcl, ucl
   ・ 모르는 컬럼 (무시됨): spec_owner_dept
△ spc_by_eqp.csv 없음 — 선택. 화면에서 '데이터 연결 예정' 이 되는 항목: 설비별 출력 매칭 (TTTM)
■ 참조 무결성
△ compat_equipment.eqp_id 가 equipment 에 있음: 37 / 52,110
■ 화면 영향
・ 관리한계(lcl/ucl) 없음 → 시뮬레이터가 평균 ± 3σ군내 로 추정
결과: 오류 0 · 경고 3  →  사용 가능
```

| 표시 | 의미 | 할 일 |
|---|---|---|
| ✕ | 필수 테이블·필수 컬럼 없음, 형식 오류 | 반드시 고친 뒤 다시 실행 (종료 코드 1) |
| △ | 선택 테이블·컬럼 없음, 참조 불일치 | 화면은 동작. 해당 항목만 비거나 추정값 사용 |
| ・ | 모르는 컬럼 | 무시됨. 쓰고 싶으면 7장 참고 |

---

## 4. 실행

`backend/.env` (없으면 `.env.example` 복사):
```ini
DATA_SOURCE=csv
DATA_DIR=D:/audit_data/2026-11-24
WINDOW_DAYS=90        # 이력 집계 기간
RECENT_DAYS=30        # '최근' 기준 (인터락 반복·BM 반복 등)
EVENT_CAP=3000        # 화면에 싣는 이력 건수 상한 (CSV 는 전체)
WARMUP=1              # 서버 시작 시 전 공법 미리 계산
```
```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
# 브라우저: http://<서버>:8000
```

- **CSV 를 덮어쓰면 다음 요청에서 자동으로 다시 읽습니다** (파일 수정 시각 감지). 서버 재시작 불필요.
- 첫 로딩이 느리면 `backend/.cache/` 를 지우지 말고 두세요. 파싱 결과 캐시라 재시작 후 즉시 뜹니다.
- 날짜별 스냅샷 폴더를 바꿔 가며 볼 때는 `DATA_DIR` 만 바꾸고 재시작.

---

## 5. DB 직접 연결 (CSV 대신)

```ini
DATA_SOURCE=sql
DB_URL=oracle+oracledb://user:pass@host:1521/?service_name=MESDB
```
- 쿼리는 `backend/app/repository/sql_repo.py` 의 `QUERIES` 에 테이블별로 있습니다. **컬럼 별칭(AS)을 CSV 컬럼명과 같게** 맞추면 나머지 코드는 그대로입니다.
- **사내에 없는 테이블은 쿼리를 비워 두세요** (`"interlocks": None`). 그 항목은 "데이터 연결 예정" 으로 표시됩니다.
- 무거운 쿼리(SPC 원시값 × LOT 조인)는 DB 에 30일 요약 테이블/뷰(`SPC_STEP_SUMMARY_30D`, `SPC_STEP_BY_EQP_30D`)를 만들어 두고 그걸 읽는 것을 권장합니다.
- 계정 정보는 `.env` 에만 두고 git 에 올리지 마세요 (`.gitignore` 에 포함됨).

---

## 6. 실데이터에서 **빠지는 것** 처리

### 6-1. 테이블이 없을 때 (자동 처리)
파일을 안 넣으면(또는 SQL 쿼리를 비우면) 아래처럼 동작합니다. 코드 수정 불필요.

| 없는 테이블 | "데이터 연결 예정" 이 되는 점검 항목 | 그 외 영향 |
|---|---|---|
| `target_changes` | 타겟표준 | 스펙 개정 이력 탭이 빈 표 |
| `target_standards` | 타겟표준 · 공정능력 · TTTM | 공정능력 화면·시뮬레이터 비활성 |
| `spc_summary` | 공정능력 · TTTM | 공정능력 카드 비활성 |
| `spc_by_eqp` | 설비별 출력 매칭 (TTTM) | TTTM 표·맵 숨김, 시뮬레이터 설비표 없음 |
| `equipment` / `compat_equipment` | 인터락 · PM/BM · 호환설비 구성 | 설비 패널 비어 있음 |
| `interlocks` | 인터락 | 인터락 탭 빈 표 |
| `maintenance` | PM/BM | PM/BM 탭 빈 표 |
| `changes` | 설비·레시피 변경 · FDC/NPW 기준정보 | 변경 탭 빈 표 |

이 연결 관계는 `backend/app/services/risk.py` 의 `CAT_TABLES` 에 있습니다. 화면의 회색 "데이터 연결 예정" 카드와 종합 화면 막대에 이유(`원천 테이블 없음: interlocks`)가 표시됩니다.

### 6-2. 컬럼이 없을 때 (자동 처리)
- **필수 컬럼**(DATA_CONTRACT 의 "필수")이 없으면 서버가 오류를 냅니다 → 추출 SQL 에 추가하세요.
- **선택 컬럼**이 없으면 빈 값으로 처리되고, 아래처럼 대체됩니다.

| 없는 컬럼 | 대체 동작 |
|---|---|
| `process_flow.stage` | 같은 모듈이 이어지는 구간을 한 스테이지로 자동 묶음 |
| `process_flow.step_grade` | critical=Y → A, 타겟표준 있음 → B, 나머지 C |
| `process_flow.meas_step_id` | 공정흐름 표의 계측 스텝 행·연결 스텝 표시 없음 |
| `target_standards.lcl/ucl` | 시뮬레이터 C/L 을 평균 ± 3σ군내 로 추정 |
| `spc_summary.cp/cpk/pp/ppk` | LSL·USL 과 σ 로 계산 |
| `spc_summary.sigma_overall` | 군내 σ 로 대체 → Pp=Cp, Ppk=Cpk (장기 공정능력 저하 판정은 사실상 꺼짐) |
| `spc_summary.sigma_within` | 예전 형식 `sigma` 컬럼이 있으면 그것을 사용 |
| `products.wip_wafers` | 0 → 재공 Top 5 순서가 의미 없어짐 (꼭 넣기 권장) |
| `equipment.pm_cycle_days/last_pm_at` | PM 주기 초과 판정 안 함 |
| `maintenance.lots_before_qual` | Qual 전 LOT 진행 판정 안 함 |

### 6-3. 점검 항목·규칙 자체를 빼고 싶을 때
- **규칙 하나 끄기**: `risk.py` 의 `RULES` 에서 해당 `Rule(...)` 줄을 지우거나 주석 처리. 카드에서 그 규칙 줄이 사라집니다.
- **점검 항목(카드) 빼기**: `risk.py` 의 `GROUPS[].cats` 와 `CATEGORIES` 에서 키를 지우고, 그 카테고리 규칙도 함께 삭제. 프론트는 `frontend/src/lib.ts` 의 `CAT_ORDER`·`CAT_NAME`, `types.ts` 의 `Category` 에서도 지우면 타입 검사가 깔끔합니다.
- **대분류 빼기/이름 바꾸기**: `GROUPS` 만 수정 (화면은 자동).

---

## 7. 실데이터에서 **늘어나는 것** 처리

### 7-1. 컬럼이 더 있을 때
- 모르는 컬럼은 **무시**되므로 그대로 넣어도 됩니다.
- 화면에 보이게 하려면: `backend/app/schemas.py` 해당 모델에 필드 추가 (예: `spec_owner_dept: OptStr = None`) → 응답에 자동 포함 → 표 컬럼은 `frontend/src/components/detail/columns.tsx` 의 `buildCols()` 에 한 줄 추가.
- 항목별 집계 페이지 이력 표는 `frontend/src/components/CategoryPage.tsx` 의 `EVENT_COLS` 에 컬럼 추가.

### 7-2. 값(코드)이 더 많을 때
| 늘어나는 것 | 어디서 맞추나 | 안 맞추면 |
|---|---|---|
| 라인·노드·공정(family) | 데이터만 넣으면 자동 (탭·칩·히트맵 행이 늘어남) | - |
| 공정 모듈(`module`) 종류 | `frontend/src/lib.ts` 의 `MODULE_VAR` 에 색 추가 | 회색으로 표시 |
| 변경 분류(`changes.category`) | `risk.py` 판정 문자열, `catalog.py` 의 `DETECT_CHANGE` | 일반 변경으로 집계 |
| 스텝 등급 (A/B/C 외) | `risk.py` 의 `CPK_REQ` 에 등급 추가 | 요구 Cpk 1.33 으로 처리 |
| 제품 등급 (Automotive 등) | `risk.py` 의 `AUTOMOTIVE_ESCALATE` 대상 판정 | 차량용 상향 안 됨 |

### 7-3. 새 점검 항목·규칙·원천 테이블 (예: CTTTM, RACB, Q-time)
[`EXTENDING.md`](EXTENDING.md) 2장 순서를 따르세요. 요약:
1. `schemas.py` 모델 추가 → `csv_repo.py` 의 `TABLES` 와 조회 메서드, `sql_repo.py` 의 `QUERIES` 추가
2. `risk.py` : `CATEGORIES`·`GROUPS` 에 키, `CAT_TABLES` 에 필요한 테이블, `RULES` 에 규칙, `build_dossier()` 에 판정 로직
3. 항목별 집계 페이지 이력: `catalog.py` 의 `EVENT_SOURCE` 한 줄 + `CategoryPage.tsx` 의 `EVENT_COLS`
4. `python scripts/check_data.py` → `pytest` → 화면 확인

CTTTM·RACB 는 카드 자리가 이미 있으니 2단계부터 하면 됩니다.

---

## 8. 판정 기준값 조정 (실데이터 분포에 맞추기)
모든 숫자는 `backend/app/services/risk.py` 상단에 있고, 화면은 서버 값을 그대로 씁니다 → **서버 재시작만** 하면 반영.
자세한 표는 [`EXTENDING.md` 2-4장](EXTENDING.md) 참고. 실데이터 첫 적용 후 꼭 볼 것:

| 확인 | 조정 |
|---|---|
| 종합 화면 등급 분포가 한쪽(전부 위험/전부 양호)으로 쏠림 | 지수 환산값 `190` (클수록 지수 낮아짐) |
| TTTM 이상이 너무 많음/적음 | `TTTM_LIMIT` (현재 M/S 1.0 · S/R 1.2) |
| 공정능력 부족이 너무 많음 | `CPK_REQ` (A 1.67 · B 1.33 · C 1.00) |
| 인터락 반복·BM 반복 기준 | `RECENT_DAYS`, `build_dossier()` 안 반복 횟수 |

조정 후 `pytest` 의 일부 테스트(샘플 데이터의 심어 둔 사례 기대값)가 실패할 수 있습니다. 실데이터 운영 서버에서는 테스트를 샘플 데이터(`DATA_DIR` 미지정)로 돌리면 됩니다.

---

## 9. 데모 HTML (서버 없이 보는 단일 파일)
실데이터로 데모 파일을 만들 때 — **사내 정보가 파일에 그대로 들어가므로 외부 반출 금지**.
```bash
cd backend && python scripts/export_static.py     # DATA_DIR 의 데이터로 스냅샷 생성
cd ../frontend && npm run build:demo               # → frontend/dist-demo/index.html
```
- 공법이 많으면 파일이 커집니다. `export_static.py` 의 `DEMO_PER_FAMILY`(공정별 상세 포함 공법 수), `DEMO_EVENTS`(항목별 이력 상한)를 줄이세요.

---

## 10. 문제 해결

| 증상 | 원인 · 조치 |
|---|---|
| 서버 시작 시 `xxx.csv 3행을 읽지 못했습니다` | 그 행의 필수값이 비었거나 숫자 컬럼에 문자. `check_data.py` 로 위치 확인 |
| 화면이 비어 있고 "데이터를 불러오지 못했습니다" | 필수 테이블 없음 또는 `DATA_DIR` 경로 오타. `/api/health` 확인 |
| 공법은 보이는데 공정능력·설비가 전부 0 | `step_id`/`eqp_id` 불일치. `check_data.py` 의 참조 무결성 항목 확인 |
| 한글이 깨짐 | CSV 가 CP949. UTF-8 로 다시 저장 |
| 날짜 필터·최근 30일 집계가 이상함 | `meta.json` 의 `as_of` 가 실제 추출 시각과 다름 |
| CSV 를 바꿨는데 화면이 그대로 | 브라우저 강력 새로고침(Ctrl+F5). 서버는 파일 시각으로 자동 갱신 |
| 첫 화면까지 오래 걸림 | `WARMUP=1` 유지, `backend/.cache` 유지. 공법 수천 개면 `EVENT_CAP` 를 낮추기 |
| 특정 항목이 계속 "데이터 연결 예정" | 그 항목의 `CAT_TABLES` 테이블 중 하나가 없음. 카드 문구에 테이블명이 나옴 |

---

## 11. 체크리스트 (적용 순서)
- [ ] 실데이터 폴더는 저장소 밖 또는 `backend/data/real/` (git 제외)
- [ ] 필수 3개 테이블 추출 (`lines`, `products`, `process_flow`)
- [ ] `meta.json` 에 기준 시각
- [ ] `python scripts/check_data.py <폴더>` → 오류 0
- [ ] `.env` 의 `DATA_DIR` 지정 → 서버 실행 → `/api/health` 에서 warmup done 확인
- [ ] 종합 화면 등급 분포 확인 → 지수 환산값 조정
- [ ] 감사 대상 공법 3~5개를 골라 원천 시스템 화면과 숫자 대조 (재공, 인터락 건수, Cpk)
- [ ] TTTM·공정능력 기준값을 사내 기준으로 조정 (`risk.py`)
- [ ] 없는 테이블의 항목이 "데이터 연결 예정" 으로 뜨는지 확인 → 필요하면 7-3장으로 연결
