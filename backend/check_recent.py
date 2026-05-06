from database import SessionLocal, Session, SessionDocument, Job

def check():
    db = SessionLocal()
    sessions = db.query(Session).order_by(Session.created_at.desc()).limit(5).all()
    for s in sessions:
        print(f"Session: {s.session_name} ({s.session_id})")
        docs = db.query(SessionDocument).filter_by(session_id=s.session_id).order_by(SessionDocument.order).all()
        for d in docs:
            job = db.query(Job).filter_by(job_id=d.job_id).first()
            if job:
                print(f"  Job: {d.job_id}, Order: {d.order}, Status: {job.status}")
    db.close()

if __name__ == '__main__':
    check()
