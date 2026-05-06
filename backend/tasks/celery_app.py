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
    include=['tasks.ocr_worker']
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    timezone='Asia/Seoul',
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    # Fail fast if Redis is down
    broker_connection_retry_on_startup=False,
    broker_connection_max_retries=0,
    broker_connection_timeout=1, 
    task_routes={
        'ocr.process': {'queue': 'ocr'},
        'tika.process': {'queue': 'tika'},
    },
)
