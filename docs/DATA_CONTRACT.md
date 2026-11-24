# 데이터 계약 (실데이터 교체 가이드)

화면과 리스크 판정 로직은 아래 11개 테이블만 봅니다. 사내망에서는 둘 중 하나로 바꾸면 됩니다.

| 방법 | 할 일 |
|---|---|
| **A. CSV 덮어쓰기** (가장 빠름) | 사내 DB에서 아래 컬럼 그대로 CSV로 추출 → 폴더에 넣고 `backend/.env` 에 `DATA_DIR=그 폴더` |
| **B. DB 직접 조회** | `pip install sqlalchemy <드라이버>` → `.env` 에 `DATA_SOURCE=sql`, `DB_URL=...` → `backend/app/repository/sql_repo.py` 의 `QUERIES` SQL을 사내 테이블에 맞게 수정 (SELECT 별칭을 아래 컬럼명과 같게) |

- 인코딩: UTF-8 (BOM 있어도 됨). 날짜: `YYYY-MM-DD HH:MM[:SS]` 또는 `YYYY-MM-DD`.
- Y/N 컬럼은 `Y`, `YES`, `TRUE`, `1` 을 참으로 읽습니다.
- 빈 칸은 값 없음(null)으로 읽습니다.
- 샘플 폴더의 `meta.json` 은 기준 시각을 2026-11-24 09:00 으로 고정하는 파일입니다. 실데이터 폴더에는 두지 마세요(없으면 현재 시각 기준).
- 파일을 바꾸면 서버 재시작 없이 다음 요청부터 반영됩니다 (CSV 수정 시각 감지).
- 필수 컬럼이 빠지거나 형식이 틀리면 API가 `파일명 N행을 읽지 못했습니다: …` 오류를 돌려줍니다.

## 조회 축

```
라인 (lines) ─┬─ 공법(제품) (products)
              │     ├─ 공정흐름 (process_flow)        ← 공법 기준 조회
              │     ├─ 타겟표준 / 개정 이력           ← 공법 기준 조회
              │     ├─ SPC 요약                        ← 공법 기준 조회
              │     └─ 호환설비 (compat_equipment)  ─┐
              │                                       ▼
              └─ 설비 마스터 (equipment) ── 인터락 / PM·BM / 변경 이력  ← 호환설비(또는 모델) 기준 집계
```

설비 이력은 **그 공법의 호환설비에 걸린 모든 이력**을 모읍니다 (다른 공법 LOT에서 난 인터락도 포함, 화면에서 `타 공법`으로 표시). 모델 집계는 `equipment.eqp_model` 로 묶습니다.

## 테이블

### 1. `lines.csv` — 라인
| 컬럼 | 필수 | 설명 |
|---|---|---|
| line_id | ✓ | 라인 코드 |
| line_name | ✓ | 표시 이름 |
| fab, node, tech | | FAB, 노드, 기술 설명 |

### 2. `products.csv` — 공법(제품) 마스터 + 재공
화면의 **라인 → 노드 → 공정 → 재공 상위 5개 공법** 드릴다운과 **공법 직접 조회**가 모두 이 테이블에서 나옵니다.

| 컬럼 | 필수 | 설명 |
|---|---|---|
| product_id | ✓ | 공법(제품) 코드. URL `#p-<id>` 에 쓰므로 영문·숫자·하이픈 권장 |
| product_name | ✓ | 표시 이름 |
| line_id | ✓ | lines.line_id |
| node | ✓ | 라인 아래 노드 (예: N4) |
| family_code | ✓ | 공정(옵션 계열) 코드 (예: 4F-P) |
| family_name | | 공정 이름 (예: 성능 개선형) |
| wip_wafers | | 현재 재공. **공정별 Top N 정렬 기준** |
| flow_type | | 흐름 유형 |
| grade | | `Automotive` 이면 변경관리·타겟표준 리스크를 한 단계 상향 |
| audit_reasons | | 감사 메모, `;` 구분 (자동 태그 뒤에 붙음) |
| mass_prod_start | | 양산 시작일 (1년 미만이면 `신규 양산` 태그) |

자동 태그: `공정 재공 N위`, `차량용 AEC-Q100`, `신규 양산 1년 미만`, `최근 N일 스펙 개정 N건`, `단일 호환설비 스텝 N개`.
SQL 모드에서는 `QUERIES["products"]`(마스터 + 재공 조인)와 `QUERIES["search_products"]`(직접 조회)를 사내 테이블에 맞춥니다.

### 3. `process_flow.csv` — 공정흐름 (공법 × 스텝)
| 컬럼 | 필수 | 설명 |
|---|---|---|
| product_id, seq, step_id, step_name, module | ✓ | `module` 은 포토·식각·증착·CMP·확산·주입·세정 (색상 매핑, 다른 값도 표시됨) |
| stage | | 스테이지(블록). 예: STI, Dummy Gate, BEOL M1. **비우면 연속된 같은 모듈 구간으로 자동 묶음**. 수천 스텝을 블록 단위로 보여 주는 기준 |
| step_grade | | A(핵심) / B(주요·계측) / C(일반). 비우면 critical=Y → A, 타겟표준 있음 → B, 나머지 C |
| param, unit | | 대표 계측 항목 |
| critical | | 핵심 스텝 Y/N |
| recipe_id | | 레시피 |
| meas_step_id, meas_step_name | | 이 공정 스텝의 결과를 재는 **계측 스텝** (예: `MEAS-0045`, `SiGe 두께 계측 · CD-SEM/두께`). 공정능력·TTTM 은 공정 스텝 기준으로 묶고, 화면에 계측 스텝을 함께 표시 |

스텝이 수천 개여도 됩니다. 화면은 전체 라우트를 한 줄 띠(캔버스)로 그리고, 스테이지 흐름도에서 블록을 누르면 그 블록의 스텝만 노드로 펼칩니다.

### 4. `target_standards.csv` — 현재 타겟표준
`product_id, step_id, param` 필수 · `unit, target, lsl, usl, lcl, ucl, rev, effective_from, owner`
→ `lsl/usl` = 규격한계(S/L), `lcl/ucl` = 관리한계(C/L). C/L 이 없으면 시뮬레이터가 평균 ± 3σ군내 로 추정합니다.

### 5. `target_changes.csv` — 타겟표준 개정 이력
`change_id, product_id, step_id` 필수 · `param, rev, changed_at, target_before, target_after, lsl_before, lsl_after, usl_before, usl_after, reason, requested_by, approved_by, ecn_no`
→ 규격 폭(USL−LSL)이 넓어지면 **스펙 완화**, 요청자=승인자이면 치명.

### 6. `equipment.csv` — 설비 마스터
`eqp_id, eqp_model` 필수 · `maker, module, line_id, status, pm_cycle_days, last_pm_at`
→ `last_pm_at + pm_cycle_days` 를 넘기면 **PM 주기 초과**.

### 7. `compat_equipment.csv` — 공법 스텝별 호환설비
`product_id, step_id, eqp_id` 필수 · `qualified`(Y/N, 기본 Y), `qual_date`
→ 인증 설비 1대뿐이면 **단일 호환설비**, 모델 2종 이상이면 **모델 혼재**.

### 8. `interlocks.csv` — 인터락 이력
`interlock_id, eqp_id, il_code` 필수 · `occurred_at, category, severity(CRIT/MAJOR/MINOR), description, released_at, release_type(정상 조치/강제 해제), released_by, lot_id, product_id, step_id`
→ `released_at` 비어 있으면 미해제.

### 9. `maintenance.csv` — PM/BM 이력
`mt_id, eqp_id, mt_type(PM/BM)` 필수 · `start_at, end_at, reason, parts, qual_result(PASS/FAIL/PENDING), qual_at, lots_before_qual, performed_by`
→ `lots_before_qual > 0` 이면 **Qual 전 LOT 진행** (치명).

### 10. `changes.csv` — 설비·레시피 변경 이력
`change_id, category` 필수 · `eqp_id, product_id, step_id, changed_at, item, before, after, ecn_no, requested_by, approved_by, approved_at, verify_status(완료/진행/미실시)`
→ `category` 가 `FDC 한계 변경`, `인터락 조건 변경` 이면 기준 변경 규칙 적용.

### 11. `spc_summary.csv` — 스텝별 공정능력 (최근 30일)
`product_id, step_id` 필수 · `meas_step_id, param, n, mean, sigma_within, sigma_overall, cp, cpk, pp, ppk, ooc_30d, oos_30d`
- `sigma_within` = 군내(단기) σ → **Cp·Cpk**, `sigma_overall` = 전체(장기) σ → **Pp·Ppk**
- `cp/cpk/pp/ppk` 를 비우면 타겟표준의 LSL·USL 과 σ 로 계산합니다. 예전 형식(`sigma` 한 개)도 읽으며 `sigma_within` 으로 간주합니다.
- 판정: Cpk 가 **스텝 등급별 요구치**(`risk.py` 의 `CPK_REQ`, 기본 A 1.67 · B 1.33 · C 1.00) 미만이면 공정능력 부족, Cpk 는 충족인데 Ppk < 1.33 이면 장기 공정능력 저하.

### 12. `spc_by_eqp.csv` — 설비별 출력 (TTTM) · 선택
`product_id, step_id, eqp_id` 필수 · `meas_step_id, param, n, mean, sigma_within, sigma_overall`
- 계측값을 **그 LOT 이 거친 공정 설비**별로 묶은 요약입니다 (MES 이력 × SPC 원시값 조인).
- **M/S**(Mean Shift) = (설비 평균 − 나머지 호환설비 평균) / 나머지 σ군내, **S/R**(Sigma Ratio) = 설비 σ군내 / 나머지 σ군내.
- 판정: |M/S| ≥ 1.0 또는 S/R ≥ 1.2 이면 매칭 이상 (1.5 / 1.5 이상 HIGH, A등급 스텝은 한 단계 상향). 기준값 바꾸는 법은 `docs/EXTENDING.md` 「판정 기준값」.
- 파일이 없으면 TTTM 화면만 비고 나머지는 그대로 동작합니다.

## 규칙·가중치 바꾸기
`backend/app/services/risk.py` 의 `RULES`(심각도·기준), `SEV_W`(가중치), `level_of`(등급 구간)를 고치면 화면의 판정 기준 모달에도 그대로 반영됩니다.
