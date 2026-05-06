from database import SessionLocal
from utils.db_helper import update_job_status
from utils.job_manager import JobManager
from models.job import JobStatus

def fix():
    ids = ['b6f0c9fe-34bd-4db6-a51d-c1921bc72eb8', '4589b9eb-f930-4c13-b35c-fe94e194df6f', '26cf936e-36c1-4b0e-bbd0-a848749ae1ad']
    msg = 'Redis 서버 연결 실패'
    manager = JobManager()
    for jid in ids:
        update_job_status(jid, 'failed', error_message=msg)
        manager.update_job(jid, status=JobStatus.FAILED, message=msg)
    print(f"Fixed {len(ids)} jobs in Session 20")

if __name__ == '__main__':
    fix()
