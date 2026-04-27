#!/bin/bash
#
# BBOCR Server Shutdown
# config.yaml에서 포트를 읽어 해당 프로세스를 종료합니다.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── config.yaml에서 포트 읽기 ─────────────────────────────
PYTHON_BIN="python"

read_ports() {
    "$PYTHON_BIN" -c "
import yaml
with open('config.yaml', 'r') as f:
    cfg = yaml.safe_load(f)
server = cfg.get('server', {})
print(server.get('backend', {}).get('port', 6015))
print(server.get('frontend', {}).get('port', 6017))
" 2>/dev/null
}

PORTS=$(read_ports)
BACKEND_PORT=$(echo "$PORTS" | sed -n '1p')
FRONTEND_PORT=$(echo "$PORTS" | sed -n '2p')

echo "========================================"
echo "  BBOCR Server Shutdown"
echo "========================================"

# ── 포트에서 PID 추출 (Windows netstat 기반) ─────────────
get_pids_on_port() {
    local port="$1"
    netstat -ano 2>/dev/null \
        | grep -E ":${port}[[:space:]].*LISTEN" \
        | awk '{print $NF}' \
        | sort -u \
        | grep -v '^0$'
}

# ── 서버 종료 함수 ──────────────────────────────────────────
# PID 파일 → 포트 기반 fallback (Windows: taskkill)
stop_server() {
    local name="$1"
    local pid_file="$2"
    local port="$3"

    # 1) PID 파일로 종료
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null
            sleep 0.5
            # 아직 살아있으면 강제 종료
            kill -9 "$PID" 2>/dev/null
            echo "[OK] $name stopped (PID: $PID)"
        fi
        rm -f "$pid_file"
    fi

    # 2) 포트에 남아있는 프로세스 정리 (Windows taskkill)
    PIDS=$(get_pids_on_port "$port")
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            taskkill //F //PID "$pid" > /dev/null 2>&1 && \
                echo "[OK] $name: killed PID $pid on port $port"
        done
    fi
}

stop_server "Backend"  "logs/backend.pid"  "$BACKEND_PORT"
stop_server "Frontend" "logs/frontend.pid" "$FRONTEND_PORT"

# ── Celery Worker 종료 ────────────────────────────────────
if [ -f "logs/worker.pid" ]; then
    WORKER_PID=$(cat logs/worker.pid)
    if kill -0 "$WORKER_PID" 2>/dev/null; then
        kill "$WORKER_PID" 2>/dev/null
        echo "[OK] Celery Worker stopped (PID: $WORKER_PID)"
    fi
    rm -f logs/worker.pid
fi

# ── Redis 종료 ────────────────────────────────────────────
if [ -f "logs/redis.pid" ]; then
    REDIS_PID=$(cat logs/redis.pid)
    if kill -0 "$REDIS_PID" 2>/dev/null; then
        kill "$REDIS_PID" 2>/dev/null
        echo "[OK] Redis stopped (PID: $REDIS_PID)"
    fi
    rm -f logs/redis.pid
fi

echo "========================================"
echo "  All servers stopped."
echo "========================================"
