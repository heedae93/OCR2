@echo off
setlocal
title BBOCR GPU Starter

:: Set Python Path
set PYTHON_EXE=C:\Users\USER\anaconda3\envs\bbocr\python.exe

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

:: 3. Start Backend and Worker
echo [3/4] Starting Backend and Worker (GPU)...
set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
set KMP_DUPLICATE_LIB_OK=True
set CUDA_VISIBLE_DEVICES=0

:: Start Backend
start "BBOCR-Backend" /min "%PYTHON_EXE%" -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 6015 --reload

:: Start Worker
cd backend
start "BBOCR-Worker" /min "%PYTHON_EXE%" -m celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo
cd ..

:: 4. Start Frontend
echo [4/4] Starting Frontend...
cd frontend
start "BBOCR-Frontend" /min npm run dev -- --port 6017
cd ..

echo ========================================
echo   Servers started in GPU mode!
echo   - Backend:  http://localhost:6015
echo   - Frontend: http://localhost:6017
echo ========================================
pause
