import sys
import os

# 백엔드 모듈을 불러오기 위해 경로 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from database import SessionLocal, Job
from ocr_worker import process_ocr_task

def re_enqueue_queued_jobs():
    db = SessionLocal()
    try:
        # 이전에 DB상으로만 'queued'로 바꿔둔 작업들 조회
        target_jobs = db.query(Job).filter(Job.status.in_(['queued', 'processing'])).all()
        
        # 진행률이 사실상 0%인 멈춘 애들만
        target_jobs = [j for j in target_jobs if j.progress_percent < 5.0]

        if not target_jobs:
            print("재시도할 멈춘 작업이 없습니다.")
            return

        print(f"총 {len(target_jobs)}개의 작업을 찾아 Celery(Redis) 큐에 등록합니다...")
        for job in target_jobs:
            print(f"- {job.original_filename} (ID: {job.job_id}) 전송 중...")
            job.status = 'queued'
            job.progress_percent = 0.0
            
            # 여기가 핵심: 단순 DB 업데이트가 아니라, 실제로 워커(Celery)에게 일을 하라고 큐에 넣어줍니다.
            process_ocr_task.delay(job.job_id)
            
        db.commit()
        print("\n✅ 모든 멈춘 작업을 워커 큐에 성공적으로 재등록했습니다!")
    except Exception as e:
        print(f"오류 발생: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    re_enqueue_queued_jobs()
