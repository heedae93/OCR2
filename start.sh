#!/bin/bash
#
# BBOCR Server Launcher
# config.yaml에서 포트를 읽어 백엔드 + 프론트엔드를 시작합니다.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python}"

# ── config.yaml에서 설정 읽기 ──────────────────────────────
read_config() {
    "$PYTHON_BIN" -c "
import yaml, sys
with open('config.yaml', 'r', encoding='utf-8') as f:
    cfg = yaml.safe_load(f)
server = cfg.get('server', {})
be = server.get('backend', {})
fe = server.get('frontend', {})
print(be.get('host', '0.0.0.0'))
print(be.get('port', 5015))
print(fe.get('host', '0.0.0.0'))
print(fe.get('port', 5017))
" 2>/dev/null
}

CONFIG_OUTPUT=$(read_config)
if [ -z "$CONFIG_OUTPUT" ]; then
    echo "[ERROR] config.yaml 파싱 실패. 기본값을 사용합니다."
    BACKEND_HOST="0.0.0.0"
    BACKEND_PORT=5015
    FRONTEND_HOST="0.0.0.0"
    FRONTEND_PORT=5017
else
    BACKEND_HOST=$(echo "$CONFIG_OUTPUT" | sed -n '1p')
    BACKEND_PORT=$(echo "$CONFIG_OUTPUT" | sed -n '2p')
    FRONTEND_HOST=$(echo "$CONFIG_OUTPUT" | sed -n '3p')
    FRONTEND_PORT=$(echo "$CONFIG_OUTPUT" | sed -n '4p')
fi

echo "========================================"
echo "  BBOCR Server Launcher"
echo "========================================"
echo "  Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "========================================"

# ── 이미 실행 중인지 확인 ──────────────────────────────────
port_in_use() {
    netstat -an 2>/dev/null | grep -q ":$1 .*LISTEN" || \
    netstat -an 2>/dev/null | grep -q ":$1 .*LISTENING"
}

kill_port() {
    local port="$1"
    local pids
    pids=$(netstat -ano 2>/dev/null \
        | grep -E ":${port}[ \t].*LISTEN" \
        | awk '{print $NF}' | tr -d '\r' | sort -u | grep -v '^0$')
    for pid in $pids; do
        taskkill //F //PID "$pid" > /dev/null 2>&1 && \
            echo "[INFO] Killed existing process on port $port (PID: $pid)"
    done
}

backend_healthy() {
    local port="$1"
    curl -sf --max-time 3 "http://127.0.0.1:${port}/health" > /dev/null 2>&1
}

SKIP_BACKEND=false
if port_in_use "$BACKEND_PORT"; then
    if backend_healthy "$BACKEND_PORT"; then
        echo "[OK] Backend already running on port $BACKEND_PORT — skipping restart"
        SKIP_BACKEND=true
    else
        echo "[INFO] Backend port $BACKEND_PORT in use. Killing..."
        kill_port "$BACKEND_PORT"
        sleep 1
        # 포트가 여전히 점유여도 고스트 소켓일 수 있으므로 계속 진행
        if port_in_use "$BACKEND_PORT"; then
            echo "[WARN] Port $BACKEND_PORT still reported in use (may be ghost socket). Proceeding..."
        fi
    fi
fi

if port_in_use "$FRONTEND_PORT"; then
    echo "[INFO] Frontend port $FRONTEND_PORT in use. Killing..."
    kill_port "$FRONTEND_PORT"
    sleep 1
    if port_in_use "$FRONTEND_PORT"; then
        echo "[WARN] Port $FRONTEND_PORT still reported in use (may be ghost socket). Proceeding..."
    fi
fi

# ── 로그 디렉토리 확인 ────────────────────────────────────
mkdir -p logs

# ── Redis 확인 및 시작 ────────────────────────────────────
echo "[INFO] Checking Redis..."

REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"

redis_running() {
    "$PYTHON_BIN" -c "
import redis, sys
try:
    r = redis.from_url('${REDIS_URL}')
    r.ping()
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

wait_for_redis() {
    for i in 1 2 3 4 5; do
        sleep 1
        if redis_running; then
            return 0
        fi
    done
    return 1
}

if redis_running; then
    echo "[OK] Redis is already running"

elif command -v redis-server &>/dev/null; then
    # 로컬 redis-server가 있는 경우
    nohup redis-server > logs/redis.log 2>&1 &
    REDIS_PID=$!
    echo "$REDIS_PID" > logs/redis.pid
    if wait_for_redis; then
        echo "[OK] Redis started locally (PID: $REDIS_PID)"
    else
        echo "[ERROR] Redis started but not responding. Check logs/redis.log"
        exit 1
    fi

elif docker info &>/dev/null 2>&1; then
    # Docker가 있는 경우
    if docker ps -a --format '{{.Names}}' | grep -q "^bbocr-redis$"; then
        docker start bbocr-redis > /dev/null 2>&1
        echo "[OK] Redis container (bbocr-redis) restarted via Docker"
    else
        docker run -d --name bbocr-redis -p 6379:6379 redis:7 > /dev/null 2>&1
        echo "[OK] Redis container started via Docker"
    fi
    if ! wait_for_redis; then
        echo "[ERROR] Redis (Docker) not responding. Check: docker logs bbocr-redis"
        exit 1
    fi

elif command -v wsl.exe &>/dev/null; then
    # WSL Redis 시작 (wsl.exe -u root service redis-server start)
    echo "[INFO] Trying Redis via WSL..."
    wsl.exe -u root service redis-server start > /dev/null 2>&1
    if wait_for_redis; then
        echo "[OK] Redis started via WSL"
    else
        # WSL에 redis-server가 없으면 설치 시도
        echo "[INFO] Installing redis-server in WSL..."
        wsl.exe -u root bash -c "apt-get update -qq && apt-get install -y redis-server && service redis-server start" > logs/redis.log 2>&1
        if wait_for_redis; then
            echo "[OK] Redis installed and started via WSL"
        else
            echo "[ERROR] Redis (WSL) not responding. Check logs/redis.log"
            exit 1
        fi
    fi

else
    echo "[ERROR] Redis를 시작할 수 없습니다. 아래 중 하나를 설치하세요:"
    echo "        Docker:  docker run -d -p 6379:6379 --name bbocr-redis redis:7"
    echo "        WSL:     wsl -u root apt install redis-server"
    echo "        Native:  redis-server (PATH에 있어야 함)"
    exit 1
fi

# ── 선택: Apache Tika Server (Docker 없이 JAR만으로) ─────────
# 사용법:
#   export TIKA_JAR="/절대/경로/tika-server-standard-2.9.2.jar"
#   ./start.sh
# (또는 Git Bash 영구 설정: ~/.bashrc 에 위처럼 추가)
#
# 변수:
#   TIKA_JAR        tika-server-standard-*.jar 전체 경로 (없으면 Tika 안 띄움)
#   TIKA_SERVER_PORT 듣는 포트 (기본 9998)
#   JAVA_BIN        java 실행 파일 (기본: PATH의 java)
#
TIKA_SERVER_PORT="${TIKA_SERVER_PORT:-9998}"
JAVA_BIN="${JAVA_BIN:-java}"
if [ -n "${TIKA_JAR:-}" ] && [ -f "$TIKA_JAR" ]; then
    if port_in_use "$TIKA_SERVER_PORT"; then
        echo "[OK] Port $TIKA_SERVER_PORT in use — Tika Server로 간주하고 넘어갑니다"
    else
        if ! command -v "$JAVA_BIN" &>/dev/null; then
            echo "[WARN] TIKA_JAR 은 있는데 JAVA_BIN을 찾을 수 없습니다. Tika 건너뜀."
        else
            echo "[INFO] Starting Tika Server (JAR, port $TIKA_SERVER_PORT)..."
            nohup "$JAVA_BIN" -jar "$TIKA_JAR" --host=0.0.0.0 --port="$TIKA_SERVER_PORT" \
                > logs/tika.log 2>&1 &
            TIKA_PID=$!
            echo "$TIKA_PID" > logs/tika.pid
            for _i in $(seq 1 40); do
                if port_in_use "$TIKA_SERVER_PORT"; then
                    echo "[OK] Tika Server started (PID: $TIKA_PID)"
                    break
                fi
                sleep 0.25
            done
            if ! port_in_use "$TIKA_SERVER_PORT"; then
                echo "[WARN] Tika가 ${TIKA_SERVER_PORT} 포트에서 안 떴을 수 있습니다. logs/tika.log 확인"
            fi
        fi
    fi
    export TIKA_SERVER_URL="${TIKA_SERVER_URL:-http://127.0.0.1:${TIKA_SERVER_PORT}}"
    echo "[INFO] TIKA_SERVER_URL=$TIKA_SERVER_URL (백엔드/워커에 전달)"
elif [ -n "${TIKA_SERVER_URL:-}" ]; then
    echo "[INFO] TIKA_JAR 없음 — 이미 설정된 TIKA_SERVER_URL=$TIKA_SERVER_URL 사용"
else
    echo "[INFO] Tika 자동 기동 안 함 (TIKA_JAR 미설정). Office 추출은 Tika Server를 별도로 띄우거나 TIKA_SERVER_URL을 설정하세요."
fi

# ── Custom Java Tika Extract Server (tika-server/) ───────────────────────
# JAR 자동 탐색: TIKA_JAVA_JAR 환경변수 → 빌드 결과물
TIKA_JAVA_PORT="${TIKA_JAVA_PORT:-9090}"
if [ -z "${TIKA_JAVA_JAR:-}" ]; then
    FOUND=$(ls tika-server/target/tika-extract-server-*.jar 2>/dev/null | head -1)
    [ -n "$FOUND" ] && TIKA_JAVA_JAR="$FOUND"
fi

if [ -n "${TIKA_JAVA_JAR:-}" ] && [ -f "$TIKA_JAVA_JAR" ]; then
    if port_in_use "$TIKA_JAVA_PORT"; then
        echo "[OK] Port $TIKA_JAVA_PORT in use — Tika Java Server로 간주"
    elif ! command -v "$JAVA_BIN" &>/dev/null; then
        echo "[WARN] TIKA_JAVA_JAR 있는데 java를 찾을 수 없습니다. 건너뜀."
    else
        echo "[INFO] Starting Tika Java Extract Server (port $TIKA_JAVA_PORT)..."
        nohup "$JAVA_BIN" -jar "$TIKA_JAVA_JAR" "$TIKA_JAVA_PORT" \
            > logs/tika-java.log 2>&1 &
        TIKA_JAVA_PID=$!
        echo "$TIKA_JAVA_PID" > logs/tika-java.pid
        for _i in $(seq 1 40); do
            if port_in_use "$TIKA_JAVA_PORT"; then
                echo "[OK] Tika Java Server started (PID: $TIKA_JAVA_PID)"
                break
            fi
            sleep 0.25
        done
        if ! port_in_use "$TIKA_JAVA_PORT"; then
            echo "[WARN] Tika Java Server가 ${TIKA_JAVA_PORT}에서 안 떴습니다. logs/tika-java.log 확인"
        fi
    fi
    export TIKA_JAVA_SERVER_URL="http://127.0.0.1:${TIKA_JAVA_PORT}"
    echo "[INFO] TIKA_JAVA_SERVER_URL=$TIKA_JAVA_SERVER_URL"
else
    echo "[INFO] Tika Java Server 건너뜀 — JAR 없음"
    echo "       빌드: cd tika-server && mvn package -q && cd .."
fi

# ── Frontend .env.local 설정 ───────────────────────────────
# 이미 .env.local이 존재하면 그대로 사용 (수동 설정 존중)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    # Windows fallback: ipconfig로 IPv4 주소 추출
    SERVER_IP=$(ipconfig 2>/dev/null | grep -m1 "IPv4" | awk '{print $NF}' | tr -d '\r')
fi
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="localhost"
fi

if [ -f "frontend/.env.local" ]; then
    echo "[INFO] frontend/.env.local already exists, keeping existing config:"
    echo "       $(cat frontend/.env.local)"
else
    cat > frontend/.env.local <<EOF
NEXT_PUBLIC_API_URL=http://${SERVER_IP}:${BACKEND_PORT}
EOF
    echo "[INFO] frontend/.env.local generated (API -> http://${SERVER_IP}:${BACKEND_PORT})"
fi

# ── Backend 시작 ──────────────────────────────────────────
if [ "$SKIP_BACKEND" = true ]; then
    BACKEND_PID="(existing)"
else
    echo "[INFO] Starting backend server..."
    cd backend
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    TIKA_SERVER_URL="${TIKA_SERVER_URL:-}" \
    TIKA_JAVA_SERVER_URL="${TIKA_JAVA_SERVER_URL:-}" \
    nohup "$PYTHON_BIN" -m uvicorn main:app \
        --host "$BACKEND_HOST" \
        --port "$BACKEND_PORT" \
        > ../logs/backend.log 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > ../logs/backend.pid
    cd ..
    echo "[OK] Backend started (PID: $BACKEND_PID)"
fi

# ── Celery Worker 시작 ────────────────────────────────────
echo "[INFO] Starting Celery OCR Worker..."
cd backend
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
TIKA_SERVER_URL="${TIKA_SERVER_URL:-}" \
TIKA_JAVA_SERVER_URL="${TIKA_JAVA_SERVER_URL:-}" \
nohup "$PYTHON_BIN" -m celery -A tasks.celery_app worker \
    -Q ocr \
    -n ocr_worker@%h \
    --loglevel=info \
    --pool=solo \
    > ../logs/worker.log 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > ../logs/worker.pid
cd ..
echo "[OK] Celery Worker started (PID: $WORKER_PID)"

# ── Frontend 개발 모드로 시작 (hot reload 지원) ────────────────────
echo "[INFO] Starting frontend server (dev mode with hot reload)..."
cd frontend
nohup npx next dev --turbo \
    -p "$FRONTEND_PORT" \
    -H "$FRONTEND_HOST" \
    > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > ../logs/frontend.pid
cd ..
echo "[OK] Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "========================================"
echo "  Servers started successfully!"
echo "========================================"
echo "  Backend:  http://${SERVER_IP}:${BACKEND_PORT}  (PID: $BACKEND_PID)"
echo "  Frontend: http://${SERVER_IP}:${FRONTEND_PORT}  (PID: $FRONTEND_PID)"
echo "  Worker:   Celery OCR Worker            (PID: $WORKER_PID)"
if [ -n "${TIKA_JAVA_SERVER_URL:-}" ]; then
    echo "  TikaJava: ${TIKA_JAVA_SERVER_URL}  (logs/tika-java.log)"
fi
if [ -n "${TIKA_SERVER_URL:-}" ]; then
    echo "  Tika:     ${TIKA_SERVER_URL}"
fi
echo ""
echo "  Logs:     tail -f logs/backend.log"
echo "            tail -f logs/frontend.log"
echo "            tail -f logs/worker.log"
echo "            tail -f logs/redis.log"
echo "            tail -f logs/tika.log"
echo "  Stop:     ./stop.sh"
echo "  Status:   ./status.sh"
echo "========================================"
