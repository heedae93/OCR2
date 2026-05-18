# PII 추출 정확도 벤치마크

## 실행 위치

모든 명령어는 `backend/` 디렉토리에서 실행한다.

```bash
cd backend
```

---

## 1. 파일 목록 확인

업로드된 PDF 파일 목록과 PII 탐지 건수를 확인한다.

```bash
python -m benchmark.create_case_from_job --list-jobs
```

출력 예시:

```
  파일명                                PII 탐지   페이지   최근 업로드       중복
  계약서_홍길동.pdf                     8건        3페이지  2026-05-10 14:22  (3회)
  개인정보동의서.pdf                    12건       1페이지  2026-05-14 09:11
```

---

## 2. 테스트 PDF 라벨링 (케이스 초안 생성)

### Step 1. 케이스 초안 생성

파일명으로 가장 최근 업로드 결과를 자동 선택하여 케이스 파일을 생성한다.

```bash
python -m benchmark.create_case_from_job --file "파일명.pdf" --name 케이스이름
```

예시:

```bash
python -m benchmark.create_case_from_job --file "계약서.pdf" --name 계약서_001
```

→ `benchmark/cases/case_real_계약서_001.json` 생성됨

같은 파일을 여러 번 올렸을 때 버전을 직접 고르려면:

```bash
python -m benchmark.create_case_from_job --file "계약서.pdf" --name 계약서_001 --pick
```

### Step 2. ground_truth 검토 및 수정

생성된 케이스 파일을 열어 `ground_truth` 항목을 검토한다.

- **잘못 탐지된 항목 삭제** → FP 제거
- **빠진 개인정보 추가** → FN 보완

```json
"ground_truth": [
  {"type": "NAME",    "value": "홍길동"},
  {"type": "PHONE",   "value": "010-1234-5678"},
  {"type": "RRN",     "value": "800115-1234567"}
]
```

> **주의**: 타입명은 반드시 아래 표의 영문 대문자 형식을 사용해야 한다.
> bbox는 입력하지 않아도 된다 (type + value로만 매칭).

#### 사용 가능한 타입명

| 타입명                | 설명           |
| --------------------- | -------------- |
| `NAME`                | 한글 이름      |
| `ENGLISH_NAME`        | 영문 이름      |
| `PHONE`               | 전화번호       |
| `EMAIL`               | 이메일         |
| `RRN`                 | 주민등록번호   |
| `FOREIGNER_REG_NO`    | 외국인등록번호 |
| `ACCOUNT_NO`          | 계좌번호       |
| `ROAD_ADDRESS`        | 도로명 주소    |
| `CAR_NO`              | 차량번호       |
| `CREDIT_CARD`         | 신용카드번호   |
| `DRIVERS_LICENSE`     | 운전면허번호   |
| `HEALTH_INSURANCE_NO` | 건강보험번호   |
| `IP_ADDRESS`          | IP 주소        |
| `MAC_ADDRESS`         | MAC 주소       |
| `PASSPORT_NO`         | 여권번호       |
| `BUSINESS_REG_NO`     | 사업자등록번호 |

---

## 3. 벤치마크 실행

### 특정 케이스만 실행

```bash
python -m benchmark.run_benchmark --case case_real_계약서_001
```

### 전체 케이스 실행

```bash
python -m benchmark.run_benchmark --label "정규식+NER_v1"
```

### 결과 해석

```
전체  P=1.000  R=0.812  F1=0.897  (TP=13 FP=0 FN=3)

? ACCOUNT_NO    → 누락(FN)만 있음
! PHONE         → 오탐(FP)만 있음
x EMAIL         → 오탐+누락 둘 다
```

- **P (Precision)**: 탐지한 것 중 실제 개인정보 비율 (오탐 적을수록 높음)
- **R (Recall)**: 실제 개인정보 중 탐지한 비율 (누락 적을수록 높음)
- **F1**: P와 R의 조화평균

---

## 4. 버전 간 비교

기능 추가 전후 수치 변화를 비교한다.

```bash
# 이전 결과와 이후 결과 비교
python -m benchmark.compare_runs benchmark/results/[이전].json benchmark/results/[이후].json
```

예시 출력:

```
  [전체] F1          0.720    0.897    ▲+0.177
  NAME               0.450    1.000    ▲+0.550
  ACCOUNT_NO         0.000    0.500    ▲+0.500
```

---

## 5. 결과 파일 위치

- 케이스 파일: `backend/benchmark/cases/`
- 결과 JSON: `backend/benchmark/results/`

--label 없이 전체 실행하면:

benchmark/cases/ 안의 모든 .json 파일을 평가
케이스별 TP/FP/FN을 합산해서 전체 Precision/Recall/F1 계산
타입별(NAME, PHONE 등)도 마찬가지로 합산
평균이 아니라 합산 후 재계산입니다. 예를 들어 6개 케이스에서 NAME이 총 TP=10, FP=1, FN=2라면 NAME의 F1을 그 숫자로 계산합니다. (단순 F1 평균이 아님 — 이게 더 정확한 방식입니다.)

synthetic 케이스(case_001, case_004 등)도 같이 들어가니, 실제 문서만 보고 싶으면:

```bash
python -m benchmark.run_benchmark
# --case 필터가 파일명에 해당 문자열이 포함된 것만 고릅니다.
```

### 코드 수정 및 추가 후 동작

```bash
python -m benchmark.run_benchmark --label "코드추가_001"

```
