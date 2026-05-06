from database import SessionLocal, Session, SessionDocument, Job

def check():
    db = SessionLocal()
    s = db.query(Session).filter(Session.session_name.like('%21%')).first()
    if s:
        print(f"Session: {s.session_name} ({s.session_id})")
        docs = db.query(SessionDocument).filter_by(session_id=s.session_id).order_by(SessionDocument.order).all()
        for d in docs:
            job = db.query(Job).filter_by(job_id=d.job_id).first()
            print(f"Job: {d.job_id}, Order: {d.order}, Status: {job.status}")
    else:
        print("Session 21 not found")
    db.close()

if __name__ == '__main__':
    check()
