
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import SessionLocal, Job

job_id = '05f4e033-2aef-4866-b167-b41649617f6c'
db = SessionLocal()
job = db.query(Job).filter_by(job_id=job_id).first()
if job:
    print(f"Job found: {job.job_id}, filename: {job.original_filename}, user_id: {job.user_id}")
else:
    print("Job NOT found in DB")
db.close()
