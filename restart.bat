@echo off
echo Stopping all python and node processes...
taskkill /F /IM python.exe /T
taskkill /F /IM node.exe /T
timeout /t 3

set PYTHON=%USERPROFILE%\anaconda3\envs\bbocr\python.exe
set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
set KMP_DUPLICATE_LIB_OK=True

echo Starting backend...
cd backend
start "OCR Backend" "%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 6015

echo Starting worker...
start "OCR Worker" "%PYTHON%" -m celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo

echo Starting frontend...
cd ..\frontend
start "OCR Frontend" npm run start

echo Done.
