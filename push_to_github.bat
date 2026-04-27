@echo off
echo ===================================================
echo GitHub 업로드를 시작합니다...
echo ===================================================

git add .
git commit -m "Enhance OCR job visibility, add real-time progress, sidebar indicator, and UI improvements"
git push -u origin main

echo.
echo ===================================================
echo 완료되었습니다! 변경사항이 GitHub에 적용되었습니다.
echo 아무 키나 누르면 창이 닫힙니다.
echo ===================================================
pause > nul
