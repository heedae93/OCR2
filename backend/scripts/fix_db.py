import sys
sys.path.insert(0, 'backend')
from database import SessionLocal, User

db = SessionLocal()

# 확인
users = db.query(User).all()
print('--- 현재 users 테이블 (MariaDB) ---')
for u in users:
    print(f"user_id={u.user_id}, username={u.username}, name={u.name}, email={u.email}, type={getattr(u, 'type', None)}")

db.close()
