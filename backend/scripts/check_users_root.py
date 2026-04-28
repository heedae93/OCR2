import sys
sys.path.insert(0, 'backend')
from database import SessionLocal, User

db = SessionLocal()
users = db.query(User).all()
print(f"총 {len(users)}명")
for u in users:
    print(f"  user_id={u.user_id}, username={u.username}, email={u.email}, name={u.name}")
db.close()
