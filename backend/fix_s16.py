from database import SessionLocal
from utils.db_helper import update_job_status
from utils.job_manager import JobManager
from models.job import JobStatus

def fix():
    jid = 'f27625f1-5d43-4e1f-97ca-8e4ae675055f'
    msg = '큐 대기 시간 초과'
    update_job_status(jid, 'failed', error_message=msg)
    manager = JobManager()
    manager.update_job(jid, status=JobStatus.FAILED, message=msg)
    print(f"Fixed {jid}")

if __name__ == '__main__':
    fix()
