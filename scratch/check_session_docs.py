
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import SessionLocal, SessionDocument, Job

session_id = '05f4e033-2aef-4866-b167-b41649617f6c'
db = SessionLocal()
docs = db.query(SessionDocument).filter_by(session_id=session_id).all()
print(f"Session {session_id} has {len(docs)} documents.")
for doc in docs:
    job = db.query(Job).filter_by(job_id=doc.job_id).first()
    if job:
        print(f"  Job: {job.job_id}, filename: {job.original_filename}, status: {job.status}")
    else:
        print(f"  Job ID {doc.job_id} NOT found in Job table!")
db.close()
