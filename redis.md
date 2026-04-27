# Redis + Celery 실행 가이드

이 문서는 팀원이 저장소를 `git pull` 받은 뒤, 로컬에서 이 프로젝트를 정상 실행하기 위한 설치/실행 가이드입니다.

이 프로젝트의 `OCR 작업하기` 기능은 이제 단순히 프론트와 백엔드만 띄워서는 동작하지 않습니다.
아래 4개가 모두 실행되어야 합니다.

- Frontend (`Next.js`)
- Backend (`FastAPI`)
- Redis
- Celery Worker

Redis 또는 Celery Worker가 없으면 `OCR 시작하기` 시 아래와 같은 문제가 발생할 수 있습니다.

- `OCR 작업 요청 실패`
- 작업이 `queued`에서 멈춤
- 작업이 실제로 처리되지 않음


## 1. 이 문서를 Claude / Codex에 넘길 때

팀원이 AI 도구에게 실행을 맡길 경우 아래처럼 요청하면 됩니다.

예시:

```text
프로젝트 루트의 redis.md 파일을 참고해서 이 프로젝트가 정상 실행되도록 필요한 설치와 실행을 진행해줘.
```

권장 추가 요청:

```text
redis.md 기준으로 누락된 설치가 있으면 먼저 설치하고, Redis / Backend / Worker / Frontend를 모두 실행해줘.
실행 후 접속 주소와 확인 결과까지 알려줘.
```


## 2. 필수 구성요소

권장 환경:

- Windows 10/11
- Python 3.11
- Node.js 18 이상
- npm
- Redis 7 이상

이 저장소 기준 주요 경로:

- 백엔드 의존성: `backend/requirements.txt`
- 프론트 의존성: `frontend/package.json`
- 백엔드 실행 디렉터리: `backend`
- 프론트 실행 디렉터리: `frontend`


## 3. 처음 받은 뒤 설치 순서

프로젝트 루트에서 시작합니다.

```powershell
cd <프로젝트-루트>
```

### 3-1. Python 가상환경 생성

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

중요:

- Backend와 Celery Worker는 반드시 같은 Python 환경에서 실행해야 합니다.
- `Anaconda`, 시스템 Python, `.venv`가 섞이면 `No module named 'celery'` 같은 오류가 날 수 있습니다.
- 가장 안전한 방법은 항상 `.venv`를 활성화한 뒤 backend/worker를 실행하는 것입니다.

설치 확인:

```powershell
python -c "import celery, fastapi; print('python ok')"
```

### 3-2. Frontend 패키지 설치

```powershell
cd frontend
npm install
cd ..
```

설치 확인:

```powershell
cd frontend
npm --version
cd ..
```


## 4. Redis 설치

Windows에서는 아래 2가지 방법 중 하나를 권장합니다.

### 방법 A. Docker 사용 권장

Docker Desktop이 설치되어 있다면 가장 간단합니다.

Redis 실행:

```powershell
docker run -d --name bbocr-redis -p 6379:6379 redis:7
```

이미 컨테이너가 있다면 시작:

```powershell
docker start bbocr-redis
```

확인:

```powershell
docker ps
```

### 방법 B. WSL(우분투)에서 Redis 실행

WSL Ubuntu가 있다면:

```bash
sudo apt update
sudo apt install redis-server -y
sudo service redis-server start
redis-cli ping
```

정상 응답:

```text
PONG
```

### 방법 C. Linux / macOS 참고

Linux:

```bash
sudo apt update
sudo apt install redis-server -y
sudo systemctl start redis-server
redis-cli ping
```

macOS:

```bash
brew install redis
brew services start redis
redis-cli ping
```

이 프로젝트 기본 Redis 주소:

```text
redis://localhost:6379/0
```

관련 설정 위치:

- `backend/config.py`
- `config.yaml`의 `redis.url`


## 5. 실행 순서

반드시 아래 순서대로 실행하는 것을 권장합니다.

### 5-1. Redis 실행 확인

가능하면 먼저 `PING` 확인:

```powershell
redis-cli ping
```

또는 Docker 사용 시:

```powershell
docker ps
```

### 5-2. Backend 실행

새 PowerShell 창:

```powershell
cd <프로젝트-루트>
.venv\Scripts\Activate.ps1
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 6015
```

정상 기동 시 확인 포인트:

- 에러 없이 서버가 떠야 함
- 기본 주소: `http://localhost:6015`

간단 확인:

브라우저 또는 요청:

```powershell
curl http://localhost:6015/docs
```

### 5-3. Celery Worker 실행

새 PowerShell 창:

```powershell
cd <프로젝트-루트>
.venv\Scripts\Activate.ps1
cd backend
python -m celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo
```

중요:

- Windows에서는 `--pool=solo`가 필요합니다.
- Worker는 OCR 큐(`ocr`)를 소비합니다.
- Worker가 안 떠 있으면 작업은 `queued`에 머물 수 있습니다.

정상 로그 예시:

- `Task received`
- `Task completed`

### 5-4. Frontend 실행

새 PowerShell 창:

```powershell
cd <프로젝트-루트>\frontend
npm run dev
```

기본 접속 주소:

- Frontend: `http://localhost:6017`
- Backend: `http://localhost:6015`


## 6. 최종 체크리스트

정상 실행 상태:

- Redis 실행 중
- Backend 실행 중
- Celery Worker 실행 중
- Frontend 실행 중

정상 동작 확인:

1. `http://localhost:6017` 접속
2. 로그인 또는 진입
3. `OCR 작업하기` 진입
4. 파일 업로드 후 `OCR 시작하기`
5. 상태가 `queued` → `processing` → `completed`로 이동


## 7. 자주 나는 오류와 해결 방법

### 7-1. `OCR 작업 요청 실패`

가장 흔한 원인:

- Redis 미실행
- Celery Worker 미실행
- Backend가 `celery` 없는 Python 환경으로 실행됨

확인 방법:

- Backend 터미널 로그 확인
- Worker 터미널 로그 확인
- `.venv` 활성화 여부 확인

특히 아래 오류가 보이면:

```text
No module named 'celery'
```

해결:

```powershell
cd <프로젝트-루트>
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

그리고 backend/worker를 둘 다 다시 실행합니다.

### 7-2. 작업이 `queued`에서 안 넘어감

원인:

- Worker가 안 떠 있음
- Redis 연결 실패
- Worker가 다른 Python 환경에서 잘못 실행됨

확인:

- worker 로그에 `Task received`가 찍히는지
- Redis가 `localhost:6379`에서 뜨는지

### 7-3. 작업이 `90%`에서 오래 멈춤

이 프로젝트에서는 `90%`가 후반 단계일 수 있습니다.

예:

- 최종 PDF 병합
- 후처리
- 개인정보 감지

즉, 무조건 오류는 아닙니다.
하지만 오래 지속되면 worker 로그를 확인해야 합니다.

확인 포인트:

- `/api/status/{job_id}`가 `processing`인지 `failed`인지
- worker 로그에 예외가 있는지

### 7-4. Frontend는 뜨는데 OCR만 안 됨

대부분 아래 상황입니다.

- Frontend만 실행됨
- Backend는 실행됐지만 Worker 없음
- Redis 없음

이 프로젝트는 OCR 백그라운드 큐 구조라서 Frontend 단독 실행만으로는 정상 동작하지 않습니다.


## 8. AI 도구용 빠른 요약

Claude / Codex가 빠르게 참고할 수 있도록 핵심만 요약합니다.

### 필수 실행 프로세스

1. Redis
2. Backend
3. Celery Worker
4. Frontend

### Windows 기준 실행 명령

Backend:

```powershell
cd <프로젝트-루트>
.venv\Scripts\Activate.ps1
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 6015
```

Worker:

```powershell
cd <프로젝트-루트>
.venv\Scripts\Activate.ps1
cd backend
python -m celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo
```

Frontend:

```powershell
cd <프로젝트-루트>\frontend
npm run dev
```

Redis(Docker):

```powershell
docker run -d --name bbocr-redis -p 6379:6379 redis:7
```

### 핵심 주의사항

- Backend와 Worker는 같은 Python 환경 사용
- Redis 없으면 OCR 시작 안 됨
- Worker 없으면 작업이 큐에만 쌓임
- `No module named 'celery'`가 뜨면 Python 환경이 잘못된 것


## 9. 권장 실행 요청 예시

팀원이 AI에게 이렇게 말하면 됩니다.

```text
프로젝트 루트의 redis.md 파일을 참고해서
1. 필요한 설치를 확인하고
2. Redis / Backend / Celery Worker / Frontend를 정상 실행하고
3. 접속 주소와 정상 여부까지 알려줘.
```

또는 더 구체적으로:

```text
redis.md 기준으로 이 프로젝트를 처음 받았다고 가정하고
누락된 설치가 있으면 설치한 뒤,
OCR 작업하기가 정상 동작하도록 Redis, backend, worker, frontend를 실행해줘.
실행 후 오류가 있으면 바로 수정하고 결과를 알려줘.
```
