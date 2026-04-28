import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'backend', 'data', 'ocr_gen.db')
print(f"Connecting to {db_path}...")
conn = sqlite3.connect(db_path, timeout=30.0)
c = conn.cursor()

try:
    c.execute("ALTER TABLE jobs ADD COLUMN summary TEXT")
    print("Added summary column")
except Exception as e:
    print(f"Summary column: {e}")

try:
    c.execute("ALTER TABLE jobs ADD COLUMN citations TEXT")
    print("Added citations column")
except Exception as e:
    print(f"Citations column: {e}")

conn.commit()
conn.close()
print("Done.")
