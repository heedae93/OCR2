from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from database import Session, User

# Database connection details from the code
DATABASE_URL = "postgresql+psycopg2://ocr_user:1234@192.168.0.231:3306/ocr_db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def check():
    db = SessionLocal()
    try:
        # Check session counts per user_id
        counts = db.query(Session.user_id, func.count(Session.session_id)).group_by(Session.user_id).all()
        print("Session counts per user_id:")
        for user_id, count in counts:
            print(f"  User ID: '{user_id}', Count: {count}")
            
        # Check all users
        users = db.query(User).all()
        print("\nAll users in DB:")
        for user in users:
            print(f"  User ID: '{user.user_id}', Name: '{user.username}'")
            
    finally:
        db.close()

if __name__ == "__main__":
    check()
