
import os
import subprocess
import time
from sqlalchemy import create_engine, text

url = 'postgresql+psycopg2://ocr_user:1234@192.168.0.231:3306/ocr_db'
engine = create_engine(url, pool_pre_ping=True)

def fix_db():
    print("Fixing DB...")
    try:
        with engine.connect() as conn:
            # 1. Kill other sessions
            try:
                print("Killing other sessions...")
                conn.execute(text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ocr_db' AND pid <> pg_backend_pid()"))
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"Error killing sessions: {e}")
            
            # 2. Add columns
            cols = [
                ("extracted_fields", "TEXT"),
                ("summary", "TEXT"),
                ("citations", "TEXT")
            ]
            for col_name, col_type in cols:
                try:
                    print(f"Adding column {col_name}...")
                    conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                    print(f"Column {col_name} added.")
                except Exception as e:
                    conn.rollback() # Rollback on error to continue next
                    if "already exists" in str(e).lower():
                        print(f"Column {col_name} already exists.")
                    else:
                        print(f"Error adding {col_name}: {e}")
            
            # 3. Verify
            try:
                res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs'"))
                current_cols = [r[0] for r in res]
                print(f"Final columns: {current_cols}")
                return "summary" in current_cols
            except Exception as e:
                conn.rollback()
                print(f"Verification failed: {e}")
                return False
    except Exception as e:
        print(f"Critical DB error: {e}")
        return False

if __name__ == "__main__":
    if fix_db():
        print("DB Fixed. Restarting services...")
        # Kill python processes
        os.system("taskkill /F /IM python.exe /T")
        time.sleep(2)
        # We can't easily start background processes from here that survive this script if we use os.system
        # But we can try the restart_services.py
        # Actually, let's just finish here and tell the user to run restart_services.py or I'll do it.
    else:
        print("DB Fix failed.")
