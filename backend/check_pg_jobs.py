import psycopg2
import sys

try:
    print("Connecting to PostgreSQL at 192.168.0.231:3306...")
    conn = psycopg2.connect(
        dbname="ocr_db",
        user="ocr_user",
        password="1234",
        host="192.168.0.231",
        port="3306"
    )
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM jobs;")
    count = cur.fetchone()[0]
    print(f"Total jobs in PostgreSQL: {count}")
    
    cur.execute("SELECT job_id, status FROM jobs LIMIT 5;")
    for row in cur.fetchall():
        print(f"Job: {row[0]} | Status: {row[1]}")
        
    conn.close()
except Exception as e:
    print(f"Error: {e}")
