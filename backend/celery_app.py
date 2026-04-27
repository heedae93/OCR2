"""
Celery application configuration for BBOCR
Redis를 브로커로 사용 (상태 저장은 기존 파일/DB 방식 유지)
"""
import os
from celery import Celery
from config import Config

REDIS_URL = os.environ.get('REDIS_URL', Config.REDIS_URL)

celery_app = Celery(
    'bbocr',
    broker=REDIS_URL,
    include=['ocr_worker']
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    timezone='Asia/Seoul',
    enable_utc=True,
    # Worker가 죽어도 Redis에 작업이 남아 재처리 가능
    task_acks_late=True,
    # 한 번에 하나씩만 가져옴 (OCR은 GPU 집약적이라 과도한 prefetch 불필요)
    worker_prefetch_multiplier=1,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    task_routes={
        'ocr.process': {'queue': 'ocr'},
    },
)
