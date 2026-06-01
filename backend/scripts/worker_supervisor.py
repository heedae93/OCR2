"""
Celery worker supervisor for BBOCR.

This process owns the OCR worker subprocess, restarts it when it exits, and
requeues DB jobs that were left in a recoverable state after a worker failure.
It is intentionally separate from FastAPI so API restarts do not kill OCR work.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
LOG_DIR = PROJECT_ROOT / "logs"
STATE_PATH = LOG_DIR / "worker_recovery_state.json"
SUPERVISOR_PID_PATH = LOG_DIR / "worker_supervisor.pid"
WORKER_PID_PATH = LOG_DIR / "worker.pid"

sys.path.insert(0, str(BACKEND_DIR))

from config import Config  # noqa: E402
from database import Job as DBJob  # noqa: E402
from database import SessionLocal  # noqa: E402
from tasks.celery_app import celery_app  # noqa: E402


logger = logging.getLogger("worker_supervisor")


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r. Using default %s.", name, raw, default)
        return default


def load_state() -> dict[str, Any]:
    try:
        if STATE_PATH.exists():
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to read recovery state: %s", exc)
    return {"requeued_at": {}}


def save_state(state: dict[str, Any]) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to write recovery state: %s", exc)


def recently_requeued(state: dict[str, Any], job_id: str, cooldown_seconds: int) -> bool:
    value = state.get("requeued_at", {}).get(job_id)
    if not value:
        return False
    try:
        last = datetime.fromisoformat(value)
    except ValueError:
        return False
    return datetime.now() - last < timedelta(seconds=cooldown_seconds)


def recovery_attempts(state: dict[str, Any], job_id: str) -> int:
    try:
        return int(state.get("attempts", {}).get(job_id, 0))
    except Exception:
        return 0


def mark_requeued(state: dict[str, Any], job_id: str) -> None:
    state.setdefault("requeued_at", {})[job_id] = datetime.now().isoformat()
    state.setdefault("attempts", {})[job_id] = recovery_attempts(state, job_id) + 1


def redis_queue_length(queue_name: str) -> int | None:
    try:
        import redis

        client = redis.from_url(Config.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        return int(client.llen(queue_name))
    except Exception as exc:
        logger.warning("Could not inspect Redis queue %s: %s", queue_name, exc)
        return None


def reset_job_for_retry(job: DBJob) -> None:
    job.status = "queued"
    job.progress_percent = 0.0
    job.current_page = 0
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.processing_time_seconds = None


def fail_job_after_recovery_limit(job: DBJob, attempts: int) -> None:
    job.status = "failed"
    job.progress_percent = 0.0
    job.error_message = f"워커 복구를 {attempts}회 시도했지만 작업이 계속 중단되어 자동 실패 처리했습니다."
    job.completed_at = datetime.now()


def dispatch_ocr_job(job_id: str, queue_name: str) -> None:
    celery_app.send_task("ocr.process", args=[job_id], queue=queue_name)


def recover_jobs(
    *,
    reason: str,
    queue_name: str,
    include_queued: bool,
    min_processing_age_seconds: int,
    queued_age_seconds: int,
    cooldown_seconds: int,
    max_recovery_attempts: int,
) -> int:
    """Requeue jobs that are safe enough to recover without a schema migration."""
    state = load_state()
    now = datetime.now()
    recovered = 0
    queue_length = redis_queue_length(queue_name)

    db = SessionLocal()
    try:
        active_jobs = (
            db.query(DBJob)
            .filter(DBJob.status.in_(["queued", "processing"]))
            .order_by(DBJob.created_at.asc())
            .all()
        )

        for job in active_jobs:
            job_id = job.job_id
            attempts = recovery_attempts(state, job_id)
            if attempts >= max_recovery_attempts:
                fail_job_after_recovery_limit(job, attempts)
                recovered += 1
                logger.error(
                    "Marked job %s failed after %s recovery attempts during %s recovery",
                    job_id,
                    attempts,
                    reason,
                )
                continue

            if recently_requeued(state, job_id, cooldown_seconds):
                continue

            should_requeue = False
            if job.status == "processing":
                started_at = job.started_at or job.created_at or now
                age = now - started_at.replace(tzinfo=None)
                should_requeue = age >= timedelta(seconds=min_processing_age_seconds)
            elif include_queued and job.status == "queued":
                created_at = job.created_at or now
                age = now - created_at.replace(tzinfo=None)
                # Requeue queued jobs only when the Redis list appears empty.
                # If Redis already has queued tasks, adding duplicates is worse than waiting.
                should_requeue = queue_length == 0 and age >= timedelta(seconds=queued_age_seconds)

            if not should_requeue:
                continue

            reset_job_for_retry(job)
            dispatch_ocr_job(job_id, queue_name)
            mark_requeued(state, job_id)
            recovered += 1
            logger.warning("Requeued job %s after %s recovery", job_id, reason)

        if recovered:
            db.commit()
            save_state(state)
        else:
            db.rollback()
    except Exception:
        db.rollback()
        logger.exception("Job recovery failed")
    finally:
        db.close()

    return recovered


def build_worker_command(args: argparse.Namespace) -> list[str]:
    return [
        sys.executable,
        "-m",
        "celery",
        "-A",
        "tasks.celery_app",
        "worker",
        "-Q",
        args.queues,
        "-n",
        args.worker_name,
        "--loglevel",
        args.loglevel,
        "--pool",
        args.pool,
        "--prefetch-multiplier",
        "1",
    ]


def start_worker(args: argparse.Namespace) -> subprocess.Popen:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    env.setdefault("KMP_DUPLICATE_LIB_OK", "True")
    env.setdefault("PYTHONUNBUFFERED", "1")

    worker_log_path = LOG_DIR / "worker.log"
    worker_log = worker_log_path.open("a", encoding="utf-8", buffering=1)
    command = build_worker_command(args)
    creationflags = 0
    startupinfo = None
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    process = subprocess.Popen(
        command,
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=worker_log,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
        startupinfo=startupinfo,
    )
    process._bbocr_log_handle = worker_log  # keep the log handle alive for the child process
    WORKER_PID_PATH.write_text(str(process.pid), encoding="utf-8")
    logger.info("Started Celery worker PID=%s queues=%s", process.pid, args.queues)
    return process


def stop_worker(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    logger.info("Stopping Celery worker PID=%s", process.pid)
    try:
        process.terminate()
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        logger.warning("Worker did not stop gracefully. Killing PID=%s", process.pid)
        process.kill()
    except Exception:
        logger.exception("Failed to stop worker")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BBOCR Celery worker supervisor")
    parser.add_argument("--queues", default=os.environ.get("WORKER_QUEUES", "ocr,tika,opensearch"))
    parser.add_argument("--worker-name", default=os.environ.get("WORKER_NAME", "ocr_worker@%h"))
    parser.add_argument("--pool", default=os.environ.get("WORKER_POOL", "solo"))
    parser.add_argument("--loglevel", default=os.environ.get("WORKER_LOGLEVEL", "info"))
    parser.add_argument("--check-interval", type=int, default=env_int("WORKER_SUPERVISOR_INTERVAL", 10))
    parser.add_argument("--recovery-interval", type=int, default=env_int("WORKER_RECOVERY_INTERVAL", 60))
    parser.add_argument(
        "--processing-recovery-age",
        type=int,
        default=env_int("WORKER_PROCESSING_RECOVERY_SECONDS", max(60, Config.JOB_TIMEOUT_SECONDS + 60)),
    )
    parser.add_argument("--queued-recovery-age", type=int, default=env_int("WORKER_QUEUED_RECOVERY_SECONDS", 600))
    parser.add_argument("--recovery-cooldown", type=int, default=env_int("WORKER_RECOVERY_COOLDOWN_SECONDS", 1800))
    parser.add_argument("--max-recovery-attempts", type=int, default=env_int("WORKER_MAX_RECOVERY_ATTEMPTS", 3))
    parser.add_argument(
        "--recover-queued",
        action="store_true",
        default=os.environ.get("WORKER_RECOVER_QUEUED", "1") != "0",
        help="Requeue old queued DB jobs when the Redis queue is empty.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(LOG_DIR / "worker_supervisor.log", encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    SUPERVISOR_PID_PATH.write_text(str(os.getpid()), encoding="utf-8")
    logger.info("Worker supervisor started PID=%s", os.getpid())

    stopping = False
    worker: subprocess.Popen | None = None

    def handle_stop(signum, _frame):
        nonlocal stopping
        logger.info("Received signal %s. Shutting down supervisor.", signum)
        stopping = True

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    worker = start_worker(args)
    recover_jobs(
        reason="supervisor-startup",
        queue_name="ocr",
        include_queued=args.recover_queued,
        min_processing_age_seconds=env_int(
            "WORKER_STARTUP_PROCESSING_RECOVERY_SECONDS",
            max(60, Config.JOB_TIMEOUT_SECONDS + 60),
        ),
        queued_age_seconds=args.queued_recovery_age,
        cooldown_seconds=args.recovery_cooldown,
        max_recovery_attempts=args.max_recovery_attempts,
    )

    last_recovery = 0.0
    try:
        while not stopping:
            exit_code = worker.poll() if worker else None
            if exit_code is not None:
                logger.error("Celery worker exited with code %s. Restarting.", exit_code)
                recover_jobs(
                    reason="worker-exit",
                    queue_name="ocr",
                    include_queued=args.recover_queued,
                    min_processing_age_seconds=0,
                    queued_age_seconds=args.queued_recovery_age,
                    cooldown_seconds=args.recovery_cooldown,
                    max_recovery_attempts=args.max_recovery_attempts,
                )
                time.sleep(3)
                worker = start_worker(args)

            now = time.monotonic()
            if now - last_recovery >= args.recovery_interval:
                recover_jobs(
                    reason="periodic",
                    queue_name="ocr",
                    include_queued=args.recover_queued,
                    min_processing_age_seconds=args.processing_recovery_age,
                    queued_age_seconds=args.queued_recovery_age,
                    cooldown_seconds=args.recovery_cooldown,
                    max_recovery_attempts=args.max_recovery_attempts,
                )
                last_recovery = now

            time.sleep(max(1, args.check_interval))
    finally:
        stop_worker(worker)
        for path in (SUPERVISOR_PID_PATH, WORKER_PID_PATH):
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
        logger.info("Worker supervisor stopped")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
