@echo off
chcp 65001 >nul
title Install LibreOffice (BBOCR / soffice)
echo.
echo LibreOffice를 설치합니다. 관리자 권한이 필요할 수 있습니다.
echo 설치 후 BBOCR 백엔드·Celery 워커를 재시작하세요.
echo.
where winget >nul 2>&1
if errorlevel 1 (
  echo [오류] winget을 찾을 수 없습니다. Windows 10/11 앱 설치 관리자를 켜거나
  echo         https://www.libreoffice.org/download/download/ 에서 MSI를 내려받아 설치하세요.
  pause
  exit /b 1
)
winget install --id TheDocumentFoundation.LibreOffice -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo winget 설치가 실패하면 브라우저에서 직접 내려받기:
  echo   https://www.libreoffice.org/download/download/
  echo 기본 경로 예: C:\Program Files\LibreOffice\program\soffice.exe
  pause
  exit /b 1
)
echo.
echo 설치가 끝났으면 프로젝트 루트에서 restart_bbocr.cmd 으로 서버를 다시 켜 주세요.
pause
