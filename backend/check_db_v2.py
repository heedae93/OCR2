
from sqlalchemy import create_engine, text
url = 'postgresql+psycopg2://ocr_user:1234@192.168.0.231:3306/ocr_db'
engine = create_engine(url)
try:
    with engine.connect() as conn:
        res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs'"))
        cols = [r[0] for r in res]
        print(f"Columns in jobs: {cols}")
        
        # Also check if any sessions are blocking
        res = conn.execute(text("SELECT pid, state, query FROM pg_stat_activity WHERE datname = 'ocr_db'"))
        sessions = res.fetchall()
        print(f"Active sessions: {len(sessions)}")
except Exception as e:
    print(f"Error: {e}")
