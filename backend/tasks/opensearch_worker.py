"""
OpenSearch 색인 태스크 - OCR Task 완료 직후 Celery로 즉시 색인

OCR Worker(Task 1)가 끝나는 시점에 db_helper.py가 이 태스크를
delay()로 디스패치한다. Beat 스케줄 및 DB 폴링 방식은 사용하지 않는다.
"""
import logging
from celery import shared_task

try:
    from opensearchpy.exceptions import OpenSearchException
except ImportError:
    OpenSearchException = Exception

logger = logging.getLogger(__name__)


@shared_task(
    name="opensearch.index_document",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def index_document_task(
    self,
    job_id: str,
    text: str,
    summary: str,
    keywords: list,
    session_id: str = "",
    filename: str = "",
):
    """
    OCR Task가 완료된 직후 디스패치되는 OpenSearch 색인 태스크.

    실패 시 10초 간격으로 최대 3회 재시도한다.
    search_engine.py의 스키마(text, summary, keywords, session_id, filename)를
    표준으로 사용한다.
    """
    try:
        from core.search_engine import search_engine

        search_engine.add_document(
            job_id=job_id,
            text=text,
            summary=summary,
            keywords=keywords,
            session_id=session_id,
            filename=filename,
        )
        logger.info("OpenSearch indexed: job_id=%s filename=%s", job_id, filename)

    except OpenSearchException as exc:
        logger.warning(
            "OpenSearch index failed (job_id=%s): %s — retrying (%d/%d)",
            job_id, exc, self.request.retries, self.max_retries,
        )
        raise self.retry(exc=exc)

    except Exception as exc:
        logger.error(
            "OpenSearch index unexpected error (job_id=%s): %s — retrying (%d/%d)",
            job_id, exc, self.request.retries, self.max_retries,
        )
        raise self.retry(exc=exc)
