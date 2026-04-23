import psycopg2
import sys

def test_pg():
    print("Attempting to connect to PostgreSQL at 192.168.0.231:5432...")
    try:
        conn = psycopg2.connect(
            host="192.168.0.231",
            port=5432,
            user="ocr_user",
            password="1234",
            dbname="ocr_db",
            connect_timeout=5
        )
        print("PostgreSQL Connection successful!")
        conn.close()
        return True
    except Exception as e:
        print(f"PostgreSQL Connection failed.")
        try:
            # Try to recover the message from the UnicodeDecodeError
            import traceback
            tb = traceback.format_exc()
            print(tb)
        except:
            print(f"Error: {e}")
        return False

def test_mysql():
    print("\nAttempting to connect to MySQL/MariaDB at 192.168.0.231:3306...")
    try:
        import pymysql
        conn = pymysql.connect(
            host="192.168.0.231",
            port=3306,
            user="ocr_user",
            password="1234",
            database="ocr_db",
            connect_timeout=5
        )
        print("MySQL Connection successful!")
        conn.close()
        return True
    except Exception as e:
        print(f"MySQL Connection failed: {e}")
        return False

if __name__ == "__main__":
    if not test_pg():
        test_mysql()
