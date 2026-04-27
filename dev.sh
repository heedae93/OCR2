#!/bin/bash
#
# BBOCR 개발 서버 (핫 리로드)
#
# 백엔드: --reload (Python 파일 변경 시 자동 재시작)
# 프론트엔드: next dev --turbopack (저장 즉시 반영, 빌드 불필요)
#
# 사용법: bash dev.sh
# 종료:   Ctrl+C  또는  bash stop.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── config.yaml에서 설정 읽기 ──────────────────────────────
read_config() {
    /c/Users/glgld/.conda/envs/bbocr/python.exe -c "
import yaml, sys
with open('config.yaml', 'r', encoding='utf-8') as f:
    cfg = yaml.safe_load(f)
server = cfg.get('server', {})
be = server.get('backend', {})
fe = server.get('frontend', {})
print(be.get('host', '0.0.0.0'))
print(be.get('port', 6015))
print(fe.get('host', '0.0.0.0'))
print(fe.get('port', 6017))
" 2>/dev/null
}

CONFIG_OUTPUT=$(read_config)
if [ -z "$CONFIG_OUTPUT" ]; then
    echo "[ERROR] config.yaml 파싱 실패. 기본값을 사용합니다."
    BACKEND_HOST="0.0.0.0"
    BACKEND_PORT=6015
    FRONTEND_HOST="0.0.0.0"
    FRONTEND_PORT=6017
else
    BACKEND_HOST=$(echo "$CONFIG_OUTPUT" | sed -n '1p')
    BACKEND_PORT=$(echo "$CONFIG_OUTPUT" | sed -n '2p')
    FRONTEND_HOST=$(echo "$CONFIG_OUTPUT" | sed -n '3p')
    FRONTEND_PORT=$(echo "$CONFIG_OUTPUT" | sed -n '4p')
fi

echo "========================================"
echo "  BBOCR 개발 서버 (핫 리로드)"
echo "========================================"
echo "  Backend:  http://localhost:${BACKEND_PORT}  (--reload)"
echo "  Frontend: http://localhost:${FRONTEND_PORT}  (next dev)"
echo "========================================"

# ── 이미 실행 중인지 확인 ──────────────────────────────────
port_in_use() {
    netstat -an 2>/dev/null | grep -q ":$1 .*LISTEN" || \
    netstat -an 2>/dev/null | grep -q ":$1 .*LISTENING"
}

if port_in_use "$BACKEND_PORT"; then
    echo "[WARN] Backend port $BACKEND_PORT already in use. Run: bash stop.sh"
    exit 1
fi

if port_in_use "$FRONTEND_PORT"; then
    echo "[WARN] Frontend port $FRONTEND_PORT already in use. Run: bash stop.sh"
    exit 1
fi

mkdir -p logs

# ── Frontend .env.local 설정 ───────────────────────────────
if [ ! -f "frontend/.env.local" ]; then
    cat > frontend/.env.local <<EOF
NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
EOF
    echo "[INFO] frontend/.env.local 생성됨"
else
    echo "[INFO] frontend/.env.local 유지: $(cat frontend/.env.local)"
fi

# ── Backend 시작 (--reload) ───────────────────────────────
echo "[INFO] 백엔드 시작 (자동 재시작 활성화)..."
cd backend
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
nohup /c/Users/glgld/.conda/envs/bbocr/python.exe -m uvicorn main:app \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT" \
    --reload \
    > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > ../logs/backend.pid
cd ..
echo "[OK] Backend started (PID: $BACKEND_PID)"

# ── Frontend 개발 서버 시작 (빌드 없이 즉시 시작) ────────────
# 이전 프로덕션 빌드의 .next 디렉터리가 남아있으면 webpack.js 파일 잠금 오류 발생
# (Windows errno -4094) → 삭제 후 시작
echo "[INFO] .next 캐시 정리 중..."
rm -rf frontend/.next

echo "[INFO] 프론트엔드 개발 서버 시작 (next dev)..."
cd frontend
nohup npx next dev \
    -p "$FRONTEND_PORT" \
    -H "$FRONTEND_HOST" \
    > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > ../logs/frontend.pid
cd ..
echo "[OK] Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "========================================"
echo "  개발 서버 실행 중!"
echo "========================================"
echo "  접속: http://localhost:${FRONTEND_PORT}"
echo ""
echo "  변경 사항 반영:"
echo "    - 프론트엔드(.tsx): 저장 즉시 자동 반영"
echo "    - 백엔드(.py):      저장 즉시 자동 재시작"
echo "    - config.yaml:      bash stop.sh && bash dev.sh 필요"
echo ""
echo "  로그:  tail -f logs/backend.log"
echo "         tail -f logs/frontend.log"
echo "  종료:  bash stop.sh"
echo "========================================"
