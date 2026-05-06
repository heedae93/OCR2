
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import SessionLocal, Session, User, Job, SessionDocument

db = SessionLocal()
try:
    users = db.query(User).all()
    print(f"Total Users: {len(users)}")
    for u in users:
        print(f"User: {u.username} ({u.user_id})")

    sessions = db.query(Session).all()
    print(f"\nTotal Sessions: {len(sessions)}")
    for s in sessions:
        print(f"Session: {s.session_name} ({s.session_id}), User: {s.user_id}")
        
    jobs = db.query(Job).all()
    print(f"\nTotal Jobs: {len(jobs)}")
    
    session_docs = db.query(SessionDocument).all()
    print(f"\nTotal Session Documents: {len(session_docs)}")

finally:
    db.close()
