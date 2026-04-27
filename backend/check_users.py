import psycopg2
import sys

try:
    conn = psycopg2.connect(
        dbname="ocr_db",
        user="ocr_user",
        password="1234",
        host="192.168.0.231",
        port="3306"
    )
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT user_id FROM jobs;")
    users = cur.fetchall()
    print(f"User IDs in jobs table: {[u[0] for u in users]}")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
