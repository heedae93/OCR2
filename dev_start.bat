@echo off
setlocal
title BBOCR GPU Starter

:: Set Python Path
set PYTHON_EXE=C:\Users\glgld\.conda\envs\bbocr\python.exe

echo ========================================
echo   BBOCR Integrated Starter (GPU)
echo ========================================

:: 1. Cleanup old processes
echo [1/4] Cleaning up existing processes...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

:: 2. Clear Next.js cache
echo [2/4] Clearing frontend cache...
if exist "frontend\.next" (
    rmdir /s /q "frontend\.next"
)

:: 3. Start Redis Server
echo [3/6] Starting Redis...
tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server.exe" >nul
if errorlevel 1 (
    start "BBOCR-Redis" /min "C:\Program Files\Redis\redis-server.exe"
    echo [OK] Redis started
) else (
    echo [OK] Redis already running
)

:: 4. Start Tika Java Extract Server
echo [3/5] Starting Tika Java Extract Server...
set TIKA_JAVA_PORT=9090
set TIKA_JAVA_JAR=
for %%f in (tika-server\target\tika-extract-server-*.jar) do set TIKA_JAVA_JAR=%%f
if defined TIKA_JAVA_JAR (
    set TIKA_JAVA_SERVER_URL=http://127.0.0.1:%TIKA_JAVA_PORT%
    start "BBOCR-TikaJava" /min java -jar "%TIKA_JAVA_JAR%" %TIKA_JAVA_PORT%
    echo [OK] Tika Java Server starting on port %TIKA_JAVA_PORT%
) else (
    echo [INFO] Tika Java Server JAR not found - skipping
    echo        Build: cd tika-server ^&^& mvn package -q ^&^& cd ..
)

:: 5. Start Backend and Worker
echo [5/6] Starting Backend and Worker (GPU)...
set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
set KMP_DUPLICATE_LIB_OK=True
set CUDA_VISIBLE_DEVICES=0

:: Start Backend
start "BBOCR-Backend" /min cmd /c "set TIKA_JAVA_SERVER_URL=%TIKA_JAVA_SERVER_URL% && "%PYTHON_EXE%" -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 6015 --reload"

:: Start Worker Supervisor
cd backend
start "BBOCR-WorkerSupervisor" /min cmd /c "set TIKA_JAVA_SERVER_URL=%TIKA_JAVA_SERVER_URL% && set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True && set WORKER_QUEUES=ocr,tika && "%PYTHON_EXE%" scripts\worker_supervisor.py --queues ocr,tika"
cd ..

:: 6. Start Frontend
echo [6/6] Starting Frontend...
cd frontend
start "BBOCR-Frontend" /min cmd /c "npm run dev"
cd ..

echo ========================================
echo   Servers started in GPU mode!
echo   - Backend:    http://localhost:6015
echo   - Frontend:   http://localhost:6017
if defined TIKA_JAVA_JAR (
    echo   - TikaJava:  http://localhost:%TIKA_JAVA_PORT%
)
echo ========================================
pause
