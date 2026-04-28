
from sqlalchemy import create_engine, text
url = 'postgresql+psycopg2://ocr_user:1234@192.168.0.231:3306/ocr_db'
engine = create_engine(url)
try:
    with engine.connect() as conn:
        # Kill all sessions except current
        query = text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ocr_db' AND pid <> pg_backend_pid()")
        res = conn.execute(query)
        print(f'Terminated {res.rowcount} sessions.')
except Exception as e:
    print(f'Error: {e}')
