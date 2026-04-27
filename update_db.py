import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from database import engine
from sqlalchemy import text

def update():
    with engine.connect() as conn:
        # DB 엔진에 따라 컬럼 추가 구문 실행
        try:
            conn.execute(text("ALTER TABLE jobs ADD COLUMN summary TEXT"))
            print("Added summary column.")
        except Exception as e:
            print("Summary column might already exist:", str(e).split('\n')[0])
            
        try:
            conn.execute(text("ALTER TABLE jobs ADD COLUMN citations TEXT"))
            print("Added citations column.")
        except Exception as e:
            print("Citations column might already exist:", str(e).split('\n')[0])
            
        conn.commit()

if __name__ == "__main__":
    update()
