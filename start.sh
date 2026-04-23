#!/bin/bash
#
# BBOCR Server Launcher
# config.yaml에서 포트를 읽어 백엔드 + 프론트엔드를 시작합니다.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN="python"

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
        if port_in_use "$BACKEND_PORT"; then
            echo "[ERROR] Cannot free port $BACKEND_PORT. Run: ./stop.sh"
            exit 1
        fi
    fi
fi

if port_in_use "$FRONTEND_PORT"; then
    echo "[INFO] Frontend port $FRONTEND_PORT in use. Killing..."
    kill_port "$FRONTEND_PORT"
    sleep 1
    if port_in_use "$FRONTEND_PORT"; then
        echo "[ERROR] Cannot free port $FRONTEND_PORT. Run: ./stop.sh"
        exit 1
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
nohup "$PYTHON_BIN" -m celery -A ocr_worker worker \
    -Q ocr \
    -n ocr_worker@%h \
    --loglevel=info \
    --pool=solo \
    > ../logs/worker.log 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > ../logs/worker.pid
cd ..
echo "[OK] Celery Worker started (PID: $WORKER_PID)"

# ── Frontend 빌드 후 프로덕션 모드로 시작 ────────────────────
# Windows에서 next dev의 webpack.js 파일 잠금(errno -4094) 문제를 회피합니다.
echo "[INFO] Building frontend (production build)..."
cd frontend
npx next build > ../logs/frontend_build.log 2>&1
if [ $? -ne 0 ]; then
    echo "[ERROR] Frontend build failed. See logs/frontend_build.log"
    cat ../logs/frontend_build.log | tail -20
    exit 1
fi
echo "[INFO] Starting frontend server (production mode)..."
nohup npx next start \
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
echo ""
echo "  Logs:     tail -f logs/backend.log"
echo "            tail -f logs/frontend.log"
echo "            tail -f logs/worker.log"
echo "            tail -f logs/redis.log"
echo "  Stop:     ./stop.sh"
echo "  Status:   ./status.sh"
echo "========================================"
