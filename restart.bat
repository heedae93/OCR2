@echo off
echo Stopping all python and node processes...
taskkill /F /IM python.exe /T
taskkill /F /IM node.exe /T
timeout /t 3

echo Starting backend...
set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
cd backend
start /B "" python -m uvicorn main:app --host 0.0.0.0 --port 6015 > ..\logs\backend.log 2>&1

echo Starting worker...
start /B "" python -m celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo > ..\logs\worker.log 2>&1

echo Starting frontend...
cd ..\frontend
start /B "" npm run dev > ..\logs\frontend.log 2>&1

echo Done.

