# BBOCR - Claude Code 가이드

이 파일은 Claude Code가 자동으로 읽는 프로젝트 설정 파일입니다.
팀원이 Claude에게 "프로젝트 실행해줘"라고 하면 아래 절차대로 진행하세요.

---

## 프로젝트 개요

- **이름**: BBOCR (BabelBrain OCR)
- **기능**: 이미지/PDF → 검색 가능한 PDF 변환 (한국어 특화 OCR)
- **구성**: FastAPI 백엔드 (Python) + Next.js 프론트엔드
- **포트**: 백엔드 6015, 프론트엔드 6017

---

## 실행 전 필수 확인 사항

### 1. GPU vs CPU 모드 결정

```bash
nvidia-smi   # GPU 있으면 CUDA 버전 확인
```

- **GPU 있음** → `config.yaml`에서 `ocr.use_gpu: true` (기본값)
- **GPU 없음** → `config.yaml`에서 `ocr.use_gpu: false`

### 2. OS 확인

- **Windows**: 아래 Windows 섹션 참고 (fcntl, python3 등 호환성 이슈)
- **Linux/Mac**: 기본 README.md 절차대로 진행

---

## 팀원별 실행 모드

| 팀원 환경 | 모드 | config.yaml 설정 |
|-----------|------|-----------------|
| NVIDIA GPU + CUDA | **GPU 모드** | `ocr.use_gpu: true` (기본값) |
| GPU 없음 / GPU 모드 불가 | **CPU 모드** | `ocr.use_gpu: false` |

> **CPU 모드 팀원**: 아래 "CPU 모드 전용 설치" 섹션을 따르세요.
> GPU 버전 PaddlePaddle을 설치하면 안 됩니다.

---

## 설치 절차 — GPU 모드

### Step 1-GPU: PaddlePaddle GPU 설치 (CUDA 버전에 맞게)

```bash
# CUDA 버전 확인
nvidia-smi   # 오른쪽 상단 "CUDA Version" 확인

# CUDA 11.8
pip install paddlepaddle-gpu==3.1.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/
# CUDA 12.3 / 12.4 / 12.5
pip install paddlepaddle-gpu==3.1.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu123/
# CUDA 12.6 / 12.7
pip install paddlepaddle-gpu==3.1.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
```

GPU 인식 확인:
```bash
python -c "import paddle; print(paddle.device.is_compiled_with_cuda())"
# True 가 나와야 정상
```

---

## 설치 절차 — CPU 모드 (GPU 없는 팀원)

### Step 1-CPU: PaddlePaddle CPU 설치

```bash
pip install paddlepaddle==3.1.1
```

### Step 1-CPU 추가: config.yaml 수정

```yaml
# config.yaml
ocr:
  use_gpu: false   # ← 반드시 false 로 변경
  cpu_threads: 8   # CPU 코어 수에 맞게 조정 (기본 64, 코어 적으면 낮추기)
```

> **주의**: `cpu_threads: 64` 는 서버용 기본값입니다.
> 일반 PC라면 실제 CPU 코어 수(예: 8 또는 16)에 맞게 낮추세요.
> `nproc` (Linux/Mac) 또는 작업 관리자 → 성능 탭 (Windows)으로 확인 가능합니다.

---

## 설치 절차 — 공통 (GPU/CPU 모두)

### Step 2: Python 패키지 설치

```bash
pip install -r backend/requirements.txt
```

### Step 3: Frontend 패키지 설치

```bash
cd frontend && npm install && cd ..
```

---

## 실행

```bash
bash start.sh    # 백엔드 + 프론트엔드 동시 시작
bash stop.sh     # 종료
bash status.sh   # 상태 확인
```

로그 확인:
```bash
tail -f logs/backend.log
tail -f logs/frontend.log
```

---

## Windows 환경 전용 주의사항

Windows에서 실행 시 아래 문제들이 이미 코드에 패치되어 있습니다.
(재발 시 `WINDOWS_FIXES.md` 참고)

### 이미 적용된 패치

| 파일 | 패치 내용 |
|------|-----------|
| `start.sh` | CRLF 제거, `python3→python`, `lsof→netstat`, UTF-8 인코딩 명시 |
| `backend/main.py` | paddlex 이중 초기화 방지, langchain 호환 shim |
| `backend/utils/job_manager.py` | `fcntl` Windows 호환 처리 |
| `backend/api/sessions.py` | `fcntl` Windows 호환 처리 |
| `backend/api/ocr.py` | 임시 파일 삭제 WinError 32 수정 |
| `frontend/scripts/next-dev.cjs` + `frontend/package.json` + `frontend/next.config.js` | Windows: 기동 시 `.next` 삭제 + `WATCHPACK_POLLING` 기본 활성 + webpack `poll`/`aggregateTimeout`(HMR 중 청크 잠금 완화). 폴링 끄기: `WATCHPACK_POLLING=0`. 캐시 유지: `SKIP_NEXT_CACHE_CLEAN=1` 또는 `npm run dev:fast` |
| `dev_start.bat` | 프론트 기동 시 `npm run dev -- --port 6017` 중복 제거(`-p`는 이미 package에 있음) |

### Windows에서 start.sh 실행 방법

```bash
# Git Bash 또는 WSL에서 실행
bash start.sh
```

### Windows에서 자주 보이는 경고 (무시 가능)

```
UserWarning: No ccache found.   ← 무시
RequestsDependencyWarning: urllib3 ...  ← 무시
```

---

## 트러블슈팅

### 서버가 안 뜨는 경우

```bash
# 포트 강제 정리
netstat -ano | grep ":6015"   # PID 확인
taskkill /PID <PID> /F        # Windows
kill <PID>                     # Linux/Mac
```

### PaddlePaddle GPU 인식 안 될 때

```bash
python -c "import paddle; print(paddle.device.is_compiled_with_cuda())"
# False → CUDA 버전 확인 후 맞는 빌드 재설치
```

### `ModuleNotFoundError: No module named 'fcntl'`

Windows입니다. 이 에러가 나면 코드 패치가 빠진 것입니다.
`WINDOWS_FIXES.md`의 수정 내용을 적용하세요.

### `RuntimeError: PDX has already been initialized`

`backend/main.py`에 아래 줄이 있는지 확인:
```python
os.environ.setdefault('PADDLE_PDX_EAGER_INIT', '0')
```

### `ModuleNotFoundError: No module named 'langchain.docstore'`

langchain 버전 문제입니다:
```bash
pip install "langchain==0.3.25" langchain-community
```

---

## CPU 모드 성능 참고

GPU 대비 OCR 처리 속도가 크게 느립니다. 개발/테스트 용도로 사용하세요.

| 항목 | GPU 모드 | CPU 모드 |
|------|---------|---------|
| 페이지당 처리 시간 | ~1-3초 | ~15-60초 |
| 권장 용도 | 실서비스, 대량 처리 | 개발, 기능 테스트 |
| 레이아웃 감지 | 빠름 | 느림 (비활성화 권장) |

CPU 모드에서 속도를 더 높이려면 `config.yaml`에서:
```yaml
layout_detection:
  enabled: false   # 레이아웃 감지 끄면 속도 향상
```

---

## 현재 검증된 환경 (참고)

| 항목 | GPU 환경 | CPU 환경 |
|------|---------|---------|
| OS | Windows 11 | - |
| Python | 3.11.9 | 3.10+ |
| CUDA | 12.7 | 불필요 |
| GPU | RTX 4060 Laptop | 없음 |
| Node.js | 22.x | 22.x |
| PaddlePaddle | 3.1.1-gpu (cu126) | 3.1.1 (CPU) |
| langchain | 0.3.25 | 0.3.25 |
