import sys
sys.path.insert(0, ".")
from database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# session_documents 테이블 존재 확인
try:
    sql = """
        SELECT j.job_id, j.status, j.error_message, j.original_filename
        FROM jobs j
        JOIN session_documents sd ON j.job_id = sd.job_id
        WHERE sd.session_id = 'e59c6298-1ac1-46a6-8b75-0dde8227e81c'
        ORDER BY j.created_at DESC
    """
    rows = db.execute(text(sql)).fetchall()
    for r in rows:
        print(f"job_id={r[0]}")
        print(f"  status={r[1]}  file={r[3]}")
        print(f"  error={r[2]}")
        print()
except Exception as e:
    print("session_documents 조회 실패:", e)
    # 테이블 목록 확인
    tables = db.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    print("DB 테이블:", [t[0] for t in tables])

db.close()
