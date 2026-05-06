## 운영 구성 (Docker 없이)

이 프로젝트는 **Tika / Backend / Worker**를 각각 독립 프로세스로 띄우고, 운영 환경에서는 **프로세스 감독자**(Linux: `systemd`, Windows: NSSM)로 관리하는 구성을 권장합니다.

### 공통 개념

- **Tika**: 문서에서 텍스트를 추출하는 별도 서비스 (Java 프로세스 1개)
- **Backend**: FastAPI (uvicorn)
- **Worker**: Celery OCR worker (Redis 필요)
- **Frontend(Next.js)**: 운영은 별도(빌드 후 정적 배포/리버스프록시) 권장. 여기서는 백엔드/워커/Tika에 집중합니다.

아래 템플릿은 “한 서버(또는 같은 내부망)”에서 **Tika 주소를 `TIKA_SERVER_URL`로 주입**하는 방식입니다.

---

## Linux (systemd)

파일 위치:
- `ops/systemd/tika.service`
- `ops/systemd/bbocr-backend.service`
- `ops/systemd/bbocr-worker.service`
- `ops/systemd/bbocr.env.example`

### 1) 환경 변수 파일 준비

예시:

```bash
sudo mkdir -p /etc/bbocr
sudo cp ops/systemd/bbocr.env.example /etc/bbocr/bbocr.env
sudoedit /etc/bbocr/bbocr.env
```

### 2) 서비스 파일 설치

```bash
sudo cp ops/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 3) 기동/상태 확인

```bash
sudo systemctl enable --now tika
sudo systemctl enable --now bbocr-backend
sudo systemctl enable --now bbocr-worker

sudo systemctl status tika bbocr-backend bbocr-worker
```

로그:

```bash
journalctl -u tika -f
journalctl -u bbocr-backend -f
journalctl -u bbocr-worker -f
```

---

## Windows (NSSM)

파일 위치:
- `ops/windows/nssm-install.ps1`
- `ops/windows/bbocr.env.example`

### 1) 준비물

- NSSM 설치 (예: `C:\nssm\nssm.exe`)
- Java 설치 (Tika 실행용)
- Python/Node/Redis는 운영 환경 정책에 맞게 별도 설치

### 2) 환경 변수 파일 작성

예: `C:\bbocr\bbocr.env` 를 만들고 `ops/windows/bbocr.env.example`을 참고해 값을 채웁니다.

### 3) 서비스 설치

관리자 PowerShell에서:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\ops\windows\nssm-install.ps1 -NssmExe C:\nssm\nssm.exe -EnvFile C:\bbocr\bbocr.env
```

설치 후:
- 서비스 앱에서 `bbocr-tika`, `bbocr-backend`, `bbocr-worker` 시작/중지
- 또는:

```powershell
Start-Service bbocr-tika
Start-Service bbocr-backend
Start-Service bbocr-worker
```

