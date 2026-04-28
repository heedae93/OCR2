import psycopg2
import sys

try:
    print("Attempting to connect to PostgreSQL at 192.168.0.231...")
    import psycopg2
    conn = psycopg2.connect(
        dbname="ocr_db",
        user="ocr_user",
        password="1234",
        host="192.168.0.231",
        port="3306"
    )

    # Note: We can't set client_encoding until after connect, but the crash happens during connect.
    # But wait! If we set environment variable...




    print("Connection successful!")
    cur = conn.cursor()
    cur.execute("SHOW server_encoding;")
    print(f"Server Encoding: {cur.fetchone()[0]}")
    cur.execute("SHOW client_encoding;")
    print(f"Client Encoding: {cur.fetchone()[0]}")
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")
    import traceback
    traceback.print_exc()
