@echo off
setlocal
cd /d "%~dp0"

echo [restart] stopping node/python...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [restart] clearing .next...
if exist "frontend\.next" rmdir /s /q "frontend\.next"

set "PYTHON_EXE=C:\Users\USER\anaconda3\envs\bbocr\python.exe"
set "TIKA_JAVA_PORT=9090"
set "TIKA_JAVA_JAR="
for %%f in (tika-server\target\tika-extract-server-*.jar) do set "TIKA_JAVA_JAR=%%f"

if defined TIKA_JAVA_JAR (
  set "TIKA_JAVA_SERVER_URL=http://127.0.0.1:%TIKA_JAVA_PORT%"
  start "BBOCR-TikaJava" /min java -jar "%TIKA_JAVA_JAR%" %TIKA_JAVA_PORT%
) else (
  set "TIKA_JAVA_SERVER_URL="
)

set "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True"
set "KMP_DUPLICATE_LIB_OK=True"
set "CUDA_VISIBLE_DEVICES=0"

start "BBOCR-Backend" /min cmd /c "set TIKA_JAVA_SERVER_URL=%TIKA_JAVA_SERVER_URL% && "%PYTHON_EXE%" -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 6015 --reload"
cd /d "%~dp0backend"
start "BBOCR-Worker" /min cmd /c "set TIKA_JAVA_SERVER_URL=%TIKA_JAVA_SERVER_URL% && set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True && "%PYTHON_EXE%" -m celery -A tasks.celery_app worker -Q ocr,tika --loglevel=info --pool=solo"
cd /d "%~dp0"
start "BBOCR-Frontend" /min cmd /c "cd /d %~dp0frontend && npm run dev"

echo [restart] backend 6015, frontend 6017, worker started.
endlocal
