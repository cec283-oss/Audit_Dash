# AUDIT PREVIEW

**Pre-Audit Data & Insights** · 내부 Audit 을 위한 공정·설비 데이터 점검

**라인 → 노드 → 공정(옵션 계열) → 재공 상위 5개 공법(제품)** 순으로 좁혀 들어가, 고른 공법의
**공정흐름도 · 타겟표준 · 인터락 이력 · PM/BM 이력 · 변경 이력**을 한 화면에 모아 내부 Audit 리스크 포인트를 판정합니다.
Top 5 밖 공법은 **직접 조회** 입력창에 ID나 이름을 넣으면 백엔드에서 바로 뽑아 옵니다. (FAB TRACE 와 같은 디자인·제품 체계)

화면은 두 단계입니다.
- **요약 페이지** (`#p-<공법ID>`)
  1. **기본 정보**: 재공·순위, 총 스텝, A/B/C 등급 스텝, 타겟 관리 스텝, 호환설비·모델 수, 리스크 지수, **원본 데이터 전체 ZIP**
  2. **Risk point 점검 카드 6개**: 타겟표준 · 공정능력 · 인터락 · PM/BM · 변경관리 · 호환설비 구성. 0건이면 초록, 리스크가 있으면 빨강. 규칙별 통과/위반 표시
  3. **공정 라우트**: 전체 스텝 리스크 띠(수천 스텝 대응), 스테이지 흐름도, 스테이지를 누르면 그 블록의 스텝 노드
  4. 리스크 포인트 목록 · 호환설비 집계 · 이력 타임라인
- **상세 페이지** (`#<항목>-<공법ID>`, 예: `#il-3G-1-02`)
  - 항목: 리스크 포인트 · 공정흐름 · 타겟표준·SPC · 스펙 개정 · 호환설비 · 인터락 · PM/BM · 변경 이력
  - 필터: 스테이지 · 스텝 · 설비/모델 · 기간
  - 표는 **서버에서 필터·검색·정렬·페이지 처리** (대용량 대응). **현재 페이지 CSV**와 **전체 원본 CSV(서버 스트리밍)** 제공

> **실데이터로 교체하려면 [docs/REAL_DATA_GUIDE.md](docs/REAL_DATA_GUIDE.md) 부터 보세요** (설치 → 추출 → `python scripts/check_data.py` 검증 → 실행 → 빠지는/늘어나는 테이블·컬럼 처리). 점검 항목·규칙 추가와 판정 기준값은 [docs/EXTENDING.md](docs/EXTENDING.md).

- 공정 데이터는 **공법(제품)** 기준으로 조회
- 설비 데이터는 그 공법의 **호환설비** 또는 **호환설비 모델** 기준으로 집계
- 16개 규칙으로 리스크 포인트를 만들고 0–100 지수로 환산 (판정 기준은 화면 우측 상단 `판정 기준`)

> 샘플 데이터의 회사·제품·설비 모델·인명은 모두 가상입니다. 실데이터 교체는 [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md),
> 감사 대상 공법 선정 근거는 [docs/AUDIT_TARGETS.md](docs/AUDIT_TARGETS.md) 를 보세요.

## 구성

```
backend/   FastAPI · 저장소 어댑터(CSV / SQL) · 리스크 판정 엔진 · pytest
  app/repository/csv_repo.py   CSV 12개를 읽음 (기본)
  app/repository/sql_repo.py   사내 DB 직접 조회 템플릿
  app/services/risk.py         규칙·가중치·공법 도시에(dossier) 생성
  data/sample/                 샘플 CSV (scripts/generate_sample.py 로 재생성)
frontend/  React 18 + Vite + TypeScript
  React Flow (공정흐름도) · ECharts (레이더·설비 집계·이벤트 스윔레인) · TanStack Query
  src/mock/bundle.json         백엔드 없이 도는 데모용 스냅샷 (scripts/export_static.py)
docs/      실데이터 교체 가이드(REAL_DATA_GUIDE), 데이터 계약, 확장·기준값, 감사 대상 공법
```

## 실행

```bash
# 백엔드
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000        # http://localhost:8000/docs

# 프론트엔드 (다른 터미널)
cd frontend
npm install
npm run dev            # http://localhost:5173  (/api → :8000 프록시)
npm run dev:mock       # 백엔드 없이 샘플 스냅샷으로
```

### 배포 (서버 한 대)
```bash
cd frontend && npm run build          # frontend/dist 생성
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```
`frontend/dist` 가 있으면 FastAPI 가 화면까지 같이 제공합니다. 사내 서버에는 Node 가 필요 없습니다.

### HTML 단일 파일 검증
```bash
cd frontend && npm run build:demo     # frontend/dist-demo/index.html (데이터 포함, 공정별 재공 상위 2개 공법 상세)
```
더블클릭으로 열립니다(`file://`). 부팅 애니메이션을 건너뛰려면 주소 뒤에 `?noboot`, 특정 공법은 `#p-4F-P-01` 처럼 붙입니다.

### 데이터 갱신 흐름
```bash
cd backend
python scripts/generate_sample.py     # 샘플 CSV 재생성 (실데이터에는 쓰지 않음)
python scripts/export_static.py       # 데모 스냅샷(frontend/src/mock/bundle.json) 갱신
python -m pytest -q
```

## 설정 (`backend/.env`, 예시는 `.env.example`)
| 변수 | 기본값 | 설명 |
|---|---|---|
| DATA_SOURCE | csv | `csv` 또는 `sql` |
| DATA_DIR | backend/data/sample | CSV 폴더 |
| DB_URL | | SQLAlchemy URL (sql 일 때) |
| WINDOW_DAYS | 90 | 이력 집계 기간 |
| RECENT_DAYS | 30 | 반복·강제 해제 판정 기간 |
| CORS_ORIGINS | localhost:5173 | 개발 서버 |
| WARMUP | 1 | 서버 시작 시 전 공법 사전 계산 (0이면 끔) |
| EVENT_CAP | 3000 | 요약 화면에 싣는 공법당 이벤트 최대 건수 (표·CSV 는 전체) |

## API
| 경로 | 내용 |
|---|---|
| `GET /api/meta` | 라인 → 노드 → 공정 계층(공법 수·재공), 공법 목록(가벼운 형태), 판정 규칙 |
| `GET /api/overview` | 종합 대시보드: 전 공법 리스크 지수·등급·대분류/점검 항목별 Risk point 건수, 전사 치명·높음 포인트, 규칙별 빈도 |
| `GET /api/categories/{cat}` | 점검 항목 하나의 전 공법 집계: 공법별 Worst/Best, 판정 규칙별 건수, Risk point, 실제 이력(영향 공법·판정 포함) |
| `GET /api/categories/{cat}/export.csv?kind=…` | 위 집계의 전체 CSV (`kind` = events 이력 · points Risk point · products 공법별, 화면 상한과 무관) |
| `GET /api/top?family=4F-P&node=N4&n=5` | 공정 안 재공 상위 n개 공법과 각 공법의 리스크 요약 |
| `GET /api/products/search?q=mote` | 공법 직접 조회 (ID·이름·공정 코드 부분 일치) |
| `GET /api/products/{id}/records/{item}` | 상세 표 (서버 필터·검색·정렬·페이지). stage·step·eqp·model·start·end·q·flag·sort·desc·offset·limit |
| `GET /api/products/{id}/export/{item}.csv` | 상세 항목 전체 컬럼 CSV (스트리밍, 위와 같은 필터). item = risk·flow·target·spec·eqp·il·pmbm·chg |
| `GET /api/products/{id}/raw.zip` | 공법 하나의 원본 테이블 9개 (CSV ZIP) |
| `GET /api/products/{id}/dossier?window=90` | 공정흐름·타겟표준·SPC·호환설비 집계·인터락/PMBM/변경/스펙 이력·리스크 포인트 |
| `GET /api/health` | 상태 |
